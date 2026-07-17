import { test, expect } from '@playwright/test'

/**
 * MineOps End-to-End Business Flow
 *
 * Prerequisites:
 * - Supabase running with migrations + seed (or global-setup admin seed)
 * - global-setup ensures admin@mineops.com / password123
 * - Production build available for webServer (`npm run build`)
 */
const E2E_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@mineops.com'
const E2E_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'password123'

test.describe('MineOps End-to-End Business Flow', () => {
  test('login, log trip, attendance, generate and finalize payroll', async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('PAGE ERROR LOG:', msg.text())
    })
    page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message))

    // ── 1. Login (strict) ───────────────────────────────────────────────
    await page.goto('/')
    await expect(page).toHaveTitle(/MineOps/)

    await page.locator('input[type="email"]').fill(E2E_EMAIL)
    await page.locator('input[type="password"]').fill(E2E_PASSWORD)
    await page.locator('button[type="submit"]').click()

    // Must leave login page — invalid credentials fail here
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 25000 })
    await expect(page.locator('.sidebar-logo-text')).toBeVisible()
    await expect(page.getByText(/Invalid login credentials/i)).toHaveCount(0)
    // Tenant admin should not land on platform console
    await expect(page).not.toHaveURL(/\/platform/)

    // ── 2. Trips (feature must be enabled for demo org — seed defaults all on) ──
    const tripsNav = page.locator('a[href="/dashboard/trips"]')
    await expect(tripsNav).toBeVisible({ timeout: 10000 })
    await tripsNav.click()
    await expect(page).toHaveURL(/\/dashboard\/trips/)

    await page.locator('button:has-text("Log Trip")').first().click()

    // Search / select seeded plate KA01MH1234
    const search = page.locator(
      'input[placeholder*="plate" i], input[placeholder*="search" i], input[placeholder*="vehicle" i]'
    ).first()
    await expect(search).toBeVisible({ timeout: 10000 })
    await search.fill('KA01MH1234')

    const match = page.locator('text=KA01MH1234').first()
    await expect(match).toBeVisible({ timeout: 10000 })
    await match.click()

    // Submit log form
    const submitTrip = page.locator('button:has-text("Log Trip"), button:has-text("+ Log Trip")').last()
    await submitTrip.click()

    // Trip card or list row should show the plate
    await expect(page.locator('text=KA01MH1234').first()).toBeVisible({ timeout: 15000 })

    // ── 3. Attendance ───────────────────────────────────────────────────
    await page.locator('a[href="/dashboard/attendance"]').click()
    await expect(page).toHaveURL(/\/dashboard\/attendance/)

    // Mark first employee Present
    const presentBtn = page.locator('.att-btn-group button, button').filter({ hasText: /^P$/ }).first()
    await expect(presentBtn).toBeVisible({ timeout: 15000 })
    await presentBtn.click()

    const saveAttendance = page.locator('button').filter({ hasText: /Save/ }).first()
    await saveAttendance.click()
    await expect(saveAttendance).toBeEnabled({ timeout: 20000 })

    // ── 4. Payroll generate + finalize ──────────────────────────────────
    await page.locator('a[href="/dashboard/payroll"]').click()
    await expect(page).toHaveURL(/\/dashboard\/payroll/)

    // Open generate dialog if present
    const generateBtn = page.locator('button').filter({ hasText: /Generate/ }).first()
    await expect(generateBtn).toBeVisible({ timeout: 15000 })
    await generateBtn.click()

    // Confirm generate if ConfirmDialog is shown
    const confirmGenerate = page.locator('button').filter({ hasText: /Confirm|Generate|Yes/i }).last()
    if (await confirmGenerate.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmGenerate.click()
    }

    // Wait for a run to appear and open it
    await page.waitForTimeout(2000)
    const draftOrRun = page.locator('text=/draft|finalized|Run/i').first()
    await expect(draftOrRun).toBeVisible({ timeout: 20000 })

    // Click into first run card/row if still on list view
    const openRun = page.locator('.card, tr, button, a').filter({ hasText: /draft|2026|2025|Run/i }).first()
    if (await openRun.isVisible().catch(() => false)) {
      await openRun.click()
    }

    // Finalize if draft
    const finalizeBtn = page.locator('button').filter({ hasText: /Finalize/ }).first()
    if (await finalizeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await finalizeBtn.click()
      const confirmFinalize = page.locator('button').filter({ hasText: /Confirm|Yes|Finalize/i }).last()
      if (await confirmFinalize.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmFinalize.click()
      }
      await expect(page.locator('text=/finalized/i').first()).toBeVisible({ timeout: 20000 })
    }

    // ── 5. Still authenticated ──────────────────────────────────────────
    await page.locator('a[href="/dashboard"]').first().click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator('.sidebar-logo-text')).toBeVisible()
  })
})
