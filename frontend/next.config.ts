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

const nextConfig: NextConfig = {
  async headers() {
    const cspHeader = `
      default-src 'self';
      script-src 'self' 'unsafe-eval' 'unsafe-inline';
      style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
      img-src 'self' blob: data: https://*.supabase.co http://127.0.0.1:54321;
      font-src 'self' https://fonts.gstatic.com;
      connect-src 'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:54321 ws://127.0.0.1:54321 http://localhost:54321;
      frame-src 'none';
      object-src 'none';
      base-uri 'self';
      form-action 'self';
    `.replace(/\s{2,}/g, ' ').trim()

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: cspHeader,
          },
        ],
      },
    ]
  },
}

export default withPWA(nextConfig)
