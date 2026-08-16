/**
 * Content-Security-Policy builder.
 * Shared by next.config (build/start) and proxy (request-time override for CI e2e).
 *
 * Local Supabase (127.0.0.1 / localhost :54321) is always allowed in connect-src.
 * Loopback is not a useful XSS target for remote attackers; CI runs production
 * builds against local Supabase and must not be blocked by CSP.
 *
 * Production still allows script-src 'unsafe-inline' for Next.js bootstrap
 * (nonce pipeline: docs/CSP_NONCE.md). We do harden script-src-attr and related
 * directives that Next does not need.
 */

const isDev = process.env.NODE_ENV !== 'production'

const LOCAL_SUPABASE = [
  'http://127.0.0.1:54321',
  'ws://127.0.0.1:54321',
  'http://localhost:54321',
  'ws://localhost:54321',
] as const

export type CspBuildOptions = {
  /** Optional nonce for future dual-policy / report-only experiments */
  nonce?: string
  /** When true, omit 'unsafe-inline' from script-src (report-only / experiments only) */
  strictScripts?: boolean
}

export function buildContentSecurityPolicy(opts: CspBuildOptions = {}): string {
  const { nonce, strictScripts } = opts

  let scriptSrc: string
  if (strictScripts && nonce) {
    // Experimental path — do not enable in enforcing header until layout wires nonce
    scriptSrc = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
  } else if (nonce) {
    // Dual: nonce present for gradual adoption; keep eval in dev for tooling
    scriptSrc = isDev
      ? `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' 'unsafe-inline'`
      : `script-src 'self' 'nonce-${nonce}' 'unsafe-inline'`
  } else if (isDev) {
    scriptSrc = "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
  } else {
    scriptSrc = "script-src 'self' 'unsafe-inline'"
  }

  // Always include cloud + local Supabase so production `next start` in CI works.
  // fonts.* allowed in connect-src so the PWA service worker (Workbox) can
  // fetch Google Fonts CSS/files without CSP "Refused to connect" errors.
  const connectSrc = [
    "connect-src 'self'",
    'https://*.supabase.co',
    'wss://*.supabase.co',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
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
    // Block inline event-handler attributes (onclick=…) — not used by Next bootstrap
    "script-src-attr 'none'",
    // Prefer self-hosted next/font; keep googleapis for any residual @import / cache
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    imgSrc,
    "font-src 'self' data: https://fonts.gstatic.com",
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

/** True when production script-src still relies on unsafe-inline (expected until E4). */
export function productionScriptSrcAllowsUnsafeInline(csp: string = buildContentSecurityPolicy()): boolean {
  return /script-src[^;]*'unsafe-inline'/.test(csp)
}

/**
 * Generates a cryptographically random Base64 nonce for CSP script/style tags.
 */
export function generateCspNonce(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64')
    }
    return btoa(String.fromCharCode(...bytes))
  }
  throw new Error('Web Crypto API (crypto.getRandomValues) is required for CSP nonce generation')
}

