import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/admin/list-users
 * Returns auth users (id + email) for the caller's organization.
 * Requires admin or site_manager — verified server-side with the service role.
 *
 * Implementation note: do NOT rely solely on public.org_users (auth.users join
 * + security_invoker often fails under PostgREST grants). Prefer user_roles
 * + auth.admin APIs, with org_users as a best-effort fast path.
 */
export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'Internal Server Error: Missing Supabase configuration' },
      { status: 500 }
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const callerToken = authHeader.slice(7)
    const { data: callerData, error: callerError } = await supabase.auth.getUser(callerToken)
    if (callerError || !callerData.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: rolesData, error: rolesError } = await supabase
      .from('user_roles')
      .select('role, site_id, organization_id')
      .eq('user_id', callerData.user.id)

    if (rolesError) {
      return NextResponse.json(
        { error: `Failed to load roles: ${rolesError.message}` },
        { status: 500 }
      )
    }

    const roles = rolesData?.map((r) => r.role) || []
    const isAdmin = roles.includes('admin')
    const isSiteManager = roles.includes('site_manager')

    if (!isAdmin && !isSiteManager) {
      return NextResponse.json({ error: 'Forbidden: admin or site manager only' }, { status: 403 })
    }

    // Prefer admin org, then site_manager org (rolesData has no guaranteed order)
    const callerOrganizationId =
      rolesData?.find((r) => r.role === 'admin')?.organization_id ??
      rolesData?.find((r) => r.role === 'site_manager')?.organization_id ??
      rolesData?.[0]?.organization_id ??
      null

    if (!callerOrganizationId) {
      return NextResponse.json(
        { error: 'Caller has no organization_id on user_roles — cannot list org users' },
        { status: 500 }
      )
    }

    const { searchParams } = new URL(req.url)
    const pageParam = parseInt(searchParams.get('page') || '1', 10)
    const perPageParam = parseInt(searchParams.get('perPage') || '1000', 10)
    const page = Number.isNaN(pageParam) || pageParam < 1 ? 1 : pageParam
    const perPage =
      Number.isNaN(perPageParam) || perPageParam < 1 || perPageParam > 1000 ? 1000 : perPageParam

    // ── Load role rows for this organization (source of truth for membership) ──
    let rolesQuery = supabase
      .from('user_roles')
      .select('user_id, role, site_id, organization_id')
      .eq('organization_id', callerOrganizationId)

    if (isSiteManager && !isAdmin) {
      const managedSiteIds =
        rolesData
          ?.filter((r) => r.role === 'site_manager' && r.site_id)
          .map((r) => r.site_id as string) || []

      if (managedSiteIds.length > 0) {
        // Site managers see users assigned to their sites + themselves
        rolesQuery = rolesQuery.or(
          `site_id.in.(${managedSiteIds.join(',')}),user_id.eq.${callerData.user.id}`
        )
      } else {
        rolesQuery = rolesQuery.eq('user_id', callerData.user.id)
      }
    }

    const { data: orgRoleRows, error: orgRolesError } = await rolesQuery.limit(5000)
    if (orgRolesError) {
      return NextResponse.json(
        { error: `Failed to load organization roles: ${orgRolesError.message}` },
        { status: 500 }
      )
    }

    const userIds = Array.from(new Set((orgRoleRows || []).map((r) => r.user_id).filter(Boolean)))

    if (userIds.length === 0) {
      return NextResponse.json({ users: [] }, { status: 200 })
    }

    // ── Resolve emails via Auth Admin API (reliable; does not need org_users) ──
    const uniqueUsersMap = new Map<string, { id: string; email: string; created_at: string }>()

    // Batch via listUsers pages when org is large; otherwise per-id lookup for precision
    if (userIds.length <= 50) {
      await Promise.all(
        userIds.map(async (uid) => {
          const { data, error } = await supabase.auth.admin.getUserById(uid)
          if (error || !data.user) return
          uniqueUsersMap.set(uid, {
            id: uid,
            email: data.user.email ?? '',
            created_at: data.user.created_at ?? new Date(0).toISOString(),
          })
        })
      )
    } else {
      // Paginate auth users and keep those in the org allow-list
      const allow = new Set(userIds)
      let authPage = 1
      const authPerPage = 200
      // Cap pages to avoid runaway scans
      for (let i = 0; i < 25 && uniqueUsersMap.size < allow.size; i++) {
        const { data, error } = await supabase.auth.admin.listUsers({
          page: authPage,
          perPage: authPerPage,
        })
        if (error) {
          return NextResponse.json(
            { error: `Failed to list auth users: ${error.message}` },
            { status: 500 }
          )
        }
        const batch = data?.users || []
        if (batch.length === 0) break
        for (const u of batch) {
          if (allow.has(u.id)) {
            uniqueUsersMap.set(u.id, {
              id: u.id,
              email: u.email ?? '',
              created_at: u.created_at ?? new Date(0).toISOString(),
            })
          }
        }
        if (batch.length < authPerPage) break
        authPage++
      }
    }

    // Include any role user we failed to resolve with a placeholder email
    for (const uid of userIds) {
      if (!uniqueUsersMap.has(uid)) {
        uniqueUsersMap.set(uid, {
          id: uid,
          email: '',
          created_at: new Date(0).toISOString(),
        })
      }
    }

    let users = Array.from(uniqueUsersMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

    // Apply page/perPage over the final list
    const from = (page - 1) * perPage
    users = users.slice(from, from + perPage)

    return NextResponse.json({ users }, { status: 200 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[list-users] unexpected error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
