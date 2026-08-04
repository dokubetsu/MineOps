import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { passwordSchema } from '@/lib/password-policy'
import { assertOrganizationActive } from '@/lib/admin-auth'

// Zod schema for validating the incoming request body
/** UI often sends null for unused optional fields; treat null like omitted. */
const optionalString = z.string().nullish().transform((v) => v ?? undefined)
const optionalUuid = z.string().uuid('Invalid ID format').nullish().transform((v) => v ?? null)

const createUserSchema = z
  .object({
    email: z.string().email('Invalid email address'),
    password: passwordSchema,
    role: z.enum(['admin', 'site_manager', 'stakeholder', 'employee', 'site_employee', 'unload_clerk'], {
      error: 'Invalid role',
    }),
    site_id: optionalUuid,
    /** Loading sites for unload_clerk (one or many). */
    site_ids: z.array(z.string().uuid('Invalid site ID')).nullish().transform((v) => v ?? undefined),
    share_percent: z
      .union([z.number(), z.string()])
      .nullish()
      .transform((val) => {
        if (val == null || val === '') return 50
        const num = parseFloat(String(val))
        return isNaN(num) ? 50 : num
      }),
    employee_link_mode: z.enum(['link', 'create', 'none']).nullish().transform((v) => v ?? 'none'),
    employee_id: optionalUuid,
    employee_name: optionalString,
    employee_phone: optionalString,
    employee_wage_type: optionalString,
    employee_wage_rate: z
      .union([z.number(), z.string()])
      .nullish()
      .transform((val) => {
        if (val == null || val === '') return 0
        const num = parseFloat(String(val))
        return isNaN(num) ? 0 : num
      }),
  })
  .superRefine((data, ctx) => {
    if (data.role === 'admin') return
    if (data.role === 'unload_clerk') {
      const multi = (data.site_ids || []).filter(Boolean)
      if (multi.length === 0 && !data.site_id) {
        ctx.addIssue({
          code: 'custom',
          message: 'Select at least one loading site for the unload clerk',
          path: ['site_ids'],
        })
      }
      return
    }
    if (!data.site_id) {
      ctx.addIssue({
        code: 'custom',
        message: 'A site is required for non-admin roles',
        path: ['site_id'],
      })
    }
  })

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
  if (!callerOrganizationId) {
    return NextResponse.json(
      { error: 'Caller has no organization_id on user_roles' },
      { status: 500 }
    )
  }

  const inactive = await assertOrganizationActive(supabase, callerOrganizationId)
  if (inactive) return inactive

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 })
  }

  const result = createUserSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      {
        error: result.error.issues
          .map((err) => (err.path.length ? `${err.path.join('.')}: ${err.message}` : err.message))
          .join('; '),
      },
      { status: 400 }
    )
  }

  const {
    email,
    password,
    role,
    site_id,
    site_ids,
    share_percent,
    employee_link_mode,
    employee_id,
    employee_name,
    employee_phone,
    employee_wage_type,
    employee_wage_rate
  } = result.data

  const resolvedSiteIds =
    role === 'unload_clerk'
      ? [...new Set([...(site_ids || []), ...(site_id ? [site_id] : [])].filter(Boolean) as string[])]
      : site_id
        ? [site_id]
        : []

  // Pre-validate sites belong to caller's org
  for (const sid of resolvedSiteIds) {
    const { data: siteData, error: siteError } = await supabase
      .from('sites')
      .select('organization_id')
      .eq('id', sid)
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
    p_site_id: resolvedSiteIds[0] || null,
    p_site_ids: role === 'unload_clerk' ? resolvedSiteIds : null,
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
    metadata: { email, role, site_id: resolvedSiteIds[0] || null, site_ids: resolvedSiteIds },
  })

  if (auditError) {
    console.error('Failed to create audit log for user creation:', auditError.message)
  }

  return NextResponse.json({ user_id: newUserId }, { status: 201 })
}
