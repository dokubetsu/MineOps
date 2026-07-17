import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { serviceClient } from '@/lib/platform-auth'
import { passwordSchema } from '@/lib/password-policy'

const bootstrapSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  secret: z.string().optional(),
})

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
}

/**
 * One-time bootstrap: create the first platform_owner.
 * Only works when platform_roles has zero rows.
 *
 * Security (Phase A):
 * - In production / Vercel production: PLATFORM_BOOTSTRAP_SECRET is REQUIRED.
 * - Body.secret must match. After the first owner exists, this endpoint returns 409.
 * - Rotate or remove the secret from the host env after successful bootstrap.
 * - Local/dev may bootstrap without a secret (still rate-limited).
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

  if (isProduction()) {
    if (!requiredSecret) {
      return NextResponse.json(
        {
          error:
            'Platform bootstrap is locked: set PLATFORM_BOOTSTRAP_SECRET in the production environment, then retry with that secret. See docs/platform_owner_bootstrap.md.',
          code: 'BOOTSTRAP_SECRET_REQUIRED',
        },
        { status: 503 }
      )
    }
    if (parsed.data.secret !== requiredSecret) {
      return NextResponse.json(
        { error: 'Invalid bootstrap secret', code: 'BOOTSTRAP_SECRET_INVALID' },
        { status: 403 }
      )
    }
  } else if (requiredSecret && parsed.data.secret !== requiredSecret) {
    // Dev/preview: if secret is configured, enforce it
    return NextResponse.json(
      { error: 'Invalid bootstrap secret', code: 'BOOTSTRAP_SECRET_INVALID' },
      { status: 403 }
    )
  }

  let supabase
  try {
    supabase = serviceClient()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Config error'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const { count, error: countError } = await supabase
    .from('platform_roles')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    return NextResponse.json(
      {
        error:
          `Cannot access platform_roles: ${countError.message}. ` +
          'Apply migrations through 042 (supabase db push) first. See docs/DEPLOYMENT_CHECKLIST.md.',
      },
      { status: 500 }
    )
  }

  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          'A platform owner already exists. Sign in with that account. To add another operator, insert into platform_roles via SQL after creating the Auth user. Bootstrap is permanently closed once the first owner exists.',
        already_bootstrapped: true,
        code: 'ALREADY_BOOTSTRAPPED',
      },
      { status: 409 }
    )
  }

  const { email, password } = parsed.data
  let userId: string | null = null

  try {
    const { data: listed } = await supabase.auth.admin.listUsers({ perPage: 200 })
    const existing = listed?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    )

    if (existing) {
      userId = existing.id
      // Only reset password for bootstrap of empty platform — never for random emails once owners exist (already gated)
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

    // Atomic claim (advisory lock) — prevents concurrent bootstrap double-owner (Phase F / 046)
    const { error: roleError } = await supabase.rpc('claim_first_platform_owner', {
      p_user_id: userId,
    })
    if (roleError) {
      const msg = roleError.message || ''
      if (
        roleError.code === '23505' ||
        /already exists|unique_violation|duplicate/i.test(msg)
      ) {
        return NextResponse.json(
          {
            error:
              'A platform owner already exists. Sign in with that account. Bootstrap is closed.',
            already_bootstrapped: true,
            code: 'ALREADY_BOOTSTRAPPED',
          },
          { status: 409 }
        )
      }
      throw new Error(msg)
    }

    await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { platform_role: 'platform_owner' },
    })

    const { data: verify } = await supabase
      .from('platform_roles')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (!verify) {
      throw new Error(
        'platform_roles row was not found after insert. Apply migrations 036–042 and retry.'
      )
    }

    return NextResponse.json(
      {
        success: true,
        user_id: userId,
        email,
        message:
          'Platform owner created. Sign in at / with this email and password → /platform. ' +
          'Then rotate or remove PLATFORM_BOOTSTRAP_SECRET from the host environment.',
        next_steps: [
          'Sign in at /',
          'Open /platform and create organizations',
          'Rotate or delete PLATFORM_BOOTSTRAP_SECRET in Vercel/env',
        ],
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
    const prod = isProduction()
    const ownerCount = count ?? 0
    const available = ownerCount === 0

    // Production without secret: setup UI should show blocked (secret required)
    const blockedByMissingSecret = prod && !hasSecret && available

    return NextResponse.json({
      available: available && !blockedByMissingSecret,
      needs_migration: false,
      requires_secret: hasSecret || prod,
      owner_count: ownerCount,
      production: prod,
      blocked_by_missing_secret: blockedByMissingSecret,
      message: blockedByMissingSecret
        ? 'Set PLATFORM_BOOTSTRAP_SECRET in production env before first-time setup.'
        : ownerCount > 0
          ? 'Bootstrap closed — platform owner already exists.'
          : undefined,
    })
  } catch (err: unknown) {
    return NextResponse.json({
      available: false,
      error: err instanceof Error ? err.message : 'Config error',
    })
  }
}
