import { defineConfig, devices } from '@playwright/test'

/**
 * Phase 5 layout:
 * - tests/unit/** — pure business/security helpers (no browser required)
 * - tests/e2e/** — browser flows against local Next + Supabase
 *
 * Projects: unit | chromium | mobile (Pixel 5 critical smoke)
 *
 * Set PW_SKIP_WEBSERVER=1 when running unit tests without a Next build.
 */
const skipWebServer = process.env.PW_SKIP_WEBSERVER === '1'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'list' : 'html',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'unit',
      testMatch: '**/unit/**/*.spec.ts',
    },
    {
      name: 'chromium',
      testMatch: '**/e2e/**/*.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testMatch: '**/e2e/phase5-critical.spec.ts',
      use: { ...devices['Pixel 5'] },
    },
  ],
  ...(skipWebServer
    ? {}
    : {
        webServer: {
          command: 'npm run start',
          url: 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            ...process.env,
            NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
            SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
            // next.config CSP: allow local Supabase connect-src when NODE_ENV=production
            CSP_ALLOW_LOCAL_SUPABASE:
              process.env.CSP_ALLOW_LOCAL_SUPABASE ||
              (process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('127.0.0.1') ||
              process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('localhost')
                ? '1'
                : ''),
          },
        },
      }),
})
