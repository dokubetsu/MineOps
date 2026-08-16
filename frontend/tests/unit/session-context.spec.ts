import { test, expect } from '@playwright/test'
import { fetchSessionContext } from '../../src/lib/session-context'

test.describe('fetchSessionContext tests', () => {
  test('returns consolidated session payload when get_session_context RPC succeeds', async () => {
    const mockSupabase = {
      rpc: async (fn: string) => {
        if (fn === 'get_session_context') {
          return {
            data: {
              authenticated: true,
              user_id: 'u-123',
              is_platform_owner: false,
              user_roles: [
                {
                  user_id: 'u-123',
                  role: 'site_manager',
                  site_id: 'site-abc',
                  organization_id: 'org-xyz',
                },
              ],
              assigned_sites: [{ id: 'site-abc', name: 'Site Alpha', location: 'Quarry 1' }],
              organization: { id: 'org-xyz', name: 'Mining Corp', active: true },
              features: [{ feature_key: 'trips', enabled: true }],
              org_active: true,
            },
            error: null,
          }
        }
        return { data: null, error: null }
      },
    } as unknown as Parameters<typeof fetchSessionContext>[0]

    const res = await fetchSessionContext(mockSupabase, 'u-123')
    expect(res).not.toBeNull()
    expect(res?.authenticated).toBe(true)
    expect(res?.is_platform_owner).toBe(false)
    expect(res?.user_roles[0].role).toBe('site_manager')
    expect(res?.assigned_sites[0].name).toBe('Site Alpha')
    expect(res?.organization?.name).toBe('Mining Corp')
    expect(res?.org_active).toBe(true)
    expect(res?.features[0].feature_key).toBe('trips')
  })

  test('falls back gracefully to discrete queries when get_session_context RPC fails', async () => {
    const mockSupabase = {
      rpc: async (fn: string) => {
        if (fn === 'get_session_context') {
          return { data: null, error: { message: 'function does not exist' } }
        }
        if (fn === 'is_platform_owner') {
          return { data: false, error: null }
        }
        if (fn === 'is_user_org_active') {
          return { data: true, error: null }
        }
        if (fn === 'get_my_assigned_sites') {
          return { data: [{ id: 'site-1', name: 'Site 1', location: null }], error: null }
        }
        return { data: null, error: null }
      },
      auth: {
        getUser: async () => ({ data: { user: { id: 'u-456' } } }),
      },
      from: (table: string) => {
        const handler: Record<string, unknown> = {
          select: () => handler,
          eq: () => handler,
          in: () => handler,
          maybeSingle: async () => {
            if (table === 'platform_roles') return { data: null, error: null }
            if (table === 'organizations') return { data: { id: 'org-1', name: 'Fallback Org', active: true }, error: null }
            return { data: null, error: null }
          },
          then: (resolve: (arg: unknown) => void) => {
            if (table === 'user_roles') {
              resolve({
                data: [{ user_id: 'u-456', role: 'admin', site_id: 'site-1', organization_id: 'org-1' }],
                error: null,
              })
            } else if (table === 'organization_features') {
              resolve({
                data: [{ feature_key: 'cash_book', enabled: true }],
                error: null,
              })
            } else {
              resolve({ data: [], error: null })
            }
          },
        }
        return handler
      },
    } as unknown as Parameters<typeof fetchSessionContext>[0]

    const res = await fetchSessionContext(mockSupabase, 'u-456')
    expect(res).not.toBeNull()
    expect(res?.authenticated).toBe(true)
    expect(res?.user_roles[0].role).toBe('admin')
    expect(res?.organization?.name).toBe('Fallback Org')
  })
})
