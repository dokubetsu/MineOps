import { test, expect } from '@playwright/test'
import {
  clickNav,
  confirmDialogIfOpen,
  loginAsAdmin,
  toastLocator,
  visibleDashboardShell,
  waitForSaveIdle,
} from './helpers'

/**
 * Khani End-to-End Business Flow
 *
 * Prerequisites:
 * - Supabase running with migrations + seed (or global-setup admin seed)
 * - Production build available for webServer (`npm run build`)
 */
test.describe('Khani End-to-End Business Flow', () => {
  test('login, log trip, attendance, generate and finalize payroll', async ({ page }) => {
    // Full path: login → trip → attendance → payroll (confirm dialogs + network)
    test.setTimeout(90_000)

    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('PAGE ERROR LOG:', msg.text())
    })
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message))

    await loginAsAdmin(page)

    // ── Trips ───────────────────────────────────────────────────────────
    await clickNav(page, '/dashboard/trips')

    await page.locator('button:has-text("Log Trip")').first().click()

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
      const saveBtn = page
        .locator('[data-testid="attendance-save"], button.btn-primary:has-text("Save")')
        .first()
      await expect(saveBtn).toBeEnabled({ timeout: 5000 })
      await saveBtn.click()
      await expect(
        toastLocator(page, /mark\(s\) saved|cleared|Attendance updated/i)
      ).toBeVisible({ timeout: 20000 })
      await waitForSaveIdle(page, saveBtn)
    }

    // ── Payroll generate + finalize ─────────────────────────────────────
    await clickNav(page, '/dashboard/payroll')

    // Prefer a fresh period so we usually skip the re-generate confirm dialog
    const periodInput = page.locator('input[type="month"]').first()
    if (await periodInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Use previous calendar month when possible (still valid yyyy-MM)
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - 1)
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      await periodInput.fill(ym)
    }

    const generateBtn = page.getByRole('button', { name: /^Generate$/i })
    await expect(generateBtn).toBeVisible({ timeout: 15000 })
    await expect(generateBtn).toBeEnabled({ timeout: 10000 })
    await generateBtn.click()

    // Optional overwrite dialog only — never re-click page "Generate"
    await confirmDialogIfOpen(page, /Re-generate|overwrite|already exists/i, 3000)

    // Success toast, run row, or "already finalized" notice
    const outcome = await Promise.race([
      toastLocator(page, /generated successfully|already been finalized|Payroll/i)
        .waitFor({ state: 'visible', timeout: 30000 })
        .then(() => 'toast')
        .catch(() => null),
      page
        .locator('.trip-card, .card, .badge, span')
        .filter({ hasText: /draft|finalized/i })
        .first()
        .waitFor({ state: 'visible', timeout: 30000 })
        .then(() => 'run')
        .catch(() => null),
    ])
    expect(outcome).toBeTruthy()

    // Open a draft run if listed (detail view shows Finalize)
    const draftRun = page
      .locator('.trip-card')
      .filter({ hasText: /draft/i })
      .first()
    if (await draftRun.isVisible({ timeout: 3000 }).catch(() => false)) {
      await draftRun.click()
    }

    const finalizeBtn = page
      .locator('button')
      .filter({ hasText: /Finalize Wages|Finalize/i })
      .first()
    if (await finalizeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await finalizeBtn.click()
      await confirmDialogIfOpen(page, /Finalize Payroll|finalize this payroll/i, 3000)
      await expect(
        page.locator('text=/finalized|Payroll finalized/i').first()
      ).toBeVisible({ timeout: 20000 })
    }

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(visibleDashboardShell(page)).toBeVisible({ timeout: 15000 })
  })
})
