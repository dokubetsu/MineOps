import { test, expect } from '@playwright/test'
import {
  calculateClosingBalance,
  computePayrollWage,
  calculateStakeholderShare,
  calendarDaysInRange,
  leaveDaysBetween,
  applyLeaveBalance,
  computeTripWorthFromRate,
  computeTripWorth,
  payrollPeriodBounds,
} from '../../src/lib/calculations'

test.describe('Business Calculations (shared module)', () => {
  test('should accurately calculate daily cash book closing balance including soft-deletes filtering', () => {
    const openingBalance = 10000
    const entries = [
      { entry_type: 'in' as const, amount: 5000, active: true },
      { entry_type: 'out' as const, amount: 2000, active: true },
      { entry_type: 'out' as const, amount: 1500, active: false }, // Soft-deleted entry
      { entry_type: 'in' as const, amount: 3000, active: true },
    ]

    const closing = calculateClosingBalance(openingBalance, entries)
    // 10000 + 5000 + 3000 - 2000 = 16000
    expect(closing).toBe(16000)
  })

  test('should accurately compute payroll wages for daily employees', () => {
    const emp = { wage_type: 'daily' as const, wage_rate: 600 }
    const att = { present: 20, halfDay: 4, leave: 2, absent: 0 }

    const wage = computePayrollWage(emp, att)
    // (20 + 4 * 0.5 + 2) * 600 = 24 * 600 = 14400
    expect(wage).toBe(14400)
  })

  test('should prorate monthly employees for absences and half-days', () => {
    const emp = { wage_type: 'monthly' as const, wage_rate: 25000 }
    const att = { present: 10, halfDay: 2, leave: 10, absent: 5 }
    // 30-day period: 1 - (5 + 1) / 30 = 24/30 → 20000
    const wage = computePayrollWage(emp, att, 30)
    expect(wage).toBe(20000)
  })

  test('should use calendar days in period for monthly proration', () => {
    const periodStart = new Date(2026, 1, 1) // Feb 2026 (non-leap)
    const periodEnd = new Date(2026, 1, 28)
    const days = calendarDaysInRange(periodStart, periodEnd)
    expect(days).toBe(28)

    const emp = { wage_type: 'monthly' as const, wage_rate: 28000 }
    const att = { present: 20, halfDay: 0, leave: 0, absent: 2 }
    // 1 - 2/28 = 26/28 → 26000
    expect(computePayrollWage(emp, att, days)).toBe(26000)
  })

  test('should accurately calculate stakeholder revenue share rounded to nearest rupee', () => {
    const netRevenue = 153245
    const sharePercent = 12.5

    const share = calculateStakeholderShare(netRevenue, sharePercent)
    // 153245 * 0.125 = 19155.625 -> rounds to 19156
    expect(share).toBe(19156)
  })

  test('should handle decimal precision correctly during Daily Wage computations', () => {
    const emp = { wage_type: 'daily' as const, wage_rate: 555.55 }
    const att = { present: 5, halfDay: 1, leave: 0, absent: 0 }

    const wage = computePayrollWage(emp, att)
    // (5 + 0.5) * 555.55 = 5.5 * 555.55 = 3055.525 -> rounds to 3055.53
    expect(wage).toBe(3055.53)
  })

  test('should compute leave duration and remaining balance', () => {
    expect(leaveDaysBetween('2026-07-01', '2026-07-03')).toBe(3)
    expect(leaveDaysBetween('2026-07-05', '2026-07-01')).toBe(0)
    expect(applyLeaveBalance(15, 3)).toBe(12)
    expect(applyLeaveBalance(2, 5)).toBe(0)
  })

  test('should compute trip worth from rate × capacity', () => {
    expect(computeTripWorthFromRate(20, 150)).toBe(3000)
    expect(computeTripWorth({ tripWorth: 2500.555 })).toBe(2500.56)
  })

  test('payrollPeriodBounds uses local calendar (Feb non-leap = 28)', () => {
    const b = payrollPeriodBounds('2026-02')
    expect(b.periodDate).toBe('2026-02-01')
    expect(b.startIso).toBe('2026-02-01')
    expect(b.endIso).toBe('2026-02-28')
    expect(b.periodDays).toBe(28)
  })

  test('payrollPeriodBounds accepts yyyy-MM-dd input', () => {
    const b = payrollPeriodBounds('2026-07-01')
    expect(b.periodDays).toBe(31)
    expect(b.endIso).toBe('2026-07-31')
  })
})
