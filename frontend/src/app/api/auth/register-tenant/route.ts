import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const registerTenantSchema = z.object({
  companyName: z.string().min(2, 'Company name must be at least 2 characters long'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  inviteCode: z.string().optional(),
})

export async function POST(req: NextRequest) {
  // Check if registration is explicitly disabled
  if (process.env.REGISTRATION_DISABLED === 'true') {
    return NextResponse.json(
      { error: 'Public registration is currently disabled.' },
      { status: 403 }
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'Internal Server Error: Missing Supabase environment variables' },
      { status: 500 }
    )
  }

  // Admin client to bypass RLS during registration
  const supabase = createClient(
    supabaseUrl,
    serviceKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  let body: any
  try {
    body = await req.json()
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 })
  }

  // Verify invite code if required by the environment
  const requiredInviteCode = process.env.REGISTRATION_INVITE_CODE
  if (requiredInviteCode && requiredInviteCode.trim() !== '') {
    if (!body?.inviteCode || body.inviteCode !== requiredInviteCode) {
      return NextResponse.json(
        { error: 'A valid registration invite code is required.' },
        { status: 403 }
      )
    }
  }

  const result = registerTenantSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues.map(err => err.message).join(', ') },
      { status: 400 }
    )
  }

  const { companyName, email, password } = result.data

  let orgId = ''
  let userId = ''

  try {
    // 1. Create the organization row
    const { data: newOrg, error: orgError } = await supabase
      .from('organizations')
      .insert({ name: companyName, active: true })
      .select('id')
      .single()

    if (orgError || !newOrg) {
      throw new Error(orgError?.message || 'Failed to create organization')
    }

    orgId = newOrg.id

    // 2. Create the user inside Supabase Auth
    const { data: newUser, error: userError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (userError || !newUser.user) {
      throw new Error(userError?.message || 'Failed to create user account')
    }

    userId = newUser.user.id

    // 3. Insert the admin role row
    const { error: roleError } = await supabase.from('user_roles').insert({
      user_id: userId,
      role: 'admin',
      site_id: null,
      organization_id: orgId,
    })

    if (roleError) {
      throw new Error(`Failed to assign admin role: ${roleError.message}`)
    }

    return NextResponse.json({ success: true, organization_id: orgId, user_id: userId }, { status: 201 })

  } catch (error: any) {
    console.error('Registration transaction failed, rolling back:', error.message)
    
    // Clean rollback
    if (userId) {
      try {
        await supabase.auth.admin.deleteUser(userId)
      } catch (err) {
        console.error('Rollback failed to delete user:', err)
      }
    }
    if (orgId) {
      try {
        await supabase.from('organizations').delete().eq('id', orgId)
      } catch (err) {
        console.error('Rollback failed to delete organization:', err)
      }
    }

    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
