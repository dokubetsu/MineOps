import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { Database } from './lib/supabase/database.types'

const rateLimitCache = new Map<string, { count: number; resetTime: number }>()

function isRateLimited(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const record = rateLimitCache.get(ip)

  if (!record || now > record.resetTime) {
    rateLimitCache.set(ip, { count: 1, resetTime: now + windowMs })
    return false
  }

  record.count++
  if (record.count > limit) {
    return true
  }
  return false
}

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  )
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase configuration error: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables')
  }

  const path = request.nextUrl.pathname

  if (
    path.startsWith('/api/admin/') ||
    path.startsWith('/api/platform/') ||
    path === '/api/auth/register-tenant'
  ) {
    const ip = clientIp(request)
    if (isRateLimited(ip, 60, 60 * 1000)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }
  }

  const supabase = createServerClient<Database>(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // First-time platform bootstrap is public (no session)
  const isPlatformSetup = path === '/platform/setup' || path.startsWith('/platform/setup/')
  const isPlatformBootstrapApi = path === '/api/platform/bootstrap'

  // ── Unauthenticated ────────────────────────────────────────────────────
  if (
    !user &&
    (path.startsWith('/dashboard') || (path.startsWith('/platform') && !isPlatformSetup)) &&
    !isPlatformBootstrapApi
  ) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/'
    return NextResponse.redirect(redirectUrl)
  }

  // ── Authenticated: resolve platform vs tenant ──────────────────────────
  if (user) {
    let isPlatformOwner = false
    // Table may be missing if migration 036 not applied — treat as non-owner
    const { data: pr, error: prError } = await supabase
      .from('platform_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'platform_owner')
      .maybeSingle()
    if (!prError) {
      isPlatformOwner = !!pr
    }

    // Login page → platform console or tenant dashboard
    if (path === '/') {
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = isPlatformOwner ? '/platform' : '/dashboard'
      return NextResponse.redirect(redirectUrl)
    }

    // Platform owners stay in /platform (not tenant dashboard), except setup
    if (isPlatformOwner && path.startsWith('/dashboard')) {
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/platform'
      return NextResponse.redirect(redirectUrl)
    }

    // Non-platform users: allow /platform UI to show "no access" + setup link
    // (do not hard-redirect away — that made /platform look broken)

    // Tenant role guards
    if (path.startsWith('/dashboard') && !isPlatformOwner) {
      let role = (user.app_metadata?.role as string) || null

      if (!role) {
        const { data: roleRows } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)

        const roles = roleRows?.map((r) => r.role) || []
        role = roles.includes('admin')
          ? 'admin'
          : roles.includes('site_manager')
            ? 'site_manager'
            : roles.includes('stakeholder')
              ? 'stakeholder'
              : roles.includes('employee')
                ? 'employee'
                : roles.includes('site_employee')
                  ? 'site_employee'
                  : null
      }

      if ((role === 'employee' || role === 'site_employee') && path !== '/dashboard/my-work') {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/dashboard/my-work'
        return NextResponse.redirect(redirectUrl)
      }

      if (role === 'stakeholder' && path !== '/dashboard/stakeholder') {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/dashboard/stakeholder'
        return NextResponse.redirect(redirectUrl)
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
