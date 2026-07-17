import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { Database } from './lib/supabase/database.types'

// Routes that stakeholders are NOT allowed to access
const STAKEHOLDER_BLOCKED_PREFIXES = [
  '/dashboard/trips',
  '/dashboard/cash-book',
  '/dashboard/attendance',
  '/dashboard/leave',
  '/dashboard/payroll',
  '/dashboard/reports',
  '/dashboard/manage-employees',
  '/dashboard/settings',
  '/dashboard/users',
]

// NOTE: This is an in-memory Map rate limiter for admin API routes. 
// On Vercel or other serverless runtimes, state is not shared across instances 
// and will reset on cold starts. For production hardening, use Supabase Auth 
// built-in rate limits and/or Cloudflare/WAF level rate limiters.
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

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase configuration error: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables')
  }

  // ── Rate Limiting for Admin and Registration API routes ─────────────────────────────────
  if (request.nextUrl.pathname.startsWith('/api/admin/') || request.nextUrl.pathname === '/api/auth/register-tenant') {
    const ip = (request as any).ip || request.headers.get('x-forwarded-for') || '127.0.0.1'
    // Rate limit: Max 60 requests per 1 minute
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

  // ── 1. Unauthenticated → redirect to login ──────────────────────────────
  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/'
    return NextResponse.redirect(redirectUrl)
  }

  // ── 2. Authenticated on login page → redirect to dashboard ──────────────
  if (user && request.nextUrl.pathname === '/') {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/dashboard'
    return NextResponse.redirect(redirectUrl)
  }



  // ── 3. Role-based route guard for authenticated users ───────────────────
  if (user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const pathname = request.nextUrl.pathname

    // Attempt to get user role from cached cookie to prevent DB round-trip latency
    let role = request.cookies.get('user-role')?.value || null

    if (!role) {
      // Fallback: Fetch all roles of the user from DB to check priority
      const { data: roleRows } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)

      const roles = roleRows?.map(r => r.role) || []
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

    if ((role === 'employee' || role === 'site_employee') && pathname !== '/dashboard/my-work') {
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/dashboard/my-work'
      return NextResponse.redirect(redirectUrl)
    }

    if (role === 'stakeholder' && pathname !== '/dashboard/stakeholder') {
      const redirectUrl = request.nextUrl.clone()
      redirectUrl.pathname = '/dashboard/stakeholder'
      return NextResponse.redirect(redirectUrl)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
