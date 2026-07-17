import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// Zod schema for validating the incoming request body
const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  role: z.enum(['admin', 'site_manager', 'stakeholder', 'employee', 'site_employee']),
  site_id: z.string().uuid('Invalid site ID format').nullable().optional(),
  share_percent: z.union([z.number(), z.string()]).transform((val) => {
    const num = parseFloat(String(val))
    return isNaN(num) ? 50 : num
  }).optional(),
  employee_link_mode: z.enum(['link', 'create', 'none']).optional(),
  employee_id: z.string().uuid('Invalid employee ID').nullable().optional(),
  employee_name: z.string().optional(),
  employee_phone: z.string().optional(),
  employee_wage_type: z.string().optional(),
  employee_wage_rate: z.union([z.number(), z.string()]).transform((val) => {
    const num = parseFloat(String(val))
    return isNaN(num) ? 0 : num
  }).optional(),
}).refine(
  (data) => data.role === 'admin' || !!data.site_id,
  { message: 'A site is required for non-admin roles', path: ['site_id'] }
)

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
  
  // Check admin role, and capture the caller's own organization — the new
  // user is always created inside the caller's org, never a client-supplied
  // one (the request body has no organization_id field at all).
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role, organization_id')
    .eq('user_id', callerData.user.id)
    .eq('role', 'admin')
  if (!roleData || roleData.length === 0) {
    return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 })
  }
  const callerOrganizationId = roleData[0].organization_id

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

  const { 
    email, 
    password, 
    role, 
    site_id, 
    share_percent,
    employee_link_mode,
    employee_id,
    employee_name,
    employee_phone,
    employee_wage_type,
    employee_wage_rate
  } = result.data

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

  // Assign role, scoped to the caller's own organization
  const { error: roleError } = await supabase.from('user_roles').insert({
    user_id: newUserId,
    role,
    site_id: site_id || null,
    organization_id: callerOrganizationId,
  })

  if (roleError) {
    // Role assignment failed — don't leave behind an auth user with no role,
    // since that produces a login that "succeeds" but has no permissions
    // anywhere in the app (empty nav, RLS blocks every table).
    await supabase.auth.admin.deleteUser(newUserId)
    return NextResponse.json({ error: `Failed to assign role: ${roleError.message}` }, { status: 500 })
  }

  // If stakeholder with site, add access record (include organization_id for org-match trigger)
  if (role === 'stakeholder' && site_id) {
    const { error: accessError } = await supabase.from('stakeholder_site_access').insert({
      stakeholder_user_id: newUserId,
      site_id,
      share_percent: share_percent ?? 50,
      organization_id: callerOrganizationId,
    })

    if (accessError) {
      return NextResponse.json(
        { error: `User created with role, but failed to grant site access: ${accessError.message}`, user_id: newUserId },
        { status: 207 }
      )
    }
  }

  // Handle employee linkage/creation
  if ((role === 'employee' || role === 'site_employee') && employee_link_mode && employee_link_mode !== 'none') {
    if (employee_link_mode === 'link' && employee_id) {
      // Validate the target employee belongs to the caller's organization
      // before linking, to prevent cross-org employee impersonation.
      const { data: empData } = await supabase
        .from('employees')
        .select('id, site_id, sites!inner(organization_id)')
        .eq('id', employee_id)
        .single()

      if (!empData || (empData as any).sites?.organization_id !== callerOrganizationId) {
        return NextResponse.json(
          { error: 'Cannot link employee: employee does not belong to your organization', user_id: newUserId },
          { status: 207 }
        )
      }

      const { error: linkError } = await supabase
        .from('employees')
        .update({ user_id: newUserId })
        .eq('id', employee_id)
      
      if (linkError) {
        console.error('Failed to link employee:', linkError)
      }
    } else if (employee_link_mode === 'create' && employee_name) {
      const { error: createEmpError } = await supabase
        .from('employees')
        .insert({
          name: employee_name,
          phone: employee_phone || null,
          role: 'Site Employee',
          site_id: site_id,
          wage_type: employee_wage_type || 'monthly',
          wage_rate: employee_wage_rate ?? 0,
          user_id: newUserId,
          active: true,
          leave_balance: 0
        })

      if (createEmpError) {
        console.error('Failed to create employee profile:', createEmpError)
      }
    }
  }

  return NextResponse.json({ user_id: newUserId }, { status: 201 })
}
