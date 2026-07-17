import { test, expect } from '@playwright/test'
import {
  computePayrollWage,
  payrollPeriodBounds,
  leaveDaysBetween,
  applyLeaveBalance,
  computeTripWorth,
  computeTripWorthFromRate,
  calculateClosingBalance,
  calendarDaysInRange,
  formatInr,
  formatMetric,
} from '../../src/lib/calculations'
import {
  featuresFromRows,
  defaultFeatureMap,
  featureForPath,
  isFeatureEnabled,
  FEATURE_KEYS,
} from '../../src/lib/features'
import { passwordSchema } from '../../src/lib/password-policy'
import { checkRateLimitMemory, rateLimitBackendLabel } from '../../src/lib/rate-limit'

/**
 * Phase D — pure business + entitlement unit suite (Playwright host, no browser deps).
 * Integration with live Supabase remains in payroll-flow / platform-flow e2e.
 */

test.describe('Payroll period bounds (local calendar)', () => {
  test('January has 31 days', () => {
    const b = payrollPeriodBounds('2026-01')
    expect(b.periodDays).toBe(31)
    expect(b.startIso).toBe('2026-01-01')
    expect(b.endIso).toBe('2026-01-31')
    expect(b.periodDate).toBe('2026-01-01')
  })

  test('February non-leap has 28 days', () => {
    expect(payrollPeriodBounds('2026-02').periodDays).toBe(28)
  })

  test('February leap year 2024 has 29 days', () => {
    expect(payrollPeriodBounds('2024-02').periodDays).toBe(29)
  })

  test('periodDays matches calendarDaysInRange on local dates', () => {
    const b = payrollPeriodBounds('2026-03')
    expect(b.periodDays).toBe(calendarDaysInRange(b.periodStart, b.periodEnd))
  })

  test('rejects invalid period', () => {
    expect(() => payrollPeriodBounds('not-a-date')).toThrow()
  })
})

test.describe('Payroll wage fixtures (attendance → amount)', () => {
  test('daily worker: 20 present + 2 half + 1 leave @ 600', () => {
    // (20 + 1 + 1) * 600 = 13200
    expect(
      computePayrollWage(
        { wage_type: 'daily', wage_rate: 600 },
        { present: 20, halfDay: 2, leave: 1, absent: 0 }
      )
    ).toBe(13200)
  })

  test('monthly: 2 absent + 2 half in 30-day month @ 30000', () => {
    // 1 - (2 + 1) / 30 = 27/30 → 27000
    expect(
      computePayrollWage(
        { wage_type: 'monthly', wage_rate: 30000 },
        { present: 20, halfDay: 2, leave: 3, absent: 2 },
        30
      )
    ).toBe(27000)
  })

  test('monthly leave does not reduce pay', () => {
    expect(
      computePayrollWage(
        { wage_type: 'monthly', wage_rate: 25000 },
        { present: 10, halfDay: 0, leave: 10, absent: 0 },
        30
      )
    ).toBe(25000)
  })

  test('uses periodDays from payrollPeriodBounds for monthly', () => {
    const { periodDays } = payrollPeriodBounds('2026-02')
    const wage = computePayrollWage(
      { wage_type: 'monthly', wage_rate: 28000 },
      { present: 20, halfDay: 0, leave: 0, absent: 2 },
      periodDays
    )
    // 1 - 2/28 = 26/28 → 26000
    expect(wage).toBe(26000)
  })
})

test.describe('Leave balance math', () => {
  test('approve deduct simulation', () => {
    const days = leaveDaysBetween('2026-07-01', '2026-07-05')
    expect(days).toBe(5)
    expect(applyLeaveBalance(15, days)).toBe(10)
  })

  test('insufficient balance clamp helper', () => {
    expect(applyLeaveBalance(2, 5)).toBe(0)
  })
})

test.describe('Trip worth normalize', () => {
  test('rate × capacity', () => {
    expect(computeTripWorthFromRate(25, 120)).toBe(3000)
  })
  test('explicit worth rounded', () => {
    expect(computeTripWorth({ tripWorth: 999.999 })).toBe(1000)
  })
})

test.describe('Cash closing', () => {
  test('opening + in − out', () => {
    expect(
      calculateClosingBalance(5000, [
        { entry_type: 'in', amount: 1000, active: true },
        { entry_type: 'out', amount: 250, active: true },
      ])
    ).toBe(5750)
  })
})

test.describe('Feature fail-closed + path map', () => {
  test('all FEATURE_KEYS off when empty rows', () => {
    const map = featuresFromRows([])
    for (const k of FEATURE_KEYS) {
      expect(isFeatureEnabled(map, k)).toBe(false)
    }
  })

  test('only explicit enabled keys on', () => {
    const map = featuresFromRows([
      { feature_key: 'payroll', enabled: true },
      { feature_key: 'trips', enabled: false },
    ])
    expect(map.payroll).toBe(true)
    expect(map.trips).toBe(false)
    expect(map.leave).toBe(false)
  })

  test('featureForPath covers modules; my-work is null', () => {
    expect(featureForPath('/dashboard/payroll')).toBe('payroll')
    expect(featureForPath('/dashboard/my-work')).toBeNull()
  })

  test('defaultFeatureMap(false) is fail-closed', () => {
    expect(defaultFeatureMap(false).cash_book).toBe(false)
  })

  test('master_data / users / manage_employees fail-closed when missing rows', () => {
    const map = featuresFromRows([{ feature_key: 'trips', enabled: true }])
    expect(map.trips).toBe(true)
    expect(map.master_data).toBe(false)
    expect(map.users).toBe(false)
    expect(map.manage_employees).toBe(false)
    expect(featureForPath('/dashboard/settings')).toBe('master_data')
    expect(featureForPath('/dashboard/users')).toBe('users')
    expect(featureForPath('/dashboard/manage-employees')).toBe('manage_employees')
  })
})

test.describe('Password policy (create-user / bootstrap)', () => {
  test('mineops2026 ok; short fails', () => {
    expect(passwordSchema.safeParse('mineops2026').success).toBe(true)
    expect(passwordSchema.safeParse('pass1').success).toBe(false)
  })
})

test.describe('Rate limit (Phase E)', () => {
  test('memory backend labels and enforces limit', () => {
    // Without Upstash env in unit host, backend is memory
    expect(rateLimitBackendLabel()).toBe('memory')
    const key = `phase-e-${Date.now()}-${Math.random()}`
    expect(checkRateLimitMemory(key, 2, 60_000).limited).toBe(false)
    expect(checkRateLimitMemory(key, 2, 60_000).limited).toBe(false)
    expect(checkRateLimitMemory(key, 2, 60_000).limited).toBe(true)
  })
})

test.describe('Dense UI number formatting', () => {
  test('formatInr compact for large amounts', () => {
    expect(formatInr(500)).toMatch(/₹5?00/)
    const compact = formatInr(-100_000)
    // compact or full — must not explode length for cards
    expect(compact.length).toBeLessThan(14)
    expect(formatInr(50_000, { compact: false })).toContain('50,000')
  })

  test('formatMetric keeps small counts readable', () => {
    expect(formatMetric(0)).toBe('0')
    expect(formatMetric(12.5, { maxFractionDigits: 1 })).toMatch(/12/)
  })
})
