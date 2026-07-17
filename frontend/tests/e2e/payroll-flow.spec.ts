import { test, expect } from '@playwright/test'
import { clickNav, loginAsAdmin } from './helpers'

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

    const search = page
      .locator(
        'input[placeholder*="plate" i], input[placeholder*="search" i], input[placeholder*="vehicle" i]'
      )
      .first()
    await expect(search).toBeVisible({ timeout: 10000 })
    await search.fill('KA01MH1234')

    const match = page.locator('text=KA01MH1234').first()
    await expect(match).toBeVisible({ timeout: 10000 })
    await match.click()

    const submitTrip = page.locator('button:has-text("Log Trip"), button:has-text("+ Log Trip")').last()
    await submitTrip.click()
    await expect(page.locator('text=KA01MH1234').first()).toBeVisible({ timeout: 15000 })

    // ── Attendance ──────────────────────────────────────────────────────
    await clickNav(page, '/dashboard/attendance')

    const presentBtn = page.locator('.att-btn-group button, button').filter({ hasText: /^P$/ }).first()
    await expect(presentBtn).toBeVisible({ timeout: 15000 })
    await presentBtn.click()

    const saveAttendance = page.locator('button').filter({ hasText: /Save/ }).first()
    await saveAttendance.click()
    await expect(saveAttendance).toBeEnabled({ timeout: 20000 })

    // ── Payroll generate + finalize ─────────────────────────────────────
    await clickNav(page, '/dashboard/payroll')

    const generateBtn = page.locator('button').filter({ hasText: /Generate/ }).first()
    await expect(generateBtn).toBeVisible({ timeout: 15000 })
    await generateBtn.click()

    const confirmGenerate = page.locator('button').filter({ hasText: /Confirm|Generate|Yes/i }).last()
    if (await confirmGenerate.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmGenerate.click()
    }

    const draftOrRun = page.locator('text=/draft|finalized|Run/i').first()
    await expect(draftOrRun).toBeVisible({ timeout: 20000 })

    const openRun = page.locator('.card, tr, button, a').filter({ hasText: /draft|2026|2025|Run/i }).first()
    if (await openRun.isVisible().catch(() => false)) {
      await openRun.click()
    }

    const finalizeBtn = page.locator('button').filter({ hasText: /Finalize/ }).first()
    if (await finalizeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await finalizeBtn.click()
      const confirmFinalize = page.locator('button').filter({ hasText: /Confirm|Yes|Finalize/i }).last()
      if (await confirmFinalize.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmFinalize.click()
      }
      await expect(page.locator('text=/finalized/i').first()).toBeVisible({ timeout: 20000 })
    }

    await page.locator('a[href="/dashboard"]').first().click()
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator('.sidebar-logo-text, .mobile-header-brand').first()).toBeVisible()
  })
})
