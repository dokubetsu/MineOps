import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { serviceClient } from '@/lib/platform-auth'
import { passwordSchema } from '@/lib/password-policy'

const bootstrapSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  secret: z.string().optional(),
  /**
   * When true, allow promoting an existing Auth user (password set only AFTER
   * exclusive claim succeeds). Default false — refuse existing emails so
   * bootstrap cannot reset arbitrary passwords before ownership is won.
   */
  force_existing: z.boolean().optional(),
})

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
}

/** Local Supabase only — preview/staging against a remote project must use a secret. */
function isLocalSupabaseUrl(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  return /localhost|127\.0\.0\.1/i.test(url)
}

function requiresBootstrapSecret(): boolean {
  return isProduction() || !isLocalSupabaseUrl() || !!process.env.VERCEL_ENV
}

/**
 * One-time bootstrap: create the first platform_owner.
 * Only works when platform_roles has zero rows.
 *
 * Security (Phase A + Phase 0):
 * - In production / Vercel production: PLATFORM_BOOTSTRAP_SECRET is REQUIRED.
 * - Body.secret must match. After the first owner exists, this endpoint returns 409.
 * - Existing Auth emails are refused unless force_existing=true.
 * - Password is never written for an existing user until claim_first_platform_owner succeeds.
 * - Newly created Auth users are rolled back if claim fails.
 * - Rotate or remove the secret from the host env after successful bootstrap.
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
  const mustHaveSecret = requiresBootstrapSecret()

  if (mustHaveSecret) {
    if (!requiredSecret) {
      return NextResponse.json(
        {
          error:
            'Platform bootstrap is locked: set PLATFORM_BOOTSTRAP_SECRET in the environment, then retry with that secret. See docs/platform_owner_bootstrap.md.',
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
          'Apply migrations through 053 (supabase db push) first. See docs/DEPLOYMENT_CHECKLIST.md.',
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

  const { email, password, force_existing: forceExisting } = parsed.data
  let userId: string | null = null
  let createdNewAuthUser = false

  try {
    // Page through Auth users — a single perPage:200 miss can allow duplicate email create
    let existing: { id: string; email?: string } | undefined
    let page = 1
    const perPage = 200
    for (;;) {
      const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({
        page,
        perPage,
      })
      if (listErr) {
        return NextResponse.json(
          { error: `Could not list Auth users: ${listErr.message}` },
          { status: 500 }
        )
      }
      const users = listed?.users || []
      existing = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
      if (existing || users.length < perPage) break
      page += 1
      // Safety: avoid unbounded loops on huge projects
      if (page > 50) break
    }

    if (existing) {
      if (!forceExisting) {
        return NextResponse.json(
          {
            error:
              'An Auth user with this email already exists. Use a new email, or pass force_existing: true to promote this user after a successful ownership claim (password is only set after claim).',
            code: 'EMAIL_ALREADY_EXISTS',
          },
          { status: 409 }
        )
      }
      userId = existing.id
      // Claim FIRST — never reset password before exclusive ownership
      const claimError = await claimOwner(supabase, userId)
      if (claimError) return claimError

      const { error: pwError } = await supabase.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        app_metadata: { platform_role: 'platform_owner' },
      })
      if (pwError) {
        // Ownership already claimed — surface password failure so operator can reset manually
        return NextResponse.json(
          {
            error: `Platform owner claimed but password update failed: ${pwError.message}. Sign-in may require a password reset in Supabase Auth.`,
            code: 'PASSWORD_UPDATE_AFTER_CLAIM',
            user_id: userId,
          },
          { status: 500 }
        )
      }
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
      createdNewAuthUser = true

      const claimError = await claimOwner(supabase, userId)
      if (claimError) {
        // Roll back orphan Auth user when claim loses the race
        try {
          await supabase.auth.admin.deleteUser(userId)
        } catch (rollbackErr) {
          console.error('Failed to roll back Auth user after bootstrap claim failure:', rollbackErr)
        }
        return claimError
      }

      await supabase.auth.admin.updateUserById(userId, {
        app_metadata: { platform_role: 'platform_owner' },
      })
    }

    const { data: verify } = await supabase
      .from('platform_roles')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (!verify) {
      if (createdNewAuthUser && userId) {
        try {
          await supabase.auth.admin.deleteUser(userId)
        } catch {
          /* ignore */
        }
      }
      throw new Error(
        'platform_roles row was not found after claim. Apply migrations 036–053 and retry.'
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

async function claimOwner(
  supabase: ReturnType<typeof serviceClient>,
  userId: string
): Promise<NextResponse | null> {
  const { error: roleError } = await supabase.rpc('claim_first_platform_owner', {
    p_user_id: userId,
  })
  if (!roleError) return null

  const msg = roleError.message || ''
  if (
    roleError.code === '23505' ||
    /already exists|unique_violation|duplicate|already has/i.test(msg)
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
  return NextResponse.json({ error: msg }, { status: 500 })
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
    const mustHaveSecret = requiresBootstrapSecret()
    const ownerCount = count ?? 0
    const available = ownerCount === 0

    const blockedByMissingSecret = mustHaveSecret && !hasSecret && available

    return NextResponse.json({
      available: available && !blockedByMissingSecret,
      needs_migration: false,
      requires_secret: hasSecret || mustHaveSecret,
      owner_count: ownerCount,
      production: prod,
      blocked_by_missing_secret: blockedByMissingSecret,
      message: blockedByMissingSecret
        ? 'Set PLATFORM_BOOTSTRAP_SECRET before first-time setup (required for non-local Supabase and production).'
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
