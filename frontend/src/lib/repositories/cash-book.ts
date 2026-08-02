import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { CashBook, CashEntry } from '../supabase/types'
import { calculateClosingBalance, roundMoney } from '../calculations'

/** Cash OUT category for trip advances (must match expense picker). */
export const TRIP_ADVANCE_CATEGORY = 'Advance for trip'

/** Cash IN category when a trip is settled / collected. */
export const TRIP_SETTLEMENT_CATEGORY = 'Trip settlement collection'

/** Stable marker so we can update/remove the cash line when advance changes. */
export function tripAdvanceNoteMarker(tripId: string): string {
  return `[trip_advance:${tripId}]`
}

/** Stable marker for settlement cash IN lines. */
export function tripSettlementNoteMarker(tripId: string): string {
  return `[trip_settle:${tripId}]`
}

export const cashBookRepository = {
  async getOrCreate(supabase: SupabaseClient<Database>, siteId: string, date: string): Promise<CashBook> {
    const { data: cb, error: loadError } = await supabase
      .from('cash_books')
      .select('*')
      .eq('site_id', siteId)
      .eq('book_date', date)
      .maybeSingle()

    if (loadError) throw loadError
    if (cb) return cb

    // Fallback: get previous closing balance
    const { data: prev, error: prevError } = await supabase
      .from('cash_books')
      .select('closing_balance')
      .eq('site_id', siteId)
      .lt('book_date', date)
      .order('book_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (prevError) throw prevError
    const openingBalance = prev?.closing_balance || 0

    const { data: newCb, error: insertError } = await supabase
      .from('cash_books')
      .insert({
        site_id: siteId,
        book_date: date,
        opening_balance: openingBalance,
        closing_balance: openingBalance,
        status: 'draft',
      })
      .select()
      .single()

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: retryCb, error: retryError } = await supabase
          .from('cash_books')
          .select('*')
          .eq('site_id', siteId)
          .eq('book_date', date)
          .single()
        if (retryError) throw retryError
        return retryCb
      }
      throw insertError
    }

    return newCb
  },

  async listEntries(supabase: SupabaseClient<Database>, cashBookId: string, limit = 50, offset = 0): Promise<CashEntry[]> {
    const { data, error } = await supabase
      .from('cash_entries')
      .select('*')
      .eq('cash_book_id', cashBookId)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    return data || []
  },

  async createEntry(
    supabase: SupabaseClient<Database>,
    payload: {
      cash_book_id: string
      entry_type: 'in' | 'out'
      category: string
      amount: number
      note: string | null
      receipt_url: string | null
      contractor_id?: string | null
      /** Offline outbox idempotency key (unique per org when set) */
      client_id?: string | null
    }
  ): Promise<void> {
    const insertPayload = {
      cash_book_id: payload.cash_book_id,
      entry_type: payload.entry_type,
      category: payload.category,
      amount: payload.amount,
      note: payload.note,
      receipt_url: payload.receipt_url,
      contractor_id: payload.contractor_id || null,
      client_id: payload.client_id || null,
      active: true,
    }

    const { error } = await supabase.from('cash_entries').insert(insertPayload)

    if (error) {
      // Idempotent offline retry: same client_id already posted
      if (error.code === '23505' && payload.client_id) {
        return
      }
      throw error
    }
  },

  /**
   * Keep cash book in sync with trip.advance_amount:
   * - amount > 0 → cash OUT "Advance for trip" (create or update)
   * - amount ≤ 0 → soft-delete any linked advance line
   * Marker in note: [trip_advance:<tripId>]
   */
  async syncTripAdvance(
    supabase: SupabaseClient<Database>,
    args: {
      siteId: string
      bookDate: string
      tripId: string
      amount: number | null | undefined
      contractorId?: string | null
      vehiclePlate?: string | null
    }
  ): Promise<void> {
    const { siteId, bookDate, tripId } = args
    if (!siteId || !bookDate || !tripId) return

    const amount = roundMoney(Number(args.amount) || 0)
    const marker = tripAdvanceNoteMarker(tripId)
    const book = await this.getOrCreate(supabase, siteId, bookDate)

    // Find existing linked entry in this cash book (active or not — we may re-activate)
    const { data: existingRows, error: findError } = await supabase
      .from('cash_entries')
      .select('id, amount, active, cash_book_id')
      .eq('cash_book_id', book.id)
      .eq('category', TRIP_ADVANCE_CATEGORY)
      .ilike('note', `%${marker}%`)
      .limit(5)

    if (findError) throw findError
    const existing = (existingRows || [])[0] || null

    if (amount <= 0) {
      if (existing?.active) {
        const { error } = await supabase
          .from('cash_entries')
          .update({ active: false })
          .eq('id', existing.id)
        if (error) throw error
      }
      return
    }

    if (book.status === 'locked') {
      if (amount > 0) {
        throw new Error(
          `Cash book for ${bookDate} is locked. Ask an admin to unlock it before posting a trip advance, or save the trip with zero advance.`
        )
      }
      return
    }

    const plate = (args.vehiclePlate || '').trim()
    const note = plate
      ? `${marker} Advance for ${plate}`
      : `${marker} Trip advance`

    if (existing) {
      const { error } = await supabase
        .from('cash_entries')
        .update({
          cash_book_id: book.id,
          entry_type: 'out',
          category: TRIP_ADVANCE_CATEGORY,
          amount,
          note,
          contractor_id: args.contractorId || null,
          active: true,
          receipt_url: null,
        })
        .eq('id', existing.id)
      if (error) throw error
      return
    }

    await this.createEntry(supabase, {
      cash_book_id: book.id,
      entry_type: 'out',
      category: TRIP_ADVANCE_CATEGORY,
      amount,
      note,
      receipt_url: null,
      contractor_id: args.contractorId || null,
    })
  },

  /**
   * Mirror trip settlement into cash book IN (collection).
   * - amount > 0 → cash IN "Trip settlement collection"
   * - amount ≤ 0 → soft-delete linked settlement line
   * Marker: [trip_settle:<tripId>]
   * Idempotent on retries (same marker upsert).
   */
  async syncTripSettlement(
    supabase: SupabaseClient<Database>,
    args: {
      siteId: string
      bookDate: string
      tripId: string
      amount: number | null | undefined
      vehiclePlate?: string | null
      paymentMethod?: string | null
      paymentReference?: string | null
    }
  ): Promise<void> {
    const { siteId, bookDate, tripId } = args
    if (!siteId || !bookDate || !tripId) return

    const amount = roundMoney(Number(args.amount) || 0)
    const marker = tripSettlementNoteMarker(tripId)
    const book = await this.getOrCreate(supabase, siteId, bookDate)

    const { data: existingRows, error: findError } = await supabase
      .from('cash_entries')
      .select('id, amount, active, cash_book_id')
      .eq('cash_book_id', book.id)
      .eq('category', TRIP_SETTLEMENT_CATEGORY)
      .ilike('note', `%${marker}%`)
      .limit(5)

    if (findError) throw findError
    const existing = (existingRows || [])[0] || null

    if (amount <= 0) {
      if (existing?.active) {
        const { error } = await supabase
          .from('cash_entries')
          .update({ active: false })
          .eq('id', existing.id)
        if (error) throw error
      }
      return
    }

    if (book.status === 'locked') {
      throw new Error(
        `Cash book for ${bookDate} is locked. Ask an admin to unlock it before posting a trip settlement collection.`
      )
    }

    const plate = (args.vehiclePlate || '').trim()
    const method = (args.paymentMethod || '').trim()
    const ref = (args.paymentReference || '').trim()
    const extras = [method && `via ${method}`, ref && `ref ${ref}`].filter(Boolean).join(' · ')
    const note = plate
      ? `${marker} Settlement ${plate}${extras ? ` · ${extras}` : ''}`
      : `${marker} Trip settlement${extras ? ` · ${extras}` : ''}`

    if (existing) {
      const { error } = await supabase
        .from('cash_entries')
        .update({
          cash_book_id: book.id,
          entry_type: 'in',
          category: TRIP_SETTLEMENT_CATEGORY,
          amount,
          note,
          active: true,
          receipt_url: null,
        })
        .eq('id', existing.id)
      if (error) throw error
      return
    }

    await this.createEntry(supabase, {
      cash_book_id: book.id,
      entry_type: 'in',
      category: TRIP_SETTLEMENT_CATEGORY,
      amount,
      note,
      receipt_url: null,
    })
  },

  /**
   * Employee/manager helper: ensure today's draft cash book exists, then insert an OUT expense.
   * Receipt path must start with cash_book_id for storage RLS (migration 026/042).
   */
  async logSiteExpense(
    supabase: SupabaseClient<Database>,
    siteId: string,
    bookDate: string,
    payload: {
      category: string
      amount: number
      note: string | null
      receiptFile?: File | null
      contractor_id?: string | null
    }
  ): Promise<void> {
    if (!siteId) throw new Error('Site is required')
    const amount = Number(payload.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Please enter a valid amount greater than zero')
    }

    const book = await this.getOrCreate(supabase, siteId, bookDate)
    if (book.status === 'locked') {
      throw new Error('Today\'s cash book is locked. Ask an admin to unlock it before adding expenses.')
    }

    let receiptUrl: string | null = null
    if (payload.receiptFile) {
      const file = payload.receiptFile
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Receipt photo must be 5MB or smaller')
      }
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${book.id}/${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from('cash-receipts')
        .upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      receiptUrl = path
    }

    await this.createEntry(supabase, {
      cash_book_id: book.id,
      entry_type: 'out',
      category: payload.category,
      amount,
      note: payload.note,
      receipt_url: receiptUrl,
      contractor_id: payload.contractor_id || null,
    })
  },

  async listMyEntriesForDate(
    supabase: SupabaseClient<Database>,
    siteId: string,
    bookDate: string,
    userId: string
  ): Promise<CashEntry[]> {
    const { data: book, error: bookError } = await supabase
      .from('cash_books')
      .select('id')
      .eq('site_id', siteId)
      .eq('book_date', bookDate)
      .maybeSingle()

    if (bookError) throw bookError
    if (!book) return []

    const { data, error } = await supabase
      .from('cash_entries')
      .select('*')
      .eq('cash_book_id', book.id)
      .eq('active', true)
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error
    return data || []
  },

  async deleteEntry(supabase: SupabaseClient<Database>, id: string): Promise<void> {
    const { error } = await supabase
      .from('cash_entries')
      .update({ active: false })
      .eq('id', id)

    if (error) throw error
  },

  /**
   * Lock or unlock a cash book.
   * Unlock (locked → draft) is admin-only at DB (migration 040) and should be gated in UI.
   */
  async toggleLock(
    supabase: SupabaseClient<Database>,
    cashBookId: string,
    currentStatus: string,
    options?: { isAdmin?: boolean }
  ): Promise<string> {
    const newStatus = currentStatus === 'locked' ? 'draft' : 'locked'
    if (newStatus === 'draft' && options?.isAdmin === false) {
      throw new Error('Only organization admins can unlock a cash book')
    }

    const { error } = await supabase
      .from('cash_books')
      .update({ status: newStatus })
      .eq('id', cashBookId)

    if (error) {
      const msg = error.message || ''
      if (/only organization admins can unlock|insufficient_privilege/i.test(msg)) {
        throw new Error('Only organization admins can unlock a cash book')
      }
      throw error
    }
    return newStatus
  },

  async getBalances(supabase: SupabaseClient<Database>, cashBookId: string): Promise<{ totalIn: number; totalOut: number; closing: number }> {
    const [{ data: book, error: bookError }, { data: entries, error: entriesError }] = await Promise.all([
      supabase
        .from('cash_books')
        .select('opening_balance, closing_balance')
        .eq('id', cashBookId)
        .single(),
      supabase
        .from('cash_entries')
        .select('entry_type, amount')
        .eq('cash_book_id', cashBookId)
        .eq('active', true),
    ])

    if (bookError) throw bookError
    if (entriesError) throw entriesError

    let totalIn = 0
    let totalOut = 0
    for (const e of entries || []) {
      if (e.entry_type === 'in') totalIn += Number(e.amount)
      else if (e.entry_type === 'out') totalOut += Number(e.amount)
    }

    const opening = Number(book?.opening_balance) || 0
    const closing =
      book?.closing_balance != null
        ? Number(book.closing_balance)
        : calculateClosingBalance(
            opening,
            (entries || []).map((e) => ({
              entry_type: e.entry_type as 'in' | 'out',
              amount: Number(e.amount),
              active: true,
            }))
          )

    return { totalIn, totalOut, closing }
  },

  async updateReceiptUrl(supabase: SupabaseClient<Database>, id: string, receiptUrl: string | null): Promise<void> {
    const { error } = await supabase
      .from('cash_entries')
      .update({ receipt_url: receiptUrl })
      .eq('id', id)

    if (error) throw error
  }
}
