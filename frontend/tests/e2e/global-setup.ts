/**
 * Ensures a known admin user exists before E2E browser tests.
 * Prefer service-role Admin API over brittle bcrypt seeds so local + CI
 * always share credentials: admin@mineops.com / password123
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const E2E_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@mineops.com'
const E2E_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'password123'
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000000'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, 'public', any>

export default async function globalSetup() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    console.warn(
      '[e2e global-setup] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — skipping user seed. Login tests will fail if no user exists.'
    )
    return
  }

  const supabase: AdminClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Ensure demo org exists
  await supabase.from('organizations').upsert(
    { id: DEFAULT_ORG_ID, name: 'MineOps Demo Org', active: true },
    { onConflict: 'id' }
  )

  // Ensure at least one site for trip/attendance flows
  await supabase.from('sites').upsert(
    {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Test Mine Site 1',
      location: 'North Quarry',
      active: true,
      organization_id: DEFAULT_ORG_ID,
    },
    { onConflict: 'id' }
  )

  // Seed vehicle + employee + rates so trip/attendance/payroll flows work
  await supabase.from('vehicles').upsert(
    {
      id: '00000000-0000-0000-0000-000000000301',
      plate_number: 'KA01MH1234',
      vehicle_type: '12WH',
      ownership: 'rented',
      active: true,
      organization_id: DEFAULT_ORG_ID,
    },
    { onConflict: 'id' }
  )

  await supabase.from('employees').upsert(
    {
      id: '00000000-0000-0000-0000-000000000501',
      name: 'John Doe Operator',
      role: 'supervisor',
      wage_type: 'monthly',
      wage_rate: 25000,
      site_id: '00000000-0000-0000-0000-000000000001',
      active: true,
      leave_balance: 15,
      organization_id: DEFAULT_ORG_ID,
    },
    { onConflict: 'id' }
  )

  await supabase.from('negotiated_rates').upsert(
    {
      id: '00000000-0000-0000-0000-000000000701',
      vehicle_type: '12WH',
      rate_per_cubic: 150,
      organization_id: DEFAULT_ORG_ID,
    },
    { onConflict: 'id' }
  )

  // Try password login first
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
  })

  if (!signInError) {
    console.log('[e2e global-setup] Admin credentials already work')
    const { data: sessionData } = await supabase.auth.getUser()
    const uid = sessionData.user?.id
    if (uid) {
      await ensureAdminRole(supabase, uid)
    }
    await supabase.auth.signOut()
    return
  }

  console.log('[e2e global-setup] Creating/updating admin user via Admin API…')

  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 })
  if (listError) {
    console.error('[e2e global-setup] listUsers failed:', listError.message)
  }

  const existing = listed?.users?.find((u) => u.email?.toLowerCase() === E2E_EMAIL.toLowerCase())

  let userId = existing?.id
  if (existing) {
    const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
      password: E2E_PASSWORD,
      email_confirm: true,
      app_metadata: { role: 'admin', organization_id: DEFAULT_ORG_ID },
    })
    if (updateError) {
      throw new Error(`[e2e global-setup] Failed to update admin password: ${updateError.message}`)
    }
  } else {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      email_confirm: true,
      app_metadata: { role: 'admin', organization_id: DEFAULT_ORG_ID },
    })
    if (createError || !created.user) {
      throw new Error(`[e2e global-setup] Failed to create admin: ${createError?.message}`)
    }
    userId = created.user.id
  }

  if (!userId) {
    throw new Error('[e2e global-setup] No user id after create/update')
  }

  await ensureAdminRole(supabase, userId)

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
  })
  if (verifyError) {
    throw new Error(`[e2e global-setup] Login still fails after seed: ${verifyError.message}`)
  }
  await supabase.auth.signOut()
  console.log('[e2e global-setup] Admin user ready:', E2E_EMAIL)
}

async function ensureAdminRole(supabase: AdminClient, userId: string) {
  const { data: existingRoles } = await supabase
    .from('user_roles')
    .select('id, role')
    .eq('user_id', userId)

  const hasAdmin = (existingRoles as { role: string }[] | null)?.some((r) => r.role === 'admin')
  if (hasAdmin) return

  const { error } = await supabase.from('user_roles').insert({
    user_id: userId,
    role: 'admin',
    site_id: null,
    organization_id: DEFAULT_ORG_ID,
  })
  if (error) {
    console.warn('[e2e global-setup] insert admin role:', error.message)
  }
}
