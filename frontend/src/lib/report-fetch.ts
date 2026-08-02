import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './supabase/database.types'
import { fetchAllPages } from './supabase-pagination'

type Supabase = SupabaseClient<Database>

export type ReportCashBook = {
  id: string
  site_id: string
  book_date: string
  opening_balance: number | null
  closing_balance: number | null
  status: string | null
}

export type ReportCashEntry = {
  id: string
  cash_book_id: string
  entry_type: string
  amount: number
  category: string | null
  note: string | null
  active: boolean | null
  created_at: string | null
  contractor_id: string | null
  receipt_url: string | null
  created_by: string | null
  book_date: string
}

export type ReportTrip = Database['public']['Tables']['trips']['Row'] & {
  vehicles?: { plate_number: string; vehicle_type: string } | null
  transport_contractors?: { name: string } | null
}

export async function fetchReportTrips(
  supabase: Supabase,
  from: string,
  to: string,
  siteId?: string
): Promise<{ rows: ReportTrip[]; truncated: boolean }> {
  return fetchAllPages<ReportTrip>((rangeFrom, rangeTo) => {
    let q = supabase
      .from('trips')
      .select('*, vehicles(plate_number, vehicle_type), transport_contractors(name)')
      .gte('trip_date', from)
      .lte('trip_date', to)
      .eq('active', true)
      .order('trip_date')
      .order('created_at')
    if (siteId && siteId !== 'all') q = q.eq('site_id', siteId)
    return q.range(rangeFrom, rangeTo)
  })
}

export async function fetchReportTripCount(
  supabase: Supabase,
  from: string,
  to: string,
  siteId?: string
): Promise<number> {
  let q = supabase
    .from('trips')
    .select('id', { count: 'exact', head: true })
    .gte('trip_date', from)
    .lte('trip_date', to)
    .eq('active', true)
  if (siteId && siteId !== 'all') q = q.eq('site_id', siteId)
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

export async function fetchReportCashEntryCount(
  supabase: Supabase,
  from: string,
  to: string,
  siteId?: string
): Promise<number> {
  let q = supabase
    .from('cash_entries')
    .select('id, cash_books!inner(book_date, site_id)', { count: 'exact', head: true })
    .eq('active', true)
    .gte('cash_books.book_date', from)
    .lte('cash_books.book_date', to)
  if (siteId && siteId !== 'all') q = q.eq('cash_books.site_id', siteId)
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

export async function fetchReportCashBooks(
  supabase: Supabase,
  from: string,
  to: string,
  siteId?: string
): Promise<{ rows: ReportCashBook[]; truncated: boolean }> {
  return fetchAllPages<ReportCashBook>((rangeFrom, rangeTo) => {
    let q = supabase
      .from('cash_books')
      .select('id, site_id, book_date, opening_balance, closing_balance, status')
      .gte('book_date', from)
      .lte('book_date', to)
      .order('book_date')
    if (siteId && siteId !== 'all') q = q.eq('site_id', siteId)
    return q.range(rangeFrom, rangeTo)
  })
}

type CashEntryRow = {
  id: string
  cash_book_id: string
  entry_type: string
  amount: number
  category: string | null
  note: string | null
  active: boolean | null
  created_at: string | null
  contractor_id: string | null
  receipt_url: string | null
  created_by: string | null
  cash_books: { book_date: string; site_id: string } | null
}

export async function fetchReportCashEntries(
  supabase: Supabase,
  from: string,
  to: string,
  siteId?: string
): Promise<{ rows: ReportCashEntry[]; truncated: boolean }> {
  const { rows, truncated } = await fetchAllPages<CashEntryRow>((rangeFrom, rangeTo) => {
    let q = supabase
      .from('cash_entries')
      .select(
        'id, cash_book_id, entry_type, amount, category, note, active, created_at, contractor_id, receipt_url, created_by, cash_books!inner(book_date, site_id)'
      )
      .eq('active', true)
      .gte('cash_books.book_date', from)
      .lte('cash_books.book_date', to)
      .order('created_at')
    if (siteId && siteId !== 'all') q = q.eq('cash_books.site_id', siteId)
    return q.range(rangeFrom, rangeTo)
  })

  return {
    truncated,
    rows: rows.map((e) => ({
      id: e.id,
      cash_book_id: e.cash_book_id,
      entry_type: e.entry_type,
      amount: e.amount,
      category: e.category,
      note: e.note,
      active: e.active,
      created_at: e.created_at,
      contractor_id: e.contractor_id,
      receipt_url: e.receipt_url,
      created_by: e.created_by,
      book_date: e.cash_books?.book_date ?? '',
    })),
  }
}

/** Sum cash IN/OUT for a prior period (count-only trip comparison uses fetchReportTripCount). */
export async function fetchReportCashTotals(
  supabase: Supabase,
  from: string,
  to: string,
  siteId?: string
): Promise<{ totalIn: number; totalOut: number; truncated: boolean }> {
  const { rows, truncated } = await fetchReportCashEntries(supabase, from, to, siteId)
  let totalIn = 0
  let totalOut = 0
  for (const e of rows) {
    if (e.entry_type === 'in') totalIn += Number(e.amount)
    else if (e.entry_type === 'out') totalOut += Number(e.amount)
  }
  return { totalIn, totalOut, truncated }
}
