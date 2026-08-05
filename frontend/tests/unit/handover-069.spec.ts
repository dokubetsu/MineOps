import { test, expect } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

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

test.describe('Handover 069 DB (Organization Deletion Cascade)', () => {
  test('anon / public cannot call delete_organization_cascade', async () => {
    const anon = anonClient()
    test.skip(!anon, 'Supabase anon client not configured')

    const { error } = await anon!.rpc('delete_organization_cascade', {
      p_organization_id: randomUUID(),
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/permission denied/i)
  })

  test('service_role cascade deletes organization and its dependencies', async () => {
    const supabase = serviceClient()
    test.skip(!supabase, 'Supabase service role not configured')

    const orgId = randomUUID()
    const siteId = randomUUID()
    const tripId = randomUUID()

    try {
      // 1. Create org
      await supabase!.from('organizations').insert({
        id: orgId,
        name: `Cascade Delete Org ${orgId.slice(0, 8)}`,
        active: true,
      })

      // 2. Create site under org
      await supabase!.from('sites').insert({
        id: siteId,
        name: 'Cascade Site',
        active: true,
        organization_id: orgId,
      })

      // 3. Create trip under site & org
      await supabase!.from('trips').insert({
        id: tripId,
        site_id: siteId,
        organization_id: orgId,
        trip_date: '2026-08-05',
        cubic_capacity: 20,
        trip_worth: 7400,
        total_shipment_cost: 7400,
        settled: false,
        payment_status: 'pending',
        active: true,
        entry_time: new Date().toISOString(),
      })

      // Verify they exist
      const { data: orgBefore } = await supabase!.from('organizations').select('id').eq('id', orgId).maybeSingle()
      expect(orgBefore).not.toBeNull()
      const { data: siteBefore } = await supabase!.from('sites').select('id').eq('id', siteId).maybeSingle()
      expect(siteBefore).not.toBeNull()
      const { data: tripBefore } = await supabase!.from('trips').select('id').eq('id', tripId).maybeSingle()
      expect(tripBefore).not.toBeNull()

      // 4. Call delete cascade RPC
      const { error: deleteError } = await supabase!.rpc('delete_organization_cascade', {
        p_organization_id: orgId,
      })
      expect(deleteError).toBeNull()

      // 5. Verify they are all deleted
      const { data: orgAfter } = await supabase!.from('organizations').select('id').eq('id', orgId).maybeSingle()
      expect(orgAfter).toBeNull()
      const { data: siteAfter } = await supabase!.from('sites').select('id').eq('id', siteId).maybeSingle()
      expect(siteAfter).toBeNull()
      const { data: tripAfter } = await supabase!.from('trips').select('id').eq('id', tripId).maybeSingle()
      expect(tripAfter).toBeNull()

    } finally {
      // Cleanup if anything failed
      await supabase!.from('trips').delete().eq('id', tripId)
      await supabase!.from('sites').delete().eq('id', siteId)
      await supabase!.from('organizations').delete().eq('id', orgId)
    }
  })
})
