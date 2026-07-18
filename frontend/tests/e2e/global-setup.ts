/**
 * Ensures a known admin user exists before E2E browser tests.
 *
 * Always force-resets password via Auth Admin API so we never depend on
 * seed.sql bcrypt hashes (they often diverge from GoTrue and produce
 * "Invalid login credentials" in the browser while service checks look fine).
 *
 * Credentials: admin@mineops.com / password123 (overridable via env)
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

  console.log('[e2e global-setup] Supabase URL:', url)

  const supabase: AdminClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Demo org + operational fixtures
  const { error: orgErr } = await supabase.from('organizations').upsert(
    { id: DEFAULT_ORG_ID, name: 'MineOps Demo Org', active: true },
    { onConflict: 'id' }
  )
  if (orgErr) {
    console.warn('[e2e global-setup] organizations upsert:', orgErr.message)
  }

  // Features for demo org (ignore if RPC missing)
  await supabase.rpc('seed_organization_features', {
    p_organization_id: DEFAULT_ORG_ID,
  })

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
      rate_per_cubic: 1000,
      organization_id: DEFAULT_ORG_ID,
    },
    { onConflict: 'id' }
  )

  // Always resolve / create admin and FORCE password to E2E_PASSWORD
  const userId = await ensureAuthUserWithPassword(supabase, E2E_EMAIL, E2E_PASSWORD, {
    role: 'admin',
    organization_id: DEFAULT_ORG_ID,
  })
  await ensureAdminRole(supabase, userId)

  // Verify with a clean client (anon-style password grant, same as browser)
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (anonKey) {
    const browserLike = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: verifyError } = await browserLike.auth.signInWithPassword({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
    })
    if (verifyError) {
      throw new Error(
        `[e2e global-setup] Browser-like login failed after password reset: ${verifyError.message}`
      )
    }
    await browserLike.auth.signOut()
    console.log('[e2e global-setup] Verified admin login with anon key:', E2E_EMAIL)
  } else {
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
    })
    if (verifyError) {
      throw new Error(`[e2e global-setup] Login still fails after seed: ${verifyError.message}`)
    }
    await supabase.auth.signOut()
    console.log('[e2e global-setup] Admin user ready (service client verify):', E2E_EMAIL)
  }
}

async function ensureAuthUserWithPassword(
  supabase: AdminClient,
  email: string,
  password: string,
  appMetadata: Record<string, unknown>
): Promise<string> {
  const { data: listed, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 200,
  })
  if (listError) {
    console.error('[e2e global-setup] listUsers failed:', listError.message)
  }

  const existing = listed?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())

  if (existing) {
    const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      app_metadata: { ...(existing.app_metadata || {}), ...appMetadata },
    })
    if (updateError) {
      throw new Error(
        `[e2e global-setup] Failed to reset password for ${email}: ${updateError.message}`
      )
    }
    console.log('[e2e global-setup] Forced password reset for', email)
    return existing.id
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: appMetadata,
  })
  if (createError || !created.user) {
    throw new Error(`[e2e global-setup] Failed to create ${email}: ${createError?.message}`)
  }
  console.log('[e2e global-setup] Created auth user', email)
  return created.user.id
}

async function ensureAdminRole(supabase: AdminClient, userId: string) {
  const { data: existingRoles, error: selectErr } = await supabase
    .from('user_roles')
    .select('id, role')
    .eq('user_id', userId)

  if (selectErr) {
    console.warn('[e2e global-setup] select user_roles:', selectErr.message)
  }

  const hasAdmin = (existingRoles as { role: string }[] | null)?.some((r) => r.role === 'admin')
  if (hasAdmin) {
    console.log('[e2e global-setup] Admin role already present')
    return
  }

  const { error } = await supabase.from('user_roles').insert({
    user_id: userId,
    role: 'admin',
    site_id: null,
    organization_id: DEFAULT_ORG_ID,
  })
  if (error) {
    console.warn(
      '[e2e global-setup] insert admin role:',
      error.message,
      '(need migration 053 grants if permission denied)'
    )
  } else {
    console.log('[e2e global-setup] Inserted admin user_roles row')
  }
}
