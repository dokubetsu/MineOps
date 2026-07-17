import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePlatformOwner } from '@/lib/platform-auth'
import { FEATURE_KEYS, type FeatureKey } from '@/lib/features'
import { passwordSchema } from '@/lib/password-policy'

const createOrgSchema = z.object({
  companyName: z.string().min(2, 'Company name must be at least 2 characters'),
  adminEmail: z.string().email('Invalid admin email'),
  adminPassword: passwordSchema,
  /** Optional feature overrides; omitted keys default to enabled */
  features: z.record(z.string(), z.boolean()).optional(),
})

/** GET — list all organizations with feature summary */
export async function GET(req: NextRequest) {
  const gate = await requirePlatformOwner(req)
  if (!gate.ok) return gate.response
  const { supabase } = gate

  const { data: orgs, error } = await supabase
    .from('organizations')
    .select('id, name, active, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const orgIds = (orgs || []).map((o) => o.id)
  let featureRows: Array<{ organization_id: string; feature_key: string; enabled: boolean }> = []
  if (orgIds.length > 0) {
    const { data: feats, error: featError } = await supabase
      .from('organization_features')
      .select('organization_id, feature_key, enabled')
      .in('organization_id', orgIds)
    if (featError) {
      return NextResponse.json({ error: featError.message }, { status: 500 })
    }
    featureRows = feats || []
  }

  // Count tenant admins per org
  const { data: adminRoles } = await supabase
    .from('user_roles')
    .select('organization_id, user_id')
    .eq('role', 'admin')
    .in('organization_id', orgIds.length ? orgIds : ['00000000-0000-0000-0000-000000000000'])

  const adminCountByOrg = new Map<string, number>()
  for (const r of adminRoles || []) {
    adminCountByOrg.set(r.organization_id, (adminCountByOrg.get(r.organization_id) || 0) + 1)
  }

  const result = (orgs || []).map((org) => {
    const feats = featureRows.filter((f) => f.organization_id === org.id)
    const enabledCount = feats.filter((f) => f.enabled).length
    return {
      ...org,
      admin_count: adminCountByOrg.get(org.id) || 0,
      features_enabled: enabledCount,
      features_total: FEATURE_KEYS.length,
      features: Object.fromEntries(
        FEATURE_KEYS.map((k) => {
          const row = feats.find((f) => f.feature_key === k)
          return [k, row ? row.enabled : true]
        })
      ),
    }
  })

  return NextResponse.json({ organizations: result })
}

/** POST — create organization + first tenant admin + seed features */
export async function POST(req: NextRequest) {
  const gate = await requirePlatformOwner(req)
  if (!gate.ok) return gate.response
  const { supabase, user: platformUser } = gate

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createOrgSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 400 }
    )
  }

  const { companyName, adminEmail, adminPassword, features: featureOverrides } = parsed.data
  let createdUserId: string | null = null
  let createdOrgId: string | null = null

  try {
    // 1) Auth user for tenant admin
    const { data: newUser, error: userError } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    })
    if (userError || !newUser.user) {
      throw new Error(userError?.message || 'Failed to create admin user')
    }
    createdUserId = newUser.user.id

    // 2) Atomic org + admin role
    const { data: orgId, error: rpcError } = await supabase.rpc('register_tenant', {
      p_company_name: companyName,
      p_user_id: createdUserId,
    })
    if (rpcError || !orgId) {
      throw new Error(rpcError?.message || 'Failed to create organization')
    }
    createdOrgId = orgId as string

    // 3) Seed default features (all on)
    const { error: seedError } = await supabase.rpc('seed_organization_features', {
      p_organization_id: createdOrgId,
    })
    if (seedError) {
      throw new Error(`Org created but feature seed failed: ${seedError.message}`)
    }

    // 4) Apply optional overrides
    if (featureOverrides) {
      for (const [key, enabled] of Object.entries(featureOverrides)) {
        if (!(FEATURE_KEYS as readonly string[]).includes(key)) continue
        await supabase
          .from('organization_features')
          .update({
            enabled: !!enabled,
            updated_at: new Date().toISOString(),
            updated_by: platformUser.id,
          })
          .eq('organization_id', createdOrgId)
          .eq('feature_key', key as FeatureKey)
      }
    }

    // 5) Audit
    await supabase.from('audit_logs').insert({
      organization_id: createdOrgId,
      actor_user_id: platformUser.id,
      action: 'platform_create_org',
      target_type: 'organization',
      target_id: createdOrgId,
      metadata: { companyName, adminEmail, admin_user_id: createdUserId },
    })

    return NextResponse.json(
      {
        organization_id: createdOrgId,
        admin_user_id: createdUserId,
        admin_email: adminEmail,
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create organization'
    // Best-effort rollback
    if (createdOrgId) {
      try {
        await supabase.from('organizations').delete().eq('id', createdOrgId)
      } catch { /* ignore */ }
    }
    if (createdUserId) {
      try {
        await supabase.auth.admin.deleteUser(createdUserId)
      } catch { /* ignore */ }
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
