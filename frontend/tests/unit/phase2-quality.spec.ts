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
import { partitionAttendanceSave } from '../../src/lib/repositories/attendance'
import { checkRateLimitMemory, pruneRateLimitStore } from '../../src/lib/rate-limit'
import { toErrorMessage } from '../../src/lib/errors'
import {
  getCapacityForType,
  getDefaultRatePerCubic,
  resolveRatePerCubic,
  VEHICLE_TYPES,
} from '../../src/lib/trip-constants'

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

test.describe('Phase 4 error + trip helpers', () => {
  test('toErrorMessage normalizes Error, string, and unknown', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom')
    expect(toErrorMessage('plain')).toBe('plain')
    expect(toErrorMessage({ message: 'obj' })).toBe('obj')
    expect(toErrorMessage(null, 'fallback')).toBe('fallback')
  })

  test('getCapacityForType covers vehicle types', () => {
    expect(getCapacityForType('12WH')).toBe('20')
    expect(getCapacityForType('10WH')).toBe('16')
    expect(VEHICLE_TYPES).toContain('Other')
  })

  test('resolveTripRate uses negotiated rates only (no app default price)', () => {
    expect(resolveRatePerCubic('12WH', []).rate).toBeNull()
    expect(resolveRatePerCubic('12WH', []).fromNegotiated).toBe(false)
    // Deprecated seed helper returns 0
    expect(getDefaultRatePerCubic('10WH')).toBe(0)
    expect(
      resolveRatePerCubic('12WH', [{ vehicle_type: '12WH', rate_per_cubic: 1200 }]).rate
    ).toBe(1200)
    expect(
      resolveRatePerCubic('12WH', [{ vehicle_type: '12WH', rate_per_cubic: 1200 }]).fromNegotiated
    ).toBe(true)
  })

  test('resolveTripRateForCustomer prefers customer rates; no app default', async () => {
    const { resolveTripRateForCustomer } = await import('../../src/lib/trip-constants')
    const r = resolveTripRateForCustomer(
      '12WH',
      { trip_rates: { '12WH': 1100 }, default_trip_rate: 900 },
      [{ vehicle_type: '12WH', rate_per_cubic: 1000 }]
    )
    expect(r.rate).toBe(1100)
    expect(r.source).toBe('customer_type')
    const r2 = resolveTripRateForCustomer(
      '6WH',
      { trip_rates: {}, default_trip_rate: 900 },
      []
    )
    expect(r2.rate).toBe(900)
    expect(r2.source).toBe('customer_default')
    const r3 = resolveTripRateForCustomer('12WH', null, [])
    expect(r3.rate).toBeNull()
    expect(r3.source).toBe('none')
  })
})

test.describe('Attendance save partition (Phase 0 unmark)', () => {
  test('splits marked upserts from null clears', () => {
    const { toUpsert, toClear } = partitionAttendanceSave([
      { employee_id: 'a', att_date: '2026-07-01', status: 'present', photo_url: null },
      { employee_id: 'b', att_date: '2026-07-01', status: null, photo_url: null },
      { employee_id: 'c', att_date: '2026-07-01', status: 'leave', photo_url: 'x' },
      { employee_id: 'd', att_date: '2026-07-01', status: null, photo_url: null },
    ])
    expect(toUpsert.map((r) => r.employee_id)).toEqual(['a', 'c'])
    expect(toClear.map((r) => r.employee_id)).toEqual(['b', 'd'])
  })

  test('all-unmarked is only clears (DELETE path)', () => {
    const { toUpsert, toClear } = partitionAttendanceSave([
      { employee_id: 'a', att_date: '2026-07-01', status: null, photo_url: null },
    ])
    expect(toUpsert).toHaveLength(0)
    expect(toClear).toHaveLength(1)
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
