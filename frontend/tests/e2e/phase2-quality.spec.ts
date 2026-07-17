import { test, expect } from '@playwright/test'
import {
  calculateClosingBalance,
  computePayrollWage,
  leaveDaysBetween,
  applyLeaveBalance,
  roundMoney,
} from '../../src/lib/calculations'
import {
  stripSignedUrls,
  setOfflineCache,
  getOfflineCache,
  clearOfflineCache,
} from '../../src/lib/offline-cache'
import { featureForPath, featuresFromRows, defaultFeatureMap } from '../../src/lib/features'
import { passwordSchema, PASSWORD_MIN_LENGTH } from '../../src/lib/password-policy'
import { leaveRepository, LeaveError } from '../../src/lib/repositories/leave'
import { checkRateLimitMemory, pruneRateLimitStore } from '../../src/lib/rate-limit'

/**
 * Phase 2 quality suite — pure unit cases (no browser).
 * Co-located under tests/e2e so Playwright runner executes them like calculations.spec.ts.
 */

test.describe('Wage policy edges', () => {
  test('daily leave is paid; unmarked days pay nothing', () => {
    const wage = computePayrollWage(
      { wage_type: 'daily', wage_rate: 500 },
      { present: 2, halfDay: 0, leave: 1, absent: 0 }
    )
    // (2 + 1) * 500
    expect(wage).toBe(1500)
  })

  test('monthly leave does not reduce salary; unmarked not absent', () => {
    const wage = computePayrollWage(
      { wage_type: 'monthly', wage_rate: 30000 },
      { present: 10, halfDay: 0, leave: 5, absent: 0 },
      30
    )
    // no absences / half-days → full salary
    expect(wage).toBe(30000)
  })

  test('half-day reduces monthly by half day fraction', () => {
    const wage = computePayrollWage(
      { wage_type: 'monthly', wage_rate: 30000 },
      { present: 20, halfDay: 2, leave: 0, absent: 0 },
      30
    )
    // 1 - (0 + 1) / 30 = 29/30 → 29000
    expect(wage).toBe(29000)
  })

  test('cash closing ignores inactive entries', () => {
    expect(
      calculateClosingBalance(1000, [
        { entry_type: 'in', amount: 200, active: true },
        { entry_type: 'out', amount: 50, active: false },
        { entry_type: 'out', amount: 100, active: true },
      ])
    ).toBe(1100)
  })

  test('leave days and balance helpers', () => {
    expect(leaveDaysBetween('2026-07-01', '2026-07-10')).toBe(10)
    expect(applyLeaveBalance(5, 3)).toBe(2)
    expect(applyLeaveBalance(2, 5)).toBe(0)
  })

  test('roundMoney stable for adjustments', () => {
    expect(roundMoney(100.005)).toBe(100.01)
    expect(roundMoney(10 + 0.1 + 0.2)).toBe(10.3)
  })
})

test.describe('Feature path gating helpers', () => {
  test('featureForPath maps dashboard modules', () => {
    expect(featureForPath('/dashboard/payroll')).toBe('payroll')
    expect(featureForPath('/dashboard/cash-book')).toBe('cash_book')
    expect(featureForPath('/dashboard/trips/extra')).toBe('trips')
    expect(featureForPath('/dashboard')).toBeNull()
    expect(featureForPath('/dashboard/my-work')).toBeNull()
  })

  test('featuresFromRows fail-closed: missing keys stay off', () => {
    const map = featuresFromRows([
      { feature_key: 'payroll', enabled: false },
      { feature_key: 'trips', enabled: true },
    ])
    expect(map.payroll).toBe(false)
    expect(map.trips).toBe(true)
    expect(map.attendance).toBe(false) // Phase B: missing row = off
  })

  test('featuresFromRows empty → all off', () => {
    const map = featuresFromRows([])
    expect(map.payroll).toBe(false)
    expect(map.trips).toBe(false)
  })

  test('defaultFeatureMap fail-closed by default', () => {
    const map = defaultFeatureMap()
    expect(map.payroll).toBe(false)
    expect(map.master_data).toBe(false)
  })

  test('defaultFeatureMap can still seed all on for platform seeds', () => {
    const map = defaultFeatureMap(true)
    expect(map.payroll).toBe(true)
  })
})

test.describe('Password policy', () => {
  test('rejects short and weak passwords', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false)
    expect(passwordSchema.safeParse('allletters').success).toBe(false)
    expect(passwordSchema.safeParse('1234567890').success).toBe(false)
  })

  test('accepts strong enough password', () => {
    expect(passwordSchema.safeParse('mineops2026').success).toBe(true)
    expect(PASSWORD_MIN_LENGTH).toBe(10)
  })
})

test.describe('Offline cache hygiene', () => {
  test('stripSignedUrls removes signed URL fields', () => {
    const cleaned = stripSignedUrls({
      id: '1',
      receipt_url: 'path/to/file.jpg',
      signed_receipt_url: 'https://example.com/signed',
      nested: { signed_photo_urls: 'https://x', ok: true },
    })
    expect(cleaned).toEqual({
      id: '1',
      receipt_url: 'path/to/file.jpg',
      nested: { ok: true },
    })
  })

  test('set/get/clear require browser localStorage — no throw when missing', () => {
    // Playwright Node context: localStorage may be absent; helpers no-op safely
    expect(() => {
      setOfflineCache('u1', 'o1', 'k', { a: 1 })
      getOfflineCache('u1', 'o1', 'k')
      clearOfflineCache()
    }).not.toThrow()
  })
})

test.describe('Leave repository validation', () => {
  test('validateRange rejects inverted and too-long ranges', () => {
    expect(() => leaveRepository.validateRange('2026-07-10', '2026-07-01')).toThrow(LeaveError)
    expect(() => leaveRepository.validateRange('2026-07-01', '2026-08-15')).toThrow(LeaveError)
    expect(leaveRepository.validateRange('2026-07-01', '2026-07-05')).toBe(5)
  })
})

test.describe('Rate limit helper (Phase E memory backend)', () => {
  test('limits after N hits in window', () => {
    const key = `test-${Date.now()}-${Math.random()}`
    for (let i = 0; i < 3; i++) {
      const r = checkRateLimitMemory(key, 3, 60_000)
      expect(r.limited).toBe(false)
      expect(r.backend).toBe('memory')
    }
    const blocked = checkRateLimitMemory(key, 3, 60_000)
    expect(blocked.limited).toBe(true)
    expect(blocked.remaining).toBe(0)
    expect(pruneRateLimitStore(Date.now() + 120_000)).toBeGreaterThanOrEqual(0)
  })
})
