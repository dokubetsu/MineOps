import type { PostgrestError } from '@supabase/supabase-js'

const DEFAULT_PAGE_SIZE = 1000
/** Hard safety cap — refuse month-end export if hit (see reports page). */
export const REPORT_FETCH_MAX_ROWS = 50_000
/**
 * Soft UI cap — refuse interactive report load before fetching when exceeded
 * to avoid browser OOM on phones / large date ranges.
 */
export const REPORT_UI_MAX_ROWS = 15_000

export type PageQueryResult<T> = {
  data: T[] | null
  error: PostgrestError | null
}

/**
 * Fetch all rows from a Supabase query using .range() pagination.
 * Returns truncated=true when the safety cap (maxRows) is reached.
 */
export async function fetchAllPages<T>(
  queryFn: (rangeFrom: number, rangeTo: number) => PromiseLike<PageQueryResult<T>>,
  opts?: { pageSize?: number; maxRows?: number }
): Promise<{ rows: T[]; truncated: boolean }> {
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE
  const maxRows = opts?.maxRows ?? REPORT_FETCH_MAX_ROWS
  const rows: T[] = []
  let offset = 0

  while (rows.length < maxRows) {
    const rangeTo = Math.min(offset + pageSize - 1, maxRows - 1)
    const { data, error } = await queryFn(offset, rangeTo)
    if (error) throw error
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) {
      return { rows, truncated: false }
    }
    offset += pageSize
    if (rows.length >= maxRows) {
      return { rows, truncated: true }
    }
  }

  return { rows, truncated: true }
}
