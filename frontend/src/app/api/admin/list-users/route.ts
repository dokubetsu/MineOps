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

  // Check admin role in DB
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', callerData.user.id)
    .eq('role', 'admin')
  if (!roleData || roleData.length === 0) {
    return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 })
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

  const users = (usersData?.users || []).map(u => ({
    id: u.id,
    email: u.email ?? '',
    created_at: u.created_at,
  }))

  return NextResponse.json({ users }, { status: 200 })
}
