import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { serviceClient } from '@/lib/platform-auth'

const bootstrapSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  secret: z.string().optional(),
})

/**
 * One-time bootstrap: create the first platform_owner.
 * Only works when platform_roles has zero rows.
 *
 * Optional env PLATFORM_BOOTSTRAP_SECRET — if set, body.secret must match.
 * After bootstrap, remove or rotate the secret; this endpoint becomes a no-op.
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bootstrapSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join(', ') },
      { status: 400 }
    )
  }

  const requiredSecret = process.env.PLATFORM_BOOTSTRAP_SECRET?.trim()
  if (requiredSecret) {
    if (parsed.data.secret !== requiredSecret) {
      return NextResponse.json({ error: 'Invalid bootstrap secret' }, { status: 403 })
    }
  }

  let supabase
  try {
    supabase = serviceClient()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Config error'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Table may not exist if migration 036 not applied
  const { count, error: countError } = await supabase
    .from('platform_roles')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    return NextResponse.json(
      {
        error:
          `Cannot access platform_roles: ${countError.message}. ` +
          'Apply migration 036_platform_owner_and_org_features.sql (supabase db push) first.',
      },
      { status: 500 }
    )
  }

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          'A platform owner already exists. Sign in with that account, or add another via SQL: INSERT INTO platform_roles (user_id, role) VALUES (...).',
        already_bootstrapped: true,
      },
      { status: 409 }
    )
  }

  const { email, password } = parsed.data
  let userId: string | null = null

  try {
    // Reuse existing auth user with this email if present
    const { data: listed } = await supabase.auth.admin.listUsers({ perPage: 200 })
    const existing = listed?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    )

    if (existing) {
      userId = existing.id
      await supabase.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
      })
    } else {
      const { data: created, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { platform_role: 'platform_owner' },
      })
      if (createError || !created.user) {
        throw new Error(createError?.message || 'Failed to create auth user')
      }
      userId = created.user.id
    }

    const { error: roleError } = await supabase.from('platform_roles').insert({
      user_id: userId,
      role: 'platform_owner',
    })
    if (roleError) {
      throw new Error(roleError.message)
    }

    // Stamp app_metadata for convenience (proxy still uses platform_roles table)
    await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { platform_role: 'platform_owner' },
    })

    return NextResponse.json(
      {
        success: true,
        user_id: userId,
        email,
        message: 'Platform owner created. Sign in at / with this email and password, then open /platform.',
      },
      { status: 201 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Bootstrap failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** GET — is bootstrap still available? */
export async function GET() {
  try {
    const supabase = serviceClient()
    const { count, error } = await supabase
      .from('platform_roles')
      .select('*', { count: 'exact', head: true })

    if (error) {
      return NextResponse.json({
        available: false,
        needs_migration: true,
        error: error.message,
      })
    }

    const hasSecret = !!(process.env.PLATFORM_BOOTSTRAP_SECRET?.trim())
    return NextResponse.json({
      available: (count ?? 0) === 0,
      needs_migration: false,
      requires_secret: hasSecret,
      owner_count: count ?? 0,
    })
  } catch (err: unknown) {
    return NextResponse.json({
      available: false,
      error: err instanceof Error ? err.message : 'Config error',
    })
  }
}
