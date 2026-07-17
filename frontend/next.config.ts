import withPWAInit from '@ducanh2912/next-pwa'
import type { NextConfig } from 'next'

const withPWA = withPWAInit({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  workboxOptions: {
    skipWaiting: true,
  },
})

const isDev = process.env.NODE_ENV !== 'production'

function buildCsp(): string {
  // Production tightens scripts (no unsafe-eval). Next still injects inline
  // bootstrap scripts, so 'unsafe-inline' remains for script-src until a full
  // nonce pipeline is adopted (Phase E4 long-term — docs/CSP_NONCE.md).
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline'"

  const connectSrc = isDev
    ? "connect-src 'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:54321 ws://127.0.0.1:54321 http://localhost:54321 ws://localhost:54321"
    : "connect-src 'self' https://*.supabase.co wss://*.supabase.co"

  const imgSrc = isDev
    ? "img-src 'self' blob: data: https://*.supabase.co http://127.0.0.1:54321"
    : "img-src 'self' blob: data: https://*.supabase.co"

  const directives = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    imgSrc,
    "font-src 'self' https://fonts.gstatic.com",
    connectSrc,
    // PWA service worker + Workbox
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]

  if (!isDev) {
    directives.push('upgrade-insecure-requests')
  }

  return directives.join('; ')
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: buildCsp(),
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=()',
          },
        ],
      },
    ]
  },
}

export default withPWA(nextConfig)
