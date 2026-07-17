import { expect, type Page } from '@playwright/test'

export const E2E_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@mineops.com'
export const E2E_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'password123'

/** Login as demo tenant admin and wait for dashboard shell. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15000 })
  await page.locator('input[type="email"]').fill(E2E_EMAIL)
  await page.locator('input[type="password"]').fill(E2E_PASSWORD)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 25000 })
  await expect(page.locator('.sidebar-logo-text, .mobile-header-brand').first()).toBeVisible({
    timeout: 15000,
  })
}

/** Prefer role/text locators over fixed sleeps. */
export async function clickNav(page: Page, href: string): Promise<void> {
  const link = page.locator(`a[href="${href}"]`).first()
  await expect(link).toBeVisible({ timeout: 15000 })
  await link.click()
  await expect(page).toHaveURL(new RegExp(href.replace(/\//g, '\\/')))
}
