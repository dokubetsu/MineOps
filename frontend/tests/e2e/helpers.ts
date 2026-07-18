import { expect, type Locator, type Page } from '@playwright/test'

export const E2E_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@mineops.com'
export const E2E_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'password123'

/**
 * Dashboard shell markers. On mobile the desktop sidebar stays in the DOM with
 * display:none — never use .first() on a mixed list of hidden + visible nodes.
 */
export function visibleDashboardShell(page: Page) {
  return page
    .locator('.mobile-header-brand, .sidebar-logo-text, .bottom-nav, .mobile-header')
    .filter({ visible: true })
    .first()
}

/**
 * Page content text that is actually visible (skips hidden sidebar/nav clones).
 * Prefer .page-title for headings when possible.
 */
export function visiblePageText(page: Page, pattern: RegExp) {
  return page.getByText(pattern).filter({ visible: true }).first()
}

/** Main content page title (Cash Book, Leave Applications, etc.). */
export function pageTitle(page: Page, pattern: RegExp) {
  return page.locator('h1.page-title, .page-title, h1').filter({ hasText: pattern }).filter({ visible: true }).first()
}

/** Login as demo tenant admin and wait for dashboard shell (desktop or mobile). */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15000 })
  await page.locator('input[type="email"]').fill(E2E_EMAIL)
  await page.locator('input[type="password"]').fill(E2E_PASSWORD)
  await page.locator('button[type="submit"]').click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 25000 })
  await expect(visibleDashboardShell(page)).toBeVisible({ timeout: 15000 })
}

/**
 * Navigate to a dashboard path. On mobile, Attendance/Leave/Payroll live under
 * the More sheet (sidebar links are display:none). Falls back to page.goto.
 */
export async function clickNav(page: Page, href: string): Promise<void> {
  const urlRe = new RegExp(href.replace(/\//g, '\\/'))

  // Prefer real navigation via URL when already mid-suite (avoids hidden sidebar clicks)
  const visibleLink = page.locator(`a[href="${href}"]`).filter({ visible: true }).first()
  if (await visibleLink.isVisible({ timeout: 1500 }).catch(() => false)) {
    await visibleLink.click()
    await expect(page).toHaveURL(urlRe, { timeout: 15000 })
    return
  }

  // Mobile bottom-nav "More" → sheet with secondary modules
  const moreBtn = page
    .locator('button[aria-label="More operations"], .bottom-nav-item')
    .filter({ hasText: /More/i })
    .filter({ visible: true })
    .first()

  if (await moreBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await moreBtn.click()
    const sheetLink = page
      .locator(`.more-sheet a[href="${href}"], [role="dialog"] a[href="${href}"]`)
      .filter({ visible: true })
      .first()
    if (await sheetLink.isVisible({ timeout: 4000 }).catch(() => false)) {
      await sheetLink.click()
      await expect(page).toHaveURL(urlRe, { timeout: 15000 })
      return
    }
  }

  // Reliable on mobile: deep-link (same auth session)
  await page.goto(href)
  await expect(page).toHaveURL(urlRe, { timeout: 15000 })
}

/**
 * react-hot-toast messages — role=status when present; also match common toast containers.
 */
export function toastLocator(page: Page, pattern: RegExp) {
  return page
    .locator('[role="status"], [class*="toast"], div[data-hot-toast], li[role="status"]')
    .filter({ hasText: pattern })
    .first()
}

/** Wait until a primary action button finishes its in-flight "Saving…" state. */
export async function waitForSaveIdle(_page: Page, button: Locator): Promise<void> {
  await expect
    .poll(async () => {
      const text = (await button.innerText().catch(() => '')) || ''
      return /Saving/i.test(text) ? 'busy' : 'idle'
    }, { timeout: 25000 })
    .toBe('idle')
}

/**
 * After attendance Save: accept success toast OR Save disabled (!isDirty) without error toast.
 * Avoids flakes when toast auto-dismisses or role=status is missing briefly.
 */
export async function expectAttendanceSaveOk(page: Page, saveBtn: Locator, successPattern: RegExp): Promise<void> {
  const toastOk = toastLocator(page, successPattern)
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => 'toast' as const)
    .catch(() => null)

  const dirtyCleared = expect(saveBtn)
    .toBeDisabled({ timeout: 20000 })
    .then(() => 'disabled' as const)
    .catch(() => null)

  const result = await Promise.race([toastOk, dirtyCleared])
  if (!result) {
    const errText = await page.getByText(/Error saving attendance|Permission denied/i).count()
    throw new Error(
      `Attendance save did not show success toast or clear dirty state (errors on page: ${errText})`
    )
  }
  await waitForSaveIdle(page, saveBtn)
  const fatal = await page.getByText(/Permission denied saving attendance|Error saving attendance/i).count()
  expect(fatal).toBe(0)
}

/**
 * Click Confirm inside a ConfirmDialog if it appears; never match page-level
 * Generate/Finalize buttons (those caused flaky re-clicks while spinning).
 */
export async function confirmDialogIfOpen(
  page: Page,
  titleOrBody: RegExp,
  timeoutMs = 3000
): Promise<boolean> {
  const dialog = page.getByRole('dialog').filter({ hasText: titleOrBody })
  if (!(await dialog.isVisible({ timeout: timeoutMs }).catch(() => false))) {
    return false
  }
  const confirm = dialog.locator(
    '[data-testid="confirm-dialog-confirm"], button:has-text("Confirm")'
  )
  await confirm.click({ timeout: 8000 })
  return true
}
