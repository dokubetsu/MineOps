import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePlatformOwner } from '@/lib/platform-auth'
import { FEATURE_KEYS } from '@/lib/features'

const patchOrgSchema = z.object({
  name: z.string().min(2).optional(),
  active: z.boolean().optional(),
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
    .select('id, name, active, created_at, updated_at')
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
      return [k, row ? row.enabled : true]
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
