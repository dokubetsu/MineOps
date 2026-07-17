import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/admin/list-users
 * Returns all auth users with their id + email, for display in User Access page.
 * Requires admin role — verified server-side using the service key.
 */
export async function GET(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Internal Server Error: Missing Supabase configuration' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Verify caller is an authenticated admin
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const callerToken = authHeader.slice(7)
  const { data: callerData, error: callerError } = await supabase.auth.getUser(callerToken)
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check user roles in DB
  const { data: rolesData } = await supabase
    .from('user_roles')
    .select('role, site_id, organization_id')
    .eq('user_id', callerData.user.id)

  const roles = rolesData?.map(r => r.role) || []
  const isAdmin = roles.includes('admin')
  const isSiteManager = roles.includes('site_manager')

  if (!isAdmin && !isSiteManager) {
    return NextResponse.json({ error: 'Forbidden: admin or site manager only' }, { status: 403 })
  }
  const callerOrganizationId = rolesData?.[0]?.organization_id

  // auth.admin.listUsers() below returns every user in the entire Supabase
  // project — Auth itself has no concept of organization — so this allow-list
  // is the only thing standing between "admin" and "every user across every
  // tenant". Every branch below is scoped to the caller's own organization_id.
  const allowedUserIds = new Set<string>()
  if (isAdmin) {
    const { data: orgUsers } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('organization_id', callerOrganizationId)
    for (const row of orgUsers || []) allowedUserIds.add(row.user_id)
  } else if (isSiteManager) {
    const managedSiteIds = rolesData
      ?.filter(r => r.role === 'site_manager' && r.site_id)
      .map(r => r.site_id) || []

    if (managedSiteIds.length > 0) {
      const { data: siteUsers } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('organization_id', callerOrganizationId)
        .or(`site_id.in.(${managedSiteIds.join(',')}),role.eq.admin`)

      if (siteUsers) {
        for (const row of siteUsers) {
          allowedUserIds.add(row.user_id)
        }
      }
    } else {
      const { data: siteUsers } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('organization_id', callerOrganizationId)
        .eq('role', 'admin')

      if (siteUsers) {
        for (const row of siteUsers) {
          allowedUserIds.add(row.user_id)
        }
      }
    }
    allowedUserIds.add(callerData.user.id)
  }

  // Parse query parameters for pagination
  const { searchParams } = new URL(req.url)
  const pageParam = parseInt(searchParams.get('page') || '1')
  const perPageParam = parseInt(searchParams.get('perPage') || '1000')

  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam
  const perPage = isNaN(perPageParam) || perPageParam < 1 || perPageParam > 1000 ? 1000 : perPageParam

  // Fetch users from auth.users (service key required)
  const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers({
    page,
    perPage,
  })
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 })
  }

  const users = (usersData?.users || [])
    .filter(u => allowedUserIds.has(u.id))
    .map(u => ({
      id: u.id,
      email: u.email ?? '',
      created_at: u.created_at,
    }))

  return NextResponse.json({ users }, { status: 200 })
}
