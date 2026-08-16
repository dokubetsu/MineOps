import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { Database } from './lib/supabase/database.types'
import { checkRateLimit, pruneRateLimitStore } from './lib/rate-limit'
import { featureForPath } from './lib/features'
import { buildContentSecurityPolicy } from './lib/csp'
import { fetchSessionContext } from './lib/session-context'
import { pickPrimaryRole } from './lib/trip-ops-policy'

export function clientIp(request: NextRequest): string {
  const vercelIp = request.headers.get('x-vercel-forwarded-for')
  if (vercelIp) return vercelIp.split(',')[0].trim()

  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp.trim()

  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }

  return '127.0.0.1'
}

/** Ensure CSP is set at request time (CI production + local Supabase). */
function withCsp(response: NextResponse): NextResponse {
  response.headers.set('Content-Security-Policy', buildContentSecurityPolicy())
  return response
}

let requestsSincePrune = 0
const PRUNE_INTERVAL = 100

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
    // Phase E5: Upstash when configured; else in-memory (see lib/rate-limit.ts).
    // Prune expired entries deterministically every PRUNE_INTERVAL requests
    if (++requestsSincePrune >= PRUNE_INTERVAL) {
      requestsSincePrune = 0
      pruneRateLimitStore()
    }
    const ip = clientIp(request)
    // Bootstrap is tighter (credential stuffing / secret brute-force)
    const isBootstrap = path === '/api/platform/bootstrap'
    const limit = isBootstrap ? 10 : 60
    const windowMs = 60 * 1000
    const rlKey = isBootstrap ? `bootstrap:${ip}` : `api:${ip}`
    const rl = await checkRateLimit(rlKey, limit, windowMs)
    if (rl.limited) {
      const isProd =
        process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
      const headers: Record<string, string> = {
        'Retry-After': String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))),
      }
      if (!isProd) {
        headers['X-RateLimit-Backend'] = rl.backend
      }
      return withCsp(
        NextResponse.json(
          { error: 'Too many requests. Please try again later.' },
          {
            status: 429,
            headers,
          }
        )
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
    return withCsp(NextResponse.redirect(redirectUrl))
  }

  // ── Authenticated: resolve platform vs tenant ──────────────────────────
  if (user) {
    const sessionCtx = await fetchSessionContext(supabase, user.id)
    const isPlatformOwner = sessionCtx?.is_platform_owner ?? false

    // Login page → platform console or tenant dashboard
    if (path === '/') {
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = isPlatformOwner ? '/platform' : '/dashboard'
      return withCsp(NextResponse.redirect(redirectUrl))
    }

    // Platform owners stay in /platform (not tenant dashboard), except setup
    if (isPlatformOwner && path.startsWith('/dashboard')) {
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/platform'
      return withCsp(NextResponse.redirect(redirectUrl))
    }

    // Non-platform users: allow /platform UI to show "no access" + setup link
    // (do not hard-redirect away — that made /platform look broken)

    // Tenant role guards
    if (path.startsWith('/dashboard') && !isPlatformOwner) {
      // Deactivated organizations cannot use the tenant app
      if (sessionCtx?.org_active === false) {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/'
        redirectUrl.searchParams.set('error', 'org_inactive')
        // Clear session so they do not bounce on /
        await supabase.auth.signOut()
        return withCsp(NextResponse.redirect(redirectUrl))
      }

      // Always resolve role from user_roles (DB), never trust JWT app_metadata alone.
      // Stale JWT after demotion/promotion must not control route access.
      const role = pickPrimaryRole(sessionCtx?.user_roles)

      if ((role === 'employee' || role === 'site_employee') && path !== '/dashboard/my-work') {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/dashboard/my-work'
        return withCsp(NextResponse.redirect(redirectUrl))
      }

      if (role === 'unload_clerk' && path !== '/dashboard/unload' && path !== '/dashboard/my-work') {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/dashboard/unload'
        return withCsp(NextResponse.redirect(redirectUrl))
      }

      if (role === 'stakeholder' && path !== '/dashboard/stakeholder') {
        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/dashboard/stakeholder'
        return withCsp(NextResponse.redirect(redirectUrl))
      }

      // Block module routes when org feature is disabled (server-side)
      const requiredFeature = featureForPath(path)
      if (requiredFeature) {
        const feat = sessionCtx?.features.find((f) => f.feature_key === requiredFeature)
        const featOk = feat ? feat.enabled === true : false
        // Fail-closed: missing feature flag or explicit false blocks the route
        if (!featOk) {
          const redirectUrl = request.nextUrl.clone()
          redirectUrl.pathname = '/dashboard'
          redirectUrl.searchParams.set('error', 'feature_disabled')
          redirectUrl.searchParams.set('feature', requiredFeature)
          return withCsp(NextResponse.redirect(redirectUrl))
        }
      }
    }
  }

  return withCsp(supabaseResponse)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
