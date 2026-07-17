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
  // Parse query parameters for pagination
  const { searchParams } = new URL(req.url)
  const pageParam = parseInt(searchParams.get('page') || '1')
  const perPageParam = parseInt(searchParams.get('perPage') || '1000')

  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam
  const perPage = isNaN(perPageParam) || perPageParam < 1 || perPageParam > 1000 ? 1000 : perPageParam

  // Fetch users from public.org_users view
  let query = supabase
    .from('org_users')
    .select('id, email, created_at, role, site_id')
    .eq('organization_id', callerOrganizationId)

  if (isSiteManager) {
    const managedSiteIds = rolesData
      ?.filter(r => r.role === 'site_manager' && r.site_id)
      .map(r => r.site_id) || []

    if (managedSiteIds.length > 0) {
      query = query.or(`site_id.in.(${managedSiteIds.join(',')}),id.eq.${callerData.user.id}`)
    } else {
      query = query.eq('id', callerData.user.id)
    }
  }

  const from = (page - 1) * perPage
  const to = from + perPage - 1

  const { data: usersData, error: usersError } = await query
    .range(from, to)
    .order('created_at', { ascending: false })

  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 })
  }

  // Deduplicate user records in case they have multiple roles
  const uniqueUsersMap = new Map<string, { id: string; email: string; created_at: string }>()
  for (const u of usersData || []) {
    uniqueUsersMap.set(u.id, {
      id: u.id,
      email: u.email ?? '',
      created_at: u.created_at,
    })
  }

  const users = Array.from(uniqueUsersMap.values())

  return NextResponse.json({ users }, { status: 200 })
}
