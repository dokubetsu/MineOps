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
    }
  ): Promise<void> {
    const { error } = await supabase
      .from('cash_entries')
      .insert({
        ...payload,
        active: true,
      })

    if (error) throw error
  },

  async deleteEntry(supabase: SupabaseClient<Database>, id: string): Promise<void> {
    const { error } = await supabase
      .from('cash_entries')
      .update({ active: false })
      .eq('id', id)

    if (error) throw error
  },

  async toggleLock(supabase: SupabaseClient<Database>, cashBookId: string, currentStatus: string): Promise<string> {
    const newStatus = currentStatus === 'locked' ? 'draft' : 'locked'
    const { error } = await supabase
      .from('cash_books')
      .update({ status: newStatus })
      .eq('id', cashBookId)

    if (error) throw error
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
