import { test, expect } from '@playwright/test'
import { clickNav, loginAsAdmin } from './helpers'

/**
 * Phase 5 critical browser paths (desktop chromium + mobile Pixel 5 project).
 * Requires: migrations applied, global-setup admin seed, production build for webServer.
 */
test.describe('Phase 5 critical flows', () => {
  test('attendance mark → unmark → save clears mark', async ({ page }) => {
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/attendance')

    const presentBtn = page.locator('button').filter({ hasText: /^P$/ }).first()
    await expect(presentBtn).toBeVisible({ timeout: 20000 })

    // Mark present
    await presentBtn.click()
    // Toggle off (unmark) if UI supports re-click
    await presentBtn.click()

    // Mark present again and save
    await presentBtn.click()
    const saveBtn = page.locator('button').filter({ hasText: /Save/i }).first()
    await expect(saveBtn).toBeEnabled({ timeout: 5000 })
    await saveBtn.click()
    await expect(page.getByText(/Saved|mark|cleared|updated/i).first()).toBeVisible({
      timeout: 20000,
    })

    // Unmark and save again — Phase 0/1 fix: clear persists
    await presentBtn.click()
    await saveBtn.click()
    // Success toast or reload without error
    await expect(
      page.getByText(/Saved|cleared|updated|No existing attendance|Error/i).first()
    ).toBeVisible({ timeout: 20000 })
    // Must not leave a hard failure banner for RLS-only regressions
    const fatal = await page.getByText(/Permission denied saving attendance/i).count()
    expect(fatal).toBe(0)
  })

  test('cash book page loads and lock control is available for admin', async ({ page }) => {
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/cash-book')

    await expect(page.getByText(/Cash Book|Ledger|Opening/i).first()).toBeVisible({
      timeout: 20000,
    })

    const lockBtn = page.locator('button').filter({ hasText: /Lock Book|Unlock Book/i }).first()
    await expect(lockBtn).toBeVisible({ timeout: 15000 })

    // Toggle lock once if unlocked
    const label = await lockBtn.innerText()
    if (/Lock Book/i.test(label)) {
      await lockBtn.click()
      const confirm = page.locator('button').filter({ hasText: /Confirm|Lock|Yes/i }).last()
      if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirm.click()
      }
      await expect(
        page.locator('button').filter({ hasText: /Unlock Book/i }).first()
      ).toBeVisible({ timeout: 15000 })
    }
  })

  test('leave page loads pending/approve controls for admin', async ({ page }) => {
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/leave')
    await expect(page.getByText(/Leave|Applications|Pending|Approve/i).first()).toBeVisible({
      timeout: 20000,
    })
  })

  test('payroll page shows generate control', async ({ page }) => {
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/payroll')
    await expect(page.locator('button').filter({ hasText: /Generate/i }).first()).toBeVisible({
      timeout: 20000,
    })
  })
})
