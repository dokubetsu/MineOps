import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient, type PostgrestError } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { canSettleTrips, tripOpsFromOrgRow } from '../../src/lib/trip-ops-policy'

/**
 * Handover 068 — service_role leave unapprove + settlement_admin_only DB gate.
 * DB cases skip when service role / GRANTs are unavailable.
 */

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function anonClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
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

test.describe('Handover 068 pure policy', () => {
  test('canSettleTrips respects settlementAdminOnly', () => {
    const policy = tripOpsFromOrgRow({ settlement_admin_only: true })
    expect(canSettleTrips('admin', policy)).toBe(true)
    expect(canSettleTrips('site_manager', policy)).toBe(false)
    expect(canSettleTrips('site_employee', policy)).toBe(false)
  })

  test('canSettleTrips allows managers when flag off', () => {
    const policy = tripOpsFromOrgRow({ settlement_admin_only: false })
    expect(canSettleTrips('site_manager', policy)).toBe(true)
  })
})

test.describe('Handover 068 DB (service role)', () => {
  test('service_role unapprove restores leave_balance', async () => {
    const supabase = serviceClient()
    test.skip(!supabase, 'Supabase service role not configured')

    const orgId = randomUUID()
    const siteId = randomUUID()
    const empId = randomUUID()
    const leaveId = randomUUID()
    const leaveDate = '2026-06-15'

    const cleanup = async () => {
      await supabase!.from('leave_applications').delete().eq('id', leaveId)
      await supabase!.from('attendance').delete().eq('employee_id', empId)
      await supabase!.from('employees').delete().eq('id', empId)
      await supabase!.from('sites').delete().eq('id', siteId)
      await supabase!.from('organization_features').delete().eq('organization_id', orgId)
      await supabase!.from('organizations').delete().eq('id', orgId)
    }

    try {
      const { error: orgErr } = await supabase!.from('organizations').insert({
        id: orgId,
        name: `E2E Leave Org ${orgId.slice(0, 8)}`,
        active: true,
      })
      if (isPermissionDenied(orgErr)) {
        test.skip(true, 'service_role lacks org GRANTs')
        return
      }
      expect(orgErr).toBeNull()

      await supabase!.rpc('seed_organization_features', { p_organization_id: orgId })

      const { error: siteErr } = await supabase!.from('sites').insert({
        id: siteId,
        name: 'Leave Site',
        active: true,
        organization_id: orgId,
      })
      expect(siteErr).toBeNull()

      const { error: empErr } = await supabase!.from('employees').insert({
        id: empId,
        name: 'Leave Worker',
        site_id: siteId,
        organization_id: orgId,
        active: true,
        role: 'worker',
        wage_type: 'daily',
        wage_rate: 500,
        leave_balance: 10,
      })
      expect(empErr).toBeNull()

      const { error: leaveErr } = await supabase!.from('leave_applications').insert({
        id: leaveId,
        employee_id: empId,
        from_date: leaveDate,
        to_date: leaveDate,
        status: 'approved',
        attendance_snapshot: {},
        organization_id: orgId,
      })
      expect(leaveErr).toBeNull()

      // Simulate charged balance (approve deducted 1)
      await supabase!.from('employees').update({ leave_balance: 9 }).eq('id', empId)

      const { error: unapproveErr } = await supabase!.rpc('unapprove_leave_application', {
        p_application_id: leaveId,
      })
      expect(unapproveErr).toBeNull()

      const { data: emp } = await supabase!
        .from('employees')
        .select('leave_balance')
        .eq('id', empId)
        .single()
      expect(Number(emp?.leave_balance)).toBe(10)

      const { data: app } = await supabase!
        .from('leave_applications')
        .select('status')
        .eq('id', leaveId)
        .single()
      expect(app?.status).toBe('pending')
    } finally {
      await cleanup()
    }
  })

  test('settlement_admin_only blocks non-admin settle update', async () => {
    const supabase = serviceClient()
    const anon = anonClient()
    test.skip(!supabase || !anon, 'Supabase keys not configured')

    const orgId = randomUUID()
    const siteId = randomUUID()
    const tripId = randomUUID()
    const mgrEmail = `mgr-${orgId.slice(0, 8)}@khani-test.local`
    const mgrPassword = 'TestPass123!@#'
    let mgrUserId: string | null = null

    const cleanup = async () => {
      await supabase!.from('trips').delete().eq('id', tripId)
      if (mgrUserId) {
        await supabase!.from('user_roles').delete().eq('user_id', mgrUserId)
        await supabase!.auth.admin.deleteUser(mgrUserId).catch(() => null)
      }
      await supabase!.from('sites').delete().eq('id', siteId)
      await supabase!.from('organization_features').delete().eq('organization_id', orgId)
      await supabase!.from('organizations').delete().eq('id', orgId)
    }

    try {
      const { error: orgErr } = await supabase!.from('organizations').insert({
        id: orgId,
        name: `E2E Settle Org ${orgId.slice(0, 8)}`,
        active: true,
        settlement_admin_only: true,
      })
      if (isPermissionDenied(orgErr)) {
        test.skip(true, 'service_role lacks org GRANTs')
        return
      }
      expect(orgErr).toBeNull()

      await supabase!.rpc('seed_organization_features', { p_organization_id: orgId })

      const { error: siteErr } = await supabase!.from('sites').insert({
        id: siteId,
        name: 'Settle Site',
        active: true,
        organization_id: orgId,
      })
      expect(siteErr).toBeNull()

      const { data: created, error: createErr } = await supabase!.auth.admin.createUser({
        email: mgrEmail,
        password: mgrPassword,
        email_confirm: true,
      })
      expect(createErr).toBeNull()
      mgrUserId = created.user!.id

      const { error: roleErr } = await supabase!.from('user_roles').insert({
        user_id: mgrUserId,
        role: 'site_manager',
        site_id: siteId,
        organization_id: orgId,
      })
      expect(roleErr).toBeNull()

      const { error: tripErr } = await supabase!.from('trips').insert({
        id: tripId,
        site_id: siteId,
        organization_id: orgId,
        trip_date: '2026-06-20',
        cubic_capacity: 20,
        trip_worth: 7400,
        total_shipment_cost: 7400,
        settled: false,
        payment_status: 'pending',
        active: true,
        entry_time: new Date().toISOString(),
      })
      expect(tripErr).toBeNull()

      const { error: signErr } = await anon!.auth.signInWithPassword({
        email: mgrEmail,
        password: mgrPassword,
      })
      expect(signErr).toBeNull()

      const { error: settleErr } = await anon!
        .from('trips')
        .update({
          settled: true,
          payment_status: 'settled',
          settlement_amount: 7400,
          settled_at: new Date().toISOString(),
        })
        .eq('id', tripId)

      expect(settleErr).not.toBeNull()
      expect(settleErr!.message).toMatch(/only admins can settle/i)

      const { data: trip } = await supabase!
        .from('trips')
        .select('settled, payment_status')
        .eq('id', tripId)
        .single()
      expect(trip?.settled).toBe(false)
    } finally {
      await anon!.auth.signOut().catch(() => null)
      await cleanup()
    }
  })
})
