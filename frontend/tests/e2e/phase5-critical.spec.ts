import { test, expect } from '@playwright/test'
import { clickNav, loginAsAdmin, toastLocator, waitForSaveIdle } from './helpers'

/**
 * Phase 5 critical browser paths (desktop chromium + mobile Pixel 5 project).
 * Requires: migrations applied, global-setup admin seed, production build for webServer.
 */
test.describe('Phase 5 critical flows', () => {
  test('attendance mark → unmark → save clears mark', async ({ page }) => {
    test.setTimeout(60_000)

    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/attendance')

    const presentBtn = page
      .locator('.att-btn-group button, button.att-btn')
      .filter({ hasText: /^P$/ })
      .first()
    await expect(presentBtn).toBeVisible({ timeout: 20000 })

    if (
      await page
        .getByText(/Payroll finalized|read-only for finalized/i)
        .isVisible()
        .catch(() => false)
    ) {
      test.skip(true, 'Current month is payroll-finalized; attendance is read-only')
    }

    const saveBtn = page
      .locator('[data-testid="attendance-save"], button.btn-primary')
      .filter({ hasText: /Save/i })
      .first()

    // Mark present and save
    await presentBtn.click()
    await expect(saveBtn).toBeEnabled({ timeout: 5000 })
    await saveBtn.click()
    await expect(
      toastLocator(page, /mark\(s\) saved|Attendance updated|\d+ mark/i)
    ).toBeVisible({ timeout: 20000 })
    await waitForSaveIdle(page, saveBtn)
    // After successful save Save is disabled until the next edit
    await expect(saveBtn).toBeDisabled({ timeout: 10000 })

    // Unmark (toggle P off) — must re-enable Save (also covered by loadRoster race fix)
    await presentBtn.click()
    await expect(saveBtn).toBeEnabled({ timeout: 10000 })
    await saveBtn.click()
    await expect(
      toastLocator(page, /cleared|Attendance updated|mark\(s\) saved/i)
    ).toBeVisible({ timeout: 20000 })
    await waitForSaveIdle(page, saveBtn)

    const fatal = await page.getByText(/Permission denied saving attendance/i).count()
    expect(fatal).toBe(0)
    const saveError = await toastLocator(page, /Error saving attendance/i).count()
    expect(saveError).toBe(0)
  })

  test('cash book page loads and lock control is available for admin', async ({ page }) => {
    await loginAsAdmin(page)
    await clickNav(page, '/dashboard/cash-book')

    await expect(page.getByText(/Cash Book|Ledger|Opening/i).first()).toBeVisible({
      timeout: 20000,
    })

    const lockBtn = page.locator('button').filter({ hasText: /Lock Book|Unlock Book/i }).first()
    await expect(lockBtn).toBeVisible({ timeout: 15000 })

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
