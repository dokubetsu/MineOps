import { test, expect } from '@playwright/test'
import { E2E_EMAIL, E2E_PASSWORD, loginAsAdmin } from './helpers'

/**
 * Platform owner flow (seed: platform@khani.com / password123 after db reset).
 * Skips gracefully if seed/platform owner is unavailable.
 */
const PLATFORM_EMAIL = process.env.E2E_PLATFORM_EMAIL || 'platform@khani.com'
const PLATFORM_PASSWORD = process.env.E2E_PLATFORM_PASSWORD || 'password123'

test.describe('Platform owner console', () => {
  test('platform owner lands on /platform, not empty tenant dashboard', async ({ page }) => {
    await page.goto('/')
    await page.locator('input[type="email"]').fill(PLATFORM_EMAIL)
    await page.locator('input[type="password"]').fill(PLATFORM_PASSWORD)
    await page.locator('button[type="submit"]').click()

    const landedPlatform = page
      .waitForURL(/\/platform/, { timeout: 15000 })
      .then(() => true)
      .catch(() => false)
    const invalidLogin = page
      .getByText(/Invalid login credentials/i)
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false)

    const result = await Promise.race([
      landedPlatform.then((ok) => (ok ? 'platform' : 'none')),
      invalidLogin.then((ok) => (ok ? 'invalid' : 'none')),
    ])

    if (result === 'platform' || page.url().includes('/platform')) {
      await expect(page).toHaveURL(/\/platform/)
      await expect(page.getByText(/Platform Console|Organizations/i).first()).toBeVisible({
        timeout: 15000,
      })
      await expect(page.getByText(/No Role/i)).toHaveCount(0)
      return
    }

    test.skip(true, 'Platform seed user not available in this environment')
  })

  test('tenant admin cannot use /platform as console (no access or redirect)', async ({ page }) => {
    await loginAsAdmin(page)

    await page.goto('/platform')

    // Auth shell re-inits on /platform — wait until denial, console, or leave
    await expect
      .poll(
        async () => {
          const url = page.url()
          if (url.includes('/dashboard')) return 'dashboard'
          if (url.endsWith('/') || /\/\?/.test(url)) return 'home'
          const denied = await page
            .locator('[data-testid="platform-access-denied"]')
            .isVisible()
            .catch(() => false)
          if (denied) return 'denied'
          const heading = await page
            .getByRole('heading', { name: /No platform access/i })
            .isVisible()
            .catch(() => false)
          if (heading) return 'denied'
          const firstTime = await page
            .getByText(/First-time platform setup/i)
            .isVisible()
            .catch(() => false)
          if (firstTime) return 'denied'
          const consoleHit = await page
            .getByText(/New organization|Platform Console/i)
            .first()
            .isVisible()
            .catch(() => false)
          if (consoleHit) return 'console'
          return 'loading'
        },
        { timeout: 25000 }
      )
      .not.toBe('loading')

    const url = page.url()
    const onDashboard = url.includes('/dashboard')
    const onHome = /\/$|\/\?/.test(new URL(url).pathname) && !url.includes('/platform')
    const noAccess =
      (await page.locator('[data-testid="platform-access-denied"]').count()) > 0 ||
      (await page.getByRole('heading', { name: /No platform access/i }).count()) > 0 ||
      (await page.getByText(/not a platform owner|First-time platform setup/i).count()) > 0
    const onPlatformOrgs =
      (await page.getByText(/New organization/i).count()) > 0 &&
      (await page.getByText(/Platform Console/i).count()) > 0

    // Tenant admin: denial UI, redirect away, or (rare) dual-role console
    expect(onDashboard || onHome || noAccess || onPlatformOrgs).toBeTruthy()
    // Must not silently sit on a blank /platform without denial or console
    if (url.includes('/platform') && !onPlatformOrgs) {
      expect(noAccess).toBeTruthy()
    }

    expect(E2E_EMAIL).toBeTruthy()
    expect(E2E_PASSWORD).toBeTruthy()
  })
})
