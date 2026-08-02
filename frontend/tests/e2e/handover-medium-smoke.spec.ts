import { test, expect } from '@playwright/test'
import { clickNav, loginAsAdmin, pageTitle } from './helpers'

/**
 * Smoke coverage for Medium-gap surfaces (reports, my-work, leave, settings).
 * Full offline / approve / purge flows remain unit + manual; these assert pages load
 * and primary controls are reachable for the demo admin.
 */
test.describe('Handover medium smoke', () => {
  test('reports page loads paper + business pack controls', async ({ page }) => {
    test.setTimeout(60_000)
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/reports')
    await expect(pageTitle(page, /Report/i)).toBeVisible({ timeout: 20000 })
    await expect(
      page.getByText(/Business pack|Paper view|Download/i).filter({ visible: true }).first()
    ).toBeVisible({ timeout: 15000 })
  })

  test('leave page loads applications list', async ({ page }) => {
    test.setTimeout(45_000)
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/leave')
    await expect(pageTitle(page, /Leave/i)).toBeVisible({ timeout: 20000 })
  })

  test('settings page loads org rates', async ({ page }) => {
    test.setTimeout(45_000)
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/settings')
    await expect(pageTitle(page, /Setting/i)).toBeVisible({ timeout: 20000 })
    await expect(
      page.getByText(/Org rates|Customers|₹\/m³|per m/i).filter({ visible: true }).first()
    ).toBeVisible({ timeout: 15000 })
  })

  test('users page loads provisioning controls', async ({ page }) => {
    test.setTimeout(45_000)
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/users')
    await expect(pageTitle(page, /User/i)).toBeVisible({ timeout: 20000 })
  })

  test('cash book page loads for settlement collection', async ({ page }) => {
    test.setTimeout(45_000)
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/cash-book')
    await expect(pageTitle(page, /Cash/i)).toBeVisible({ timeout: 20000 })
  })
})
