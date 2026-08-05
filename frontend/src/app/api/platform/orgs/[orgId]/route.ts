import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePlatformOwner } from '@/lib/platform-auth'
import { FEATURE_KEYS } from '@/lib/features'

const patchOrgSchema = z.object({
  name: z.string().min(2).optional(),
  active: z.boolean().optional(),
  billing_admin_only: z.boolean().optional(),
  settlement_admin_only: z.boolean().optional(),
  quantity_unit: z.enum(['m3', 'unit']).optional(),
  units_per_m3: z.number().positive().optional(),
})

type Ctx = { params: Promise<{ orgId: string }> }

/** GET one org + features + admins */
export async function GET(req: NextRequest, ctx: Ctx) {
  const gate = await requirePlatformOwner(req)
  if (!gate.ok) return gate.response
  const { supabase } = gate
  const { orgId } = await ctx.params

  const { data: org, error } = await supabase
    .from('organizations')
    .select(
      'id, name, active, created_at, updated_at, billing_admin_only, settlement_admin_only, quantity_unit, units_per_m3'
    )
    .eq('id', orgId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  const { data: feats } = await supabase
    .from('organization_features')
    .select('feature_key, enabled, updated_at')
    .eq('organization_id', orgId)

  const { data: adminRoles } = await supabase
    .from('user_roles')
    .select('user_id, role, site_id, created_at')
    .eq('organization_id', orgId)
    .eq('role', 'admin')

  const admins = []
  for (const row of adminRoles || []) {
    const { data: u } = await supabase.auth.admin.getUserById(row.user_id)
    admins.push({
      user_id: row.user_id,
      email: u.user?.email ?? '',
      created_at: row.created_at,
      role: row.role,
    })
  }

  const features = Object.fromEntries(
    FEATURE_KEYS.map((k) => {
      const row = (feats || []).find((f) => f.feature_key === k)
      // Fail-closed: missing row = disabled (matches DB org_has_feature)
      return [k, row ? row.enabled : false]
    })
  )

  return NextResponse.json({ organization: org, features, admins, feature_rows: feats || [] })
}

/** PATCH org name / active */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await requirePlatformOwner(req)
  if (!gate.ok) return gate.response
  const { supabase, user } = gate
  const { orgId } = await ctx.params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = patchOrgSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 400 }
    )
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim()
  if (parsed.data.active !== undefined) updates.active = parsed.data.active
  if (parsed.data.billing_admin_only !== undefined) {
    updates.billing_admin_only = parsed.data.billing_admin_only
  }
  if (parsed.data.settlement_admin_only !== undefined) {
    updates.settlement_admin_only = parsed.data.settlement_admin_only
  }
  if (parsed.data.quantity_unit !== undefined) updates.quantity_unit = parsed.data.quantity_unit
  if (parsed.data.units_per_m3 !== undefined) updates.units_per_m3 = parsed.data.units_per_m3

  const { data, error } = await supabase
    .from('organizations')
    .update(updates)
    .eq('id', orgId)
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  await supabase.from('audit_logs').insert({
    organization_id: orgId,
    actor_user_id: user.id,
    action: 'platform_update_org',
    target_type: 'organization',
    target_id: orgId,
    metadata: parsed.data,
  })

  return NextResponse.json({ organization: data })
}

/** DELETE organization and all its data cascade */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const gate = await requirePlatformOwner(req)
  if (!gate.ok) return gate.response
  const { supabase } = gate
  const { orgId } = await ctx.params

  // 1. Get all members/users of the organization from user_roles
  const { data: members, error: membersError } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('organization_id', orgId)

  if (membersError) {
    return NextResponse.json({ error: `Failed to fetch organization users: ${membersError.message}` }, { status: 500 })
  }

  // 2. Call the cascade delete RPC
  const { error: deleteError } = await supabase.rpc('delete_organization_cascade', {
    p_organization_id: orgId,
  })

  if (deleteError) {
    return NextResponse.json({ error: `Database deletion failed: ${deleteError.message}` }, { status: 500 })
  }

  // 3. Delete auth users from Supabase Auth
  const deletedUsers: string[] = []
  const failedUsers: Array<{ id: string; error: string }> = []

  for (const m of members || []) {
    try {
      const { error: authError } = await supabase.auth.admin.deleteUser(m.user_id)
      if (authError) {
        failedUsers.push({ id: m.user_id, error: authError.message })
      } else {
        deletedUsers.push(m.user_id)
      }
    } catch (err: any) {
      failedUsers.push({ id: m.user_id, error: err.message || 'Unknown error' })
    }
  }

  return NextResponse.json({
    success: true,
    deleted_users_count: deletedUsers.length,
    failed_users: failedUsers,
  })
}

