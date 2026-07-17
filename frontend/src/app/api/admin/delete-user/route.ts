import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

/**
 * POST /api/admin/delete-user
 * Fully revoke a tenant user: stakeholder access, roles, employee link, Auth user.
 * Admin-only; target must belong to caller's organization; cannot delete self.
 */
const bodySchema = z.object({
  user_id: z.string().uuid('Invalid user id'),
})

async function cleanupTenantUser(
  supabase: SupabaseClient,
  userId: string,
  organizationId: string
): Promise<void> {
  // Order: dependent rows first, then roles, then Auth
  await supabase
    .from('stakeholder_site_access')
    .delete()
    .eq('stakeholder_user_id', userId)
    .eq('organization_id', organizationId)

  // Some DBs may lack organization_id filter path — also delete by user for safety within org roles
  await supabase.from('stakeholder_site_access').delete().eq('stakeholder_user_id', userId)

  await supabase.from('employees').update({ user_id: null }).eq('user_id', userId)

  const { error: rolesError } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .eq('organization_id', organizationId)

  if (rolesError) {
    throw new Error(`Failed to revoke roles: ${rolesError.message}`)
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

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const callerToken = authHeader.slice(7)
  const { data: callerData, error: callerError } = await supabase.auth.getUser(callerToken)
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role, organization_id')
    .eq('user_id', callerData.user.id)
    .eq('role', 'admin')

  if (!roleData || roleData.length === 0) {
    return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }
  const callerOrganizationId = roleData[0].organization_id as string

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 400 }
    )
  }

  const targetUserId = parsed.data.user_id

  if (targetUserId === callerData.user.id) {
    return NextResponse.json(
      { error: 'You cannot remove your own account. Ask another admin or the platform operator.' },
      { status: 400 }
    )
  }

  // Target must have at least one role in caller's org
  const { data: targetRoles, error: targetErr } = await supabase
    .from('user_roles')
    .select('id, role, organization_id')
    .eq('user_id', targetUserId)
    .eq('organization_id', callerOrganizationId)

  if (targetErr) {
    return NextResponse.json({ error: targetErr.message }, { status: 500 })
  }
  if (!targetRoles || targetRoles.length === 0) {
    return NextResponse.json(
      { error: 'User is not a member of your organization' },
      { status: 404 }
    )
  }

  // Refuse if target is a platform owner
  const { data: platformRow } = await supabase
    .from('platform_roles')
    .select('user_id')
    .eq('user_id', targetUserId)
    .maybeSingle()
  if (platformRow) {
    return NextResponse.json(
      { error: 'Cannot delete a platform operator from the tenant console' },
      { status: 403 }
    )
  }

  try {
    await cleanupTenantUser(supabase, targetUserId, callerOrganizationId)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to revoke access'
    // Last-admin trigger surfaces here
    if (/last admin|at least one admin/i.test(message)) {
      return NextResponse.json(
        {
          error:
            'Cannot remove the last admin for this organization. Promote another user to admin first.',
          code: 'LAST_ADMIN',
        },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Best-effort Auth delete (roles already gone — orphan cleanup)
  const { error: authDeleteError } = await supabase.auth.admin.deleteUser(targetUserId)
  if (authDeleteError) {
    console.error('[delete-user] Auth delete failed after role revoke:', authDeleteError.message)
    await supabase.from('audit_logs').insert({
      organization_id: callerOrganizationId,
      actor_user_id: callerData.user.id,
      action: 'delete_user_partial',
      target_type: 'user',
      target_id: targetUserId,
      metadata: {
        roles_revoked: true,
        auth_deleted: false,
        auth_error: authDeleteError.message,
      },
    })
    return NextResponse.json(
      {
        success: true,
        partial: true,
        warning:
          'Access revoked in the organization, but Auth user deletion failed. Remove the Auth user in Supabase if needed.',
        user_id: targetUserId,
      },
      { status: 200 }
    )
  }

  await supabase.from('audit_logs').insert({
    organization_id: callerOrganizationId,
    actor_user_id: callerData.user.id,
    action: 'delete_user',
    target_type: 'user',
    target_id: targetUserId,
    metadata: { roles_revoked: true, auth_deleted: true },
  })

  return NextResponse.json({ success: true, user_id: targetUserId }, { status: 200 })
}
