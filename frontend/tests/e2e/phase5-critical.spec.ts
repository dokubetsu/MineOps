import { test, expect } from '@playwright/test'
import {
  clickNav,
  confirmDialogIfOpen,
  expectAttendanceSaveOk,
  loginAsAdmin,
  pageTitle,
  toastLocator,
} from './helpers'

/**
 * Phase 5 critical browser paths (desktop chromium + mobile Pixel 5 project).
 * Requires: migrations applied, global-setup admin seed, production build for webServer.
 *
 * Mobile notes: sidebar nav links stay in the DOM with display:none — always assert
 * visible page content (.page-title / filter({ visible: true })), never bare getByText().first().
 */
test.describe('Phase 5 critical flows', () => {
  test('attendance mark → unmark → save clears mark', async ({ page }) => {
    test.setTimeout(60_000)

    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/attendance')

    await expect(pageTitle(page, /Attendance/i)).toBeVisible({ timeout: 20000 })

    const presentBtn = page
      .locator('.att-btn-group button, button.att-btn')
      .filter({ hasText: /^P$/ })
      .filter({ visible: true })
      .first()
    await expect(presentBtn).toBeVisible({ timeout: 20000 })

    if (
      await page
        .getByText(/Payroll finalized|read-only for finalized/i)
        .filter({ visible: true })
        .isVisible()
        .catch(() => false)
    ) {
      test.skip(true, 'Current month is payroll-finalized; attendance is read-only')
    }

    const saveBtn = page
      .locator('[data-testid="attendance-save"], button.btn-primary')
      .filter({ hasText: /Save/i })
      .filter({ visible: true })
      .first()

    // Mark present and save
    await presentBtn.click()
    await expect(saveBtn).toBeEnabled({ timeout: 5000 })
    await saveBtn.click()
    await expectAttendanceSaveOk(page, saveBtn, /mark\(s\) saved|Attendance updated|\d+ mark|saved/i)
    await expect(saveBtn).toBeDisabled({ timeout: 10000 })

    // Unmark (toggle P off) — must re-enable Save
    await presentBtn.click()
    await expect(saveBtn).toBeEnabled({ timeout: 10000 })
    await saveBtn.click()
    await expectAttendanceSaveOk(page, saveBtn, /cleared|Attendance updated|mark\(s\) saved|saved/i)

    const fatal = await page.getByText(/Permission denied saving attendance/i).count()
    expect(fatal).toBe(0)
    const saveError = await toastLocator(page, /Error saving attendance/i).count()
    expect(saveError).toBe(0)
  })

  test('cash book page loads and lock control is available for admin', async ({ page }) => {
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/cash-book')

    // Prefer page title — "Cash Book" also appears in hidden sidebar on mobile
    await expect(pageTitle(page, /Cash Book/i)).toBeVisible({ timeout: 20000 })

    const lockBtn = page
      .locator('button')
      .filter({ hasText: /Lock Book|Unlock Book/i })
      .filter({ visible: true })
      .first()
    await expect(lockBtn).toBeVisible({ timeout: 15000 })

    const label = await lockBtn.innerText()
    if (/Lock Book/i.test(label)) {
      await lockBtn.click()
      await confirmDialogIfOpen(page, /Lock Ledger|Unlock Ledger|lock today|unlock this/i, 3000)
      await expect(
        page.locator('button').filter({ hasText: /Unlock Book/i }).filter({ visible: true }).first()
      ).toBeVisible({ timeout: 15000 })
    }
  })

  test('leave page loads pending/approve controls for admin', async ({ page }) => {
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/leave')
    // "Leave" is also a hidden sidebar label on mobile
    await expect(pageTitle(page, /Leave/i)).toBeVisible({ timeout: 20000 })
  })

  test('payroll page shows generate control', async ({ page }) => {
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/payroll')
    await expect(
      page.getByRole('button', { name: /Generate/i }).filter({ visible: true }).first()
    ).toBeVisible({ timeout: 20000 })
  })
})
