import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { passwordSchema } from '@/lib/password-policy'

// Zod schema for validating the incoming request body
const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: passwordSchema,
  role: z.enum(['admin', 'site_manager', 'stakeholder', 'employee', 'site_employee']),
  site_id: z.string().uuid('Invalid site ID format').nullable().optional(),
  share_percent: z.union([z.number(), z.string()]).transform((val) => {
    const num = parseFloat(String(val))
    return isNaN(num) ? 50 : num
  }).optional(),
  employee_link_mode: z.enum(['link', 'create', 'none']).optional(),
  employee_id: z.string().uuid('Invalid employee ID').nullable().optional(),
  employee_name: z.string().optional(),
  employee_phone: z.string().optional(),
  employee_wage_type: z.string().optional(),
  employee_wage_rate: z.union([z.number(), z.string()]).transform((val) => {
    const num = parseFloat(String(val))
    return isNaN(num) ? 0 : num
  }).optional(),
}).refine(
  (data) => data.role === 'admin' || !!data.site_id,
  { message: 'A site is required for non-admin roles', path: ['site_id'] }
)

/** Best-effort cleanup when Auth user was created but DB provisioning failed. */
async function rollbackAuthUser(supabase: SupabaseClient, userId: string): Promise<void> {
  try {
    await supabase.from('stakeholder_site_access').delete().eq('stakeholder_user_id', userId)
  } catch { /* ignore */ }
  try {
    await supabase.from('employees').update({ user_id: null }).eq('user_id', userId)
  } catch { /* ignore */ }
  try {
    await supabase.from('user_roles').delete().eq('user_id', userId)
  } catch { /* ignore */ }
  try {
    await supabase.auth.admin.deleteUser(userId)
  } catch (err) {
    console.error('Failed to roll back auth user after provisioning failure:', err)
  }
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'Internal Server Error: Missing Supabase environment variables' },
      { status: 500 }
    )
  }

  const supabase = createClient(
    supabaseUrl,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Verify the caller is an authenticated admin
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const callerToken = authHeader.slice(7)
  const { data: callerData, error: callerError } = await supabase.auth.getUser(callerToken)
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check admin role, and capture the caller's own organization — the new
  // user is always created inside the caller's org, never a client-supplied
  // one (the request body has no organization_id field at all).
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role, organization_id')
    .eq('user_id', callerData.user.id)
    .eq('role', 'admin')
  if (!roleData || roleData.length === 0) {
    return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }
  const callerOrganizationId = roleData[0].organization_id

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 })
  }

  const result = createUserSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues.map(err => err.message).join(', ') },
      { status: 400 }
    )
  }

  const {
    email,
    password,
    role,
    site_id,
    share_percent,
    employee_link_mode,
    employee_id,
    employee_name,
    employee_phone,
    employee_wage_type,
    employee_wage_rate
  } = result.data

  // Pre-validate site belongs to caller's org (also re-checked inside RPC)
  if (site_id) {
    const { data: siteData, error: siteError } = await supabase
      .from('sites')
      .select('organization_id')
      .eq('id', site_id)
      .single()

    if (siteError || !siteData || siteData.organization_id !== callerOrganizationId) {
      return NextResponse.json(
        { error: 'Invalid site ID: site does not belong to your organization' },
        { status: 400 }
      )
    }
  }

  // 1) Create Auth user
  const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError || !newUser.user) {
    return NextResponse.json({ error: createError?.message || 'Failed to create user' }, { status: 400 })
  }

  const newUserId = newUser.user.id

  // 2) Atomic DB provisioning (role + stakeholder + employee) via SECURITY DEFINER RPC
  const { error: provisionError } = await supabase.rpc('provision_user_access', {
    p_user_id: newUserId,
    p_role: role,
    p_organization_id: callerOrganizationId,
    p_site_id: site_id || null,
    p_share_percent: share_percent ?? 50,
    p_employee_link_mode: employee_link_mode || 'none',
    p_employee_id: employee_id || null,
    p_employee_name: employee_name || null,
    p_employee_phone: employee_phone || null,
    p_employee_wage_type: employee_wage_type || 'monthly',
    p_employee_wage_rate: employee_wage_rate ?? 0,
  })

  if (provisionError) {
    await rollbackAuthUser(supabase, newUserId)
    return NextResponse.json(
      { error: `Failed to provision user access: ${provisionError.message}` },
      { status: 500 }
    )
  }

  // 3) Audit log (non-fatal — user is already fully provisioned)
  const { error: auditError } = await supabase.from('audit_logs').insert({
    organization_id: callerOrganizationId,
    actor_user_id: callerData.user.id,
    action: 'create_user',
    target_type: 'user',
    target_id: newUserId,
    metadata: { email, role, site_id },
  })

  if (auditError) {
    console.error('Failed to create audit log for user creation:', auditError.message)
  }

  return NextResponse.json({ user_id: newUserId }, { status: 201 })
}
