import { test, expect } from '@playwright/test'

// 1. Closing Balance calculation logic test
function calculateClosingBalance(openingBalance: number, entries: Array<{ entry_type: 'in' | 'out'; amount: number; active: boolean }>) {
  const activeEntries = entries.filter(e => e.active !== false)
  const totalIn = activeEntries.filter(e => e.entry_type === 'in').reduce((sum, e) => sum + e.amount, 0)
  const totalOut = activeEntries.filter(e => e.entry_type === 'out').reduce((sum, e) => sum + e.amount, 0)
  return openingBalance + totalIn - totalOut
}

// 2. Payroll Wage computation logic test
interface EmployeeWageConfig {
  wage_type: 'daily' | 'monthly'
  wage_rate: number
}
interface AttendanceCounts {
  present: number
  halfDay: number
  leave: number
  absent: number
}
function computePayrollWage(emp: EmployeeWageConfig, att: AttendanceCounts) {
  if (emp.wage_type === 'monthly') {
    return emp.wage_rate
  }
  const computed = (att.present + att.halfDay * 0.5 + att.leave) * emp.wage_rate
  return Math.round((computed + 1e-9) * 100) / 100
}

// 3. Stakeholder Share calculation logic test
function calculateStakeholderShare(net: number, sharePercent: number) {
  return Math.round((net * sharePercent) / 100)
}

test.describe('Business Calculations Unit Tests', () => {
  
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
    const emp: EmployeeWageConfig = { wage_type: 'daily', wage_rate: 600 }
    const att: AttendanceCounts = { present: 20, halfDay: 4, leave: 2, absent: 0 }

    const wage = computePayrollWage(emp, att)
    // (20 + 4 * 0.5 + 2) * 600 = 24 * 600 = 14400
    expect(wage).toBe(14400)
  })

  test('should compute fixed monthly rate for monthly employees regardless of attendance days', () => {
    const emp: EmployeeWageConfig = { wage_type: 'monthly', wage_rate: 25000 }
    const att: AttendanceCounts = { present: 10, halfDay: 2, leave: 10, absent: 5 }

    const wage = computePayrollWage(emp, att)
    expect(wage).toBe(25000)
  })

  test('should accurately calculate stakeholder revenue share rounded to nearest rupee', () => {
    const netRevenue = 153245
    const sharePercent = 12.5

    const share = calculateStakeholderShare(netRevenue, sharePercent)
    // 153245 * 0.125 = 19155.625 -> rounds to 19156
    expect(share).toBe(19156)
  })

  test('should handle decimal precision correctly during Daily Wage computations', () => {
    const emp: EmployeeWageConfig = { wage_type: 'daily', wage_rate: 555.55 }
    const att: AttendanceCounts = { present: 5, halfDay: 1, leave: 0, absent: 0 }

    const wage = computePayrollWage(emp, att)
    // (5 + 0.5) * 555.55 = 5.5 * 555.55 = 3055.525 -> rounds to 3055.53
    expect(wage).toBe(3055.53)
  })
})
