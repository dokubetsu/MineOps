import { test, expect } from '@playwright/test'
import { fetchAllPages } from '../../src/lib/supabase-pagination'

test.describe('supabase-pagination', () => {
  test('fetchAllPages concatenates multiple pages', async () => {
    const pages = [[1, 2], [3, 4], [5]]
    let call = 0
    const { rows, truncated } = await fetchAllPages<number>(
      async (_from, _to) => {
        const page = pages[call++] ?? []
        return { data: page, error: null }
      },
      { pageSize: 2, maxRows: 100 }
    )
    expect(rows).toEqual([1, 2, 3, 4, 5])
    expect(truncated).toBe(false)
    expect(call).toBe(3)
  })

  test('fetchAllPages marks truncated when maxRows hit', async () => {
    const { rows, truncated } = await fetchAllPages<number>(
      async () => ({ data: [1, 2, 3], error: null }),
      { pageSize: 3, maxRows: 3 }
    )
    expect(rows).toEqual([1, 2, 3])
    expect(truncated).toBe(true)
  })
})
