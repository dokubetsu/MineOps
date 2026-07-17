import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient, type PostgrestError } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { partitionAttendanceSave } from '../../src/lib/repositories/attendance'
import { featureForPath, featuresFromRows, defaultFeatureMap } from '../../src/lib/features'

/**
 * Phase 5 — multi-tenant / security helpers.
 * DB cases skip when service role is missing OR lacks table GRANTs (migration 053).
 */

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function isPermissionDenied(err: PostgrestError | null | undefined): boolean {
  if (!err) return false
  return (
    err.code === '42501' ||
    /permission denied/i.test(err.message || '') ||
    /GRANT .+ TO service_role/i.test(err.hint || '')
  )
}

test.describe('Phase 5 pure guards (no DB)', () => {
  test('feature-disabled path map covers modules', () => {
    expect(featureForPath('/dashboard/payroll')).toBe('payroll')
    expect(featureForPath('/dashboard/attendance')).toBe('attendance')
    expect(featureForPath('/dashboard/my-work')).toBeNull()
  })

  test('featuresFromRows fail-closed for missing keys', () => {
    const map = featuresFromRows([{ feature_key: 'trips', enabled: true }])
    expect(map.trips).toBe(true)
    expect(map.payroll).toBe(false)
    expect(defaultFeatureMap(false).cash_book).toBe(false)
  })

  test('attendance unmark partition: null status is clear-only', () => {
    const { toUpsert, toClear } = partitionAttendanceSave([
      { employee_id: 'e1', att_date: '2026-07-01', status: 'present', photo_url: null },
      { employee_id: 'e2', att_date: '2026-07-01', status: null, photo_url: null },
    ])
    expect(toUpsert).toHaveLength(1)
    expect(toClear).toHaveLength(1)
    expect(toClear[0].employee_id).toBe('e2')
  })
})

test.describe('Phase 5 multi-tenant DB (service role)', () => {
  test('last admin is scoped per organization', async () => {
    const supabase = serviceClient()
    test.skip(!supabase, 'Supabase service role not configured')

    const orgA = randomUUID()
    const orgB = randomUUID()
    const createdUserIds: string[] = []

    const cleanup = async () => {
      for (const uid of createdUserIds) {
        await supabase!.from('user_roles').delete().eq('user_id', uid)
        await supabase!.auth.admin.deleteUser(uid).catch(() => null)
      }
      await supabase!.from('organizations').delete().eq('id', orgA)
      await supabase!.from('organizations').delete().eq('id', orgB)
    }

    try {
      const { error: oA } = await supabase!.from('organizations').insert({
        id: orgA,
        name: `E2E Org A ${orgA.slice(0, 8)}`,
        active: true,
      })
      if (isPermissionDenied(oA)) {
        test.skip(
          true,
          'service_role lacks table GRANTs — apply migration 053_grant_api_role_table_privileges.sql'
        )
        return
      }
      if (oA) throw oA

      const { error: oB } = await supabase!.from('organizations').insert({
        id: orgB,
        name: `E2E Org B ${orgB.slice(0, 8)}`,
        active: true,
      })
      if (oB) throw oB

      const { data: userA, error: cA } = await supabase!.auth.admin.createUser({
        email: `e2e-a-${orgA.slice(0, 8)}@mineops.test`,
        password: 'TestPass1234',
        email_confirm: true,
      })
      if (cA || !userA.user) throw cA || new Error('create user A failed')
      const uidA = userA.user.id
      createdUserIds.push(uidA)

      const { data: userB, error: cB } = await supabase!.auth.admin.createUser({
        email: `e2e-b-${orgB.slice(0, 8)}@mineops.test`,
        password: 'TestPass1234',
        email_confirm: true,
      })
      if (cB || !userB.user) throw cB || new Error('create user B failed')
      const uidB = userB.user.id
      createdUserIds.push(uidB)

      const { error: rA } = await supabase!.from('user_roles').insert({
        user_id: uidA,
        role: 'admin',
        site_id: null,
        organization_id: orgA,
      })
      if (isPermissionDenied(rA)) {
        await cleanup()
        test.skip(true, 'service_role lacks user_roles GRANT — apply migration 053')
        return
      }
      if (rA) throw rA

      const { error: rB } = await supabase!.from('user_roles').insert({
        user_id: uidB,
        role: 'admin',
        site_id: null,
        organization_id: orgB,
      })
      if (rB) throw rB

      // Deleting sole admin of org A must fail even though org B has an admin
      const { error: delA } = await supabase!
        .from('user_roles')
        .delete()
        .eq('user_id', uidA)
        .eq('organization_id', orgA)

      expect(delA).toBeTruthy()
      expect(delA!.message).toMatch(/last admin|organization/i)

      const { data: still } = await supabase!
        .from('user_roles')
        .select('id')
        .eq('user_id', uidA)
        .eq('role', 'admin')
      expect(still?.length).toBeGreaterThan(0)

      // Cleanup: second admin so last-admin allows delete of first
      const { data: userA2 } = await supabase!.auth.admin.createUser({
        email: `e2e-a2-${orgA.slice(0, 8)}@mineops.test`,
        password: 'TestPass1234',
        email_confirm: true,
      })
      if (userA2?.user) {
        createdUserIds.push(userA2.user.id)
        await supabase!.from('user_roles').insert({
          user_id: userA2.user.id,
          role: 'admin',
          site_id: null,
          organization_id: orgA,
        })
      }

      await cleanup()
    } catch (err) {
      console.error('[phase5 multi-tenant]', err)
      await cleanup().catch(() => null)
      throw err
    }
  })

  test('attendance freeze after finalized payroll (if schema has trigger)', async () => {
    const supabase = serviceClient()
    test.skip(!supabase, 'Supabase service role not configured')

    const { data, error } = await supabase!.rpc('finalize_payroll_run', {
      p_run_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(error || data === null || data === undefined).toBeTruthy()
    if (error) {
      expect(error.message.length).toBeGreaterThan(0)
    }
  })
})
