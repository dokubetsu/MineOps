import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { CashBook, CashEntry } from '../supabase/types'
import { calculateClosingBalance } from '../calculations'

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
    }
  ): Promise<void> {
    const { error } = await supabase
      .from('cash_entries')
      .insert({
        ...payload,
        contractor_id: payload.contractor_id || null,
        active: true,
      })

    if (error) throw error
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
    const { data, error } = await supabase
      .from('cash_entries')
      .select('entry_type, amount, active')
      .eq('cash_book_id', cashBookId)
      .eq('active', true)

    if (error) throw error

    let totalIn = 0
    let totalOut = 0
    for (const e of data || []) {
      if (e.entry_type === 'in') totalIn += Number(e.amount)
      else if (e.entry_type === 'out') totalOut += Number(e.amount)
    }

    // Opening balance from parent cash book (for offline parity with calculateClosingBalance)
    const { data: book } = await supabase
      .from('cash_books')
      .select('opening_balance')
      .eq('id', cashBookId)
      .maybeSingle()

    const opening = Number(book?.opening_balance) || 0
    const closing = calculateClosingBalance(
      opening,
      (data || []).map((e) => ({
        entry_type: e.entry_type as 'in' | 'out',
        amount: Number(e.amount),
        active: e.active !== false,
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
