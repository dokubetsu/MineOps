import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePlatformOwner } from '@/lib/platform-auth'

const createAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

type Ctx = { params: Promise<{ orgId: string }> }

/** POST — add another tenant admin to an existing org (platform sets password) */
export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requirePlatformOwner(req)
  if (!gate.ok) return gate.response
  const { supabase, user: platformUser } = gate
  const { orgId } = await ctx.params

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, active')
    .eq('id', orgId)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  if (!org.active) {
    return NextResponse.json({ error: 'Organization is inactive' }, { status: 400 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createAdminSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 400 }
    )
  }

  const { email, password } = parsed.data
  let createdUserId: string | null = null

  try {
    const { data: newUser, error: userError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (userError || !newUser.user) {
      throw new Error(userError?.message || 'Failed to create user')
    }
    createdUserId = newUser.user.id

    const { error: roleError } = await supabase.from('user_roles').insert({
      user_id: createdUserId,
      role: 'admin',
      site_id: null,
      organization_id: orgId,
    })
    if (roleError) {
      throw new Error(roleError.message)
    }

    await supabase.from('audit_logs').insert({
      organization_id: orgId,
      actor_user_id: platformUser.id,
      action: 'platform_create_admin',
      target_type: 'user',
      target_id: createdUserId,
      metadata: { email, organization_id: orgId },
    })

    return NextResponse.json(
      { user_id: createdUserId, email, organization_id: orgId },
      { status: 201 }
    )
  } catch (err: unknown) {
    if (createdUserId) {
      try {
        await supabase.auth.admin.deleteUser(createdUserId)
      } catch { /* ignore */ }
    }
    const message = err instanceof Error ? err.message : 'Failed to create admin'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** GET — list tenant admins for org */
export async function GET(req: NextRequest, ctx: Ctx) {
  const gate = await requirePlatformOwner(req)
  if (!gate.ok) return gate.response
  const { supabase } = gate
  const { orgId } = await ctx.params

  const { data: adminRoles, error } = await supabase
    .from('user_roles')
    .select('user_id, created_at')
    .eq('organization_id', orgId)
    .eq('role', 'admin')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const admins = []
  for (const row of adminRoles || []) {
    const { data: u } = await supabase.auth.admin.getUserById(row.user_id)
    admins.push({
      user_id: row.user_id,
      email: u.user?.email ?? '',
      created_at: row.created_at,
    })
  }

  return NextResponse.json({ admins })
}
