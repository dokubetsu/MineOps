import { test, expect } from '@playwright/test'
import { clickNav, loginAsAdmin, toastLocator, waitForSaveIdle } from './helpers'

/**
 * MineOps End-to-End Business Flow
 *
 * Prerequisites:
 * - Supabase running with migrations + seed (or global-setup admin seed)
 * - Production build available for webServer (`npm run build`)
 */
test.describe('MineOps End-to-End Business Flow', () => {
  test('login, log trip, attendance, generate and finalize payroll', async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('PAGE ERROR LOG:', msg.text())
    })
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message))

    await loginAsAdmin(page)

    // ── Trips ───────────────────────────────────────────────────────────
    await clickNav(page, '/dashboard/trips')

    await page.locator('button:has-text("Log Trip")').first().click()

    // Prefer stable test id; fallbacks for older builds
    const vehicleInput = page
      .locator(
        '[data-testid="trip-vehicle-input"], input[aria-label="Vehicle Number"], input[placeholder*="KA" i]'
      )
      .first()
    await expect(vehicleInput).toBeVisible({ timeout: 15000 })
    await vehicleInput.fill('KA01MH1234')

    const match = page.getByRole('dialog').locator('text=KA01MH1234').first()
    if (await match.isVisible({ timeout: 4000 }).catch(() => false)) {
      await match.click()
    }

    const submitTrip = page
      .getByRole('dialog')
      .locator('button[type="submit"]')
      .filter({ hasText: /Log Trip|Save Changes/i })
    await expect(submitTrip).toBeVisible({ timeout: 10000 })
    await submitTrip.click()

    const tripOk = await Promise.race([
      toastLocator(page, /Trip logged|Trip updated|successfully/i)
        .waitFor({ state: 'visible', timeout: 20000 })
        .then(() => true)
        .catch(() => false),
      page
        .locator('.trip-vehicle, .card')
        .filter({ hasText: /KA01MH1234/i })
        .first()
        .waitFor({ state: 'visible', timeout: 20000 })
        .then(() => true)
        .catch(() => false),
    ])
    expect(tripOk).toBeTruthy()

    // ── Attendance ──────────────────────────────────────────────────────
    await clickNav(page, '/dashboard/attendance')

    const presentBtn = page
      .locator('.att-btn-group button, button.att-btn')
      .filter({ hasText: /^P$/ })
      .first()
    await expect(presentBtn).toBeVisible({ timeout: 20000 })

    const lockedBanner = page.getByText(/Payroll finalized|read-only/i)
    if (await lockedBanner.isVisible().catch(() => false)) {
      test.info().annotations.push({
        type: 'note',
        description: 'Attendance locked — skipping mark/save',
      })
    } else {
      await presentBtn.click()
      const saveBtn = page.locator(
        '[data-testid="attendance-save"], button.btn-primary:has-text("Save")'
      ).first()
      await expect(saveBtn).toBeEnabled({ timeout: 5000 })
      await saveBtn.click()
      await expect(
        toastLocator(page, /mark\(s\) saved|cleared|Attendance updated/i)
      ).toBeVisible({ timeout: 20000 })
      await waitForSaveIdle(page, saveBtn)
    }

    // ── Payroll generate + finalize ─────────────────────────────────────
    await clickNav(page, '/dashboard/payroll')

    const generateBtn = page.locator('button').filter({ hasText: /Generate/i }).first()
    await expect(generateBtn).toBeVisible({ timeout: 15000 })
    await generateBtn.click()

    const confirmGenerate = page.locator('button').filter({ hasText: /Confirm|Generate|Yes/i }).last()
    if (await confirmGenerate.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmGenerate.click()
    }

    const draftOrRun = page
      .locator('text=/draft|finalized|generated successfully|already been finalized|Run/i')
      .first()
    await expect(draftOrRun).toBeVisible({ timeout: 25000 })

    const openRun = page
      .locator('.card, tr, button, a')
      .filter({ hasText: /draft|2026|2025|Run/i })
      .first()
    if (await openRun.isVisible().catch(() => false)) {
      await openRun.click()
    }

    const finalizeBtn = page.locator('button').filter({ hasText: /Finalize/ }).first()
    if (await finalizeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await finalizeBtn.click()
      const confirmFinalize = page
        .locator('button')
        .filter({ hasText: /Confirm|Yes|Finalize/i })
        .last()
      if (await confirmFinalize.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmFinalize.click()
      }
      await expect(page.locator('text=/finalized|Payroll finalized/i').first()).toBeVisible({
        timeout: 20000,
      })
    }

    await page.locator('a[href="/dashboard"]').first().click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator('.sidebar-logo-text, .mobile-header-brand').first()).toBeVisible()
  })
})
