/**
 * Content-Security-Policy builder.
 * Shared by next.config (build/start) and proxy (request-time override for CI e2e).
 *
 * Local Supabase (127.0.0.1 / localhost :54321) is always allowed in connect-src.
 * Loopback is not a useful XSS target for remote attackers; CI runs production
 * builds against local Supabase and must not be blocked by CSP.
 */

const isDev = process.env.NODE_ENV !== 'production'

const LOCAL_SUPABASE = [
  'http://127.0.0.1:54321',
  'ws://127.0.0.1:54321',
  'http://localhost:54321',
  'ws://localhost:54321',
] as const

export function buildContentSecurityPolicy(): string {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline'"

  // Always include cloud + local Supabase so production `next start` in CI works.
  const connectSrc = [
    "connect-src 'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
    ...LOCAL_SUPABASE,
  ].join(' ')

  const imgSrc = [
    "img-src 'self'",
    'blob:',
    'data:',
    'https://*.supabase.co',
    'http://127.0.0.1:54321',
    'http://localhost:54321',
  ].join(' ')

  const directives = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    imgSrc,
    "font-src 'self' https://fonts.gstatic.com",
    connectSrc,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]

  // Only force HTTPS upgrade on real cloud deploys (not local HTTP Supabase / CI)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const isCloudProd =
    !isDev &&
    process.env.VERCEL_ENV === 'production' &&
    !/127\.0\.0\.1|localhost/i.test(supabaseUrl)

  if (isCloudProd) {
    directives.push('upgrade-insecure-requests')
  }

  return directives.join('; ')
}
