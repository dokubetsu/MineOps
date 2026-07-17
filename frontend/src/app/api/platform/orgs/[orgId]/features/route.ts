import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePlatformOwner } from '@/lib/platform-auth'
import { FEATURE_KEYS } from '@/lib/features'

const updateFeaturesSchema = z.object({
  features: z.record(z.string(), z.boolean()),
})

type Ctx = { params: Promise<{ orgId: string }> }

/** PUT — set feature flags for an organization */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const gate = await requirePlatformOwner(req)
  if (!gate.ok) return gate.response
  const { supabase, user } = gate
  const { orgId } = await ctx.params

  const { data: org } = await supabase.from('organizations').select('id').eq('id', orgId).maybeSingle()
  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updateFeaturesSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid features payload' }, { status: 400 })
  }

  // Ensure all feature rows exist
  await supabase.rpc('seed_organization_features', { p_organization_id: orgId })

  const now = new Date().toISOString()
  const updates: Array<{ key: string; enabled: boolean }> = []

  for (const [key, enabled] of Object.entries(parsed.data.features)) {
    if (!(FEATURE_KEYS as readonly string[]).includes(key)) continue
    const { error } = await supabase
      .from('organization_features')
      .update({
        enabled: !!enabled,
        updated_at: now,
        updated_by: user.id,
      })
      .eq('organization_id', orgId)
      .eq('feature_key', key)

    if (error) {
      return NextResponse.json(
        { error: `Failed to update ${key}: ${error.message}` },
        { status: 500 }
      )
    }
    updates.push({ key, enabled: !!enabled })
  }

  await supabase.from('audit_logs').insert({
    organization_id: orgId,
    actor_user_id: user.id,
    action: 'platform_update_features',
    target_type: 'organization',
    target_id: orgId,
    metadata: { updates },
  })

  const { data: feats } = await supabase
    .from('organization_features')
    .select('feature_key, enabled')
    .eq('organization_id', orgId)

  // Fail-closed: missing row = disabled (matches GET org, list orgs, DB org_has_feature)
  const features = Object.fromEntries(
    FEATURE_KEYS.map((k) => {
      const row = (feats || []).find((f) => f.feature_key === k)
      return [k, row ? row.enabled : false]
    })
  )

  return NextResponse.json({ features })
}
