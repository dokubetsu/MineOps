import { test, expect } from '@playwright/test'

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
    await expect(page.locator('text=MineOps')).toBeVisible()

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
    await page.click('button:has-text("Save Roster")')
    await expect(page.locator('text=All saved')).toBeVisible()

    // 4. Payroll Operations
    await page.click('a[href="/dashboard/payroll"]')
    await expect(page).toHaveURL(/\/dashboard\/payroll/)
    
    // Select current month and click generate
    await page.click('button:has-text("Generate Payroll")')
    
    // If overwrite confirmation pops up, handle it
    page.on('dialog', async dialog => {
      await dialog.accept()
    })
    
    // Wait for the payroll rows to render
    await expect(page.locator('.payroll-line-row')).toBeVisible()
    
    // Finalize the payroll run
    await page.click('button:has-text("Finalize Payroll")')
    await expect(page.locator('text=Status: finalized')).toBeVisible()

    // 5. Stakeholder Dashboard View
    await page.click('a[href="/dashboard/stakeholder"]')
    await expect(page).toHaveURL(/\/dashboard\/stakeholder/)
    
    // Verify revenue share summary widget has non-zero calculations
    await expect(page.locator('.revenue-share-card')).toBeVisible()
    const myShareText = await page.locator('.revenue-share-amount').textContent()
    expect(myShareText).not.toBe('₹0')
  })
})
