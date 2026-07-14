import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// Zod schema for validating the incoming request body
const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  role: z.enum(['admin', 'site_manager', 'stakeholder']),
  site_id: z.string().uuid('Invalid site ID format').nullable().optional(),
  share_percent: z.union([z.number(), z.string()]).transform((val) => {
    const num = parseFloat(String(val))
    return isNaN(num) ? 50 : num
  }).optional(),
})

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'Internal Server Error: Missing Supabase environment variables' },
      { status: 500 }
    )
  }

  const supabase = createClient(
    supabaseUrl,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Verify the caller is an authenticated admin
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const callerToken = authHeader.slice(7)
  const { data: callerData, error: callerError } = await supabase.auth.getUser(callerToken)
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  // Check admin role
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', callerData.user.id)
    .eq('role', 'admin')
  if (!roleData || roleData.length === 0) {
    return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }

  // Parse and validate req.json() using Zod schema
  let body: any
  try {
    body = await req.json()
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 })
  }

  const result = createUserSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues.map(err => err.message).join(', ') },
      { status: 400 }
    )
  }

  const { email, password, role, site_id, share_percent } = result.data

  // Create the user without sending a confirmation email
  const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError || !newUser.user) {
    return NextResponse.json({ error: createError?.message || 'Failed to create user' }, { status: 400 })
  }

  const newUserId = newUser.user.id

  // Assign role
  await supabase.from('user_roles').insert({
    user_id: newUserId,
    role,
    site_id: site_id || null,
  })

  // If stakeholder with site, add access record
  if (role === 'stakeholder' && site_id) {
    await supabase.from('stakeholder_site_access').insert({
      stakeholder_user_id: newUserId,
      site_id,
      share_percent: share_percent ?? 50,
    })
  }

  return NextResponse.json({ user_id: newUserId }, { status: 201 })
}
