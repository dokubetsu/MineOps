import { test, expect } from '@playwright/test'

/**
 * MineOps End-to-End Business Flow Integration Test
 * 
 * NOTE: This test is configured for local execution against a running instance with seeded data.
 * To run:
 * 1. Ensure the Supabase database has a test admin account (e.g. user: admin@mineops.com, password: password123).
 * 2. Start the local server using `npm run dev` or `npm run start` inside the frontend directory.
 * 3. Run: `npx playwright test`
 */
test.describe('MineOps End-to-End Business Flow', () => {
  test('User can login, log a trip, record attendance, run and finalize payroll, and view stakeholder revenue', async ({ page }) => {
    // 1. Login page
    await page.goto('/')
    await expect(page).toHaveTitle(/MineOps/)
    
    // Fill credentials
    await page.fill('input[type="email"]', 'admin@mineops.com')
    await page.fill('input[type="password"]', 'password123')
    await page.click('button[type="submit"]')
    
    // Validate redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page.locator('.sidebar-logo-text')).toBeVisible()

    // 2. Trips Logging
    await page.click('a[href="/dashboard/trips"]')
    await expect(page).toHaveURL(/\/dashboard\/trips/)
    
    // Log a new trip
    await page.click('button:has-text("Log Trip")')
    await page.fill('input[placeholder*="plate"]', 'KA01MH1234')
    await page.selectOption('select[name="ownership"]', 'rented')
    await page.fill('input[name="load_info"]', 'Coal 25 Tons')
    await page.click('button:has-text("Save Trip")')
    
    // Validate trip card appears in the list
    await expect(page.locator('text=KA01MH1234')).toBeVisible()

    // 3. Attendance Capturing
    await page.click('a[href="/dashboard/attendance"]')
    await expect(page).toHaveURL(/\/dashboard\/attendance/)
    
    // Toggle first employee's status to 'present' and save roster
    await page.click('.attendance-toggles >> text=P')
    await page.click('button:has-text("Save All")')
    
    // Wait for the Save All button to complete saving (spinner disappears, button is re-enabled)
    const saveButton = page.locator('button:has-text("Save All")')
    await expect(saveButton).toBeEnabled()

    // 4. Payroll Operations
    await page.click('a[href="/dashboard/payroll"]')
    await expect(page).toHaveURL(/\/dashboard\/payroll/)
    
    // Register dialog listener BEFORE the action that triggers the prompt
    page.on('dialog', async dialog => {
      await dialog.accept()
    })
    
    // Select current month and click generate
    await page.click('button:has-text("Generate Payroll")')
    
    // Wait for the payroll data table rows to render
    await expect(page.locator('table.data-table tbody tr')).toBeVisible()
    
    // Finalize the payroll run
    await page.click('button:has-text("Finalize")')
    await expect(page.locator('span:has-text("finalized")')).toBeVisible()

    // 5. Stakeholder Dashboard View
    await page.click('a[href="/dashboard/stakeholder"]')
    await expect(page).toHaveURL(/\/dashboard\/stakeholder/)
    
    // Verify revenue share summary widget has non-zero calculations
    const shareCard = page.locator('.stat-card.card-accent')
    await expect(shareCard).toBeVisible()
    const myShareText = await shareCard.locator('.stat-value').textContent()
    expect(myShareText).not.toBe('₹0')
  })
})
