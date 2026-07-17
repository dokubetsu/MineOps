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
  // Public registration is disabled unless an invite code is configured.
  // Optionally force-disable even when an invite is set.
  if (process.env.REGISTRATION_DISABLED === 'true') {
    return NextResponse.json(
      { error: 'Public registration is currently disabled.' },
      { status: 403 }
    )
  }

  const requiredInviteCode = process.env.REGISTRATION_INVITE_CODE?.trim()
  if (!requiredInviteCode) {
    return NextResponse.json(
      { error: 'Public registration is disabled. An invite code must be configured.' },
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 })
  }

  const inviteFromBody =
    body && typeof body === 'object' && 'inviteCode' in body
      ? String((body as { inviteCode?: unknown }).inviteCode ?? '')
      : ''

  if (inviteFromBody !== requiredInviteCode) {
    return NextResponse.json(
      { error: 'A valid registration invite code is required.' },
      { status: 403 }
    )
  }

  const result = registerTenantSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: result.error.issues.map(err => err.message).join(', ') },
      { status: 400 }
    )
  }

  const { companyName, email, password } = result.data

  let userId = ''

  try {
    // 1. Create the auth user FIRST (before any DB writes)
    const { data: newUser, error: userError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (userError || !newUser.user) {
      throw new Error(userError?.message || 'Failed to create user account')
    }

    userId = newUser.user.id

    // 2. Atomically create org + admin role via RPC (single Postgres transaction)
    // If either INSERT fails, the entire RPC rolls back — no orphaned orgs possible.
    const { data: orgId, error: rpcError } = await supabase.rpc('register_tenant', {
      p_company_name: companyName,
      p_user_id: userId,
    })

    if (rpcError || !orgId) {
      throw new Error(rpcError?.message || 'Failed to create organization')
    }

    return NextResponse.json({ success: true, organization_id: orgId, user_id: userId }, { status: 201 })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Registration failed'
    console.error('Registration failed, rolling back:', message)

    // Only need to clean up the auth user — the RPC either fully succeeded or fully rolled back
    if (userId) {
      try {
        await supabase.auth.admin.deleteUser(userId)
      } catch (err) {
        console.error('Rollback failed to delete user:', err)
      }
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
