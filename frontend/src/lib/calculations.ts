/**
 * Pure business calculation helpers shared by repositories, UI, and tests.
 * Keep side-effect free so unit tests exercise the exact production math.
 */

export type CashEntryType = 'in' | 'out'

export interface CashBalanceEntry {
  entry_type: CashEntryType
  amount: number
  active?: boolean | null
}

export interface EmployeeWageConfig {
  wage_type: 'daily' | 'monthly' | string
  wage_rate: number
}

export interface AttendanceCounts {
  present: number
  halfDay: number
  leave: number
  absent: number
}

/** Closing cash balance = opening + in − out (inactive/soft-deleted entries ignored). */
export function calculateClosingBalance(
  openingBalance: number,
  entries: CashBalanceEntry[]
): number {
  const activeEntries = entries.filter((e) => e.active !== false)
  const totalIn = activeEntries
    .filter((e) => e.entry_type === 'in')
    .reduce((sum, e) => sum + Number(e.amount), 0)
  const totalOut = activeEntries
    .filter((e) => e.entry_type === 'out')
    .reduce((sum, e) => sum + Number(e.amount), 0)
  return openingBalance + totalIn - totalOut
}

/** Round money to 2 decimal places with banker's-safe epsilon. */
export function roundMoney(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100
}

/**
 * Payroll wage for one employee in a period.
 *
 * Policy (see docs/wage_policy.md):
 * - daily: (present + halfDay*0.5 + leave) * rate  — leave is paid; only marked days pay
 * - monthly: rate * (1 - (absent + halfDay*0.5) / periodDays)
 *   Leave does NOT reduce monthly salary (treated as paid leave).
 *   Days with no attendance row are NOT treated as absent — mark A explicitly.
 */
export function computePayrollWage(
  emp: EmployeeWageConfig,
  att: AttendanceCounts,
  periodDays?: number
): number {
  const rate = Number(emp.wage_rate) || 0
  if (emp.wage_type === 'monthly') {
    const totalDays = periodDays && periodDays > 0 ? periodDays : 30
    const computed = rate * Math.max(0, 1 - (att.absent + att.halfDay * 0.5) / totalDays)
    return roundMoney(computed)
  }
  const computed = (att.present + att.halfDay * 0.5 + att.leave) * rate
  return roundMoney(computed)
}

/** Stakeholder revenue share rounded to nearest rupee. */
export function calculateStakeholderShare(net: number, sharePercent: number): number {
  return Math.round((net * sharePercent) / 100)
}

/**
 * Trip worth from rate card / manual entry.
 * Prefer explicit trip_worth; otherwise rate * cubic capacity when both present.
 */
export function computeTripWorth(params: {
  tripWorth?: number | null
  rateAmount?: number | null
  cubicCapacity?: number | null
}): number {
  if (params.tripWorth != null && !Number.isNaN(Number(params.tripWorth))) {
    return roundMoney(Number(params.tripWorth))
  }
  const rate = Number(params.rateAmount) || 0
  const capacity = Number(params.cubicCapacity) || 0
  return roundMoney(rate * capacity)
}

/** Remaining leave balance after an approved leave of `days` (never below 0). */
export function applyLeaveBalance(currentBalance: number, days: number): number {
  return Math.max(0, Number(currentBalance) - Number(days))
}

/** Calendar days inclusive between two Date objects (date-only, local calendar). */
export function calendarDaysInRange(periodStart: Date, periodEnd: Date): number {
  const start = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate())
  const end = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate())
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1
}

/**
 * Payroll period bounds for `yyyy-MM` (or `yyyy-MM-dd`) in **local** calendar time.
 * Avoids `new Date('yyyy-MM-dd')` UTC parse which shifts the day in negative TZ.
 */
export function payrollPeriodBounds(periodMonth: string): {
  periodDate: string
  periodStart: Date
  periodEnd: Date
  periodDays: number
  startIso: string
  endIso: string
} {
  const ym = periodMonth.slice(0, 7)
  const [ys, ms] = ym.split('-')
  const y = parseInt(ys, 10)
  const m = parseInt(ms, 10) // 1–12
  if (!y || !m || m < 1 || m > 12) {
    throw new Error(`Invalid payroll period: ${periodMonth}`)
  }
  const periodStart = new Date(y, m - 1, 1)
  const periodEnd = new Date(y, m, 0) // last day of month, local
  const pad = (n: number) => String(n).padStart(2, '0')
  const periodDate = `${y}-${pad(m)}-01`
  const startIso = periodDate
  const endIso = `${y}-${pad(m)}-${pad(periodEnd.getDate())}`
  return {
    periodDate,
    periodStart,
    periodEnd,
    periodDays: calendarDaysInRange(periodStart, periodEnd),
    startIso,
    endIso,
  }
}

/** Inclusive leave duration in calendar days from ISO date strings (yyyy-MM-dd). */
export function leaveDaysBetween(fromDate: string, toDate: string): number {
  const from = new Date(fromDate + 'T00:00:00')
  const to = new Date(toDate + 'T00:00:00')
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return 0
  }
  return calendarDaysInRange(from, to)
}

/**
 * Trip worth from rate × capacity when the user has not overridden worth.
 * Used by trip forms for auto-fill defaults.
 */
export function computeTripWorthFromRate(
  cubicCapacity: number | string | null | undefined,
  ratePerCubic: number | string | null | undefined
): number {
  return computeTripWorth({
    rateAmount: ratePerCubic != null ? Number(ratePerCubic) : null,
    cubicCapacity: cubicCapacity != null ? Number(cubicCapacity) : null,
  })
}

/**
 * Format INR for KPI cards and dense UI.
 * Uses compact notation (e.g. ₹1L) for |amount| ≥ 1,00,000 so values fit small cards.
 * Full amount is still available via title tooltips in the UI.
 */
export function formatInr(
  amount: number | null | undefined,
  options?: { compact?: boolean; forceCompactAt?: number }
): string {
  const n = Number(amount)
  const value = Number.isFinite(n) ? n : 0
  const threshold = options?.forceCompactAt ?? 100_000
  const useCompact = options?.compact !== false && Math.abs(value) >= threshold

  if (useCompact) {
    try {
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(value)
    } catch {
      /* fall through */
    }
  }

  const sign = value < 0 ? '-' : ''
  return `${sign}₹${Math.abs(value).toLocaleString('en-IN')}`
}

/** Compact non-currency metric for KPI values (counts, CUM, etc.). */
export function formatMetric(
  amount: number | null | undefined,
  options?: { compactAt?: number; maxFractionDigits?: number }
): string {
  const n = Number(amount)
  const value = Number.isFinite(n) ? n : 0
  const compactAt = options?.compactAt ?? 10_000
  if (Math.abs(value) >= compactAt) {
    try {
      return new Intl.NumberFormat('en-IN', {
        notation: 'compact',
        maximumFractionDigits: options?.maxFractionDigits ?? 1,
      }).format(value)
    } catch {
      /* fall through */
    }
  }
  return value.toLocaleString('en-IN', {
    maximumFractionDigits: options?.maxFractionDigits ?? 0,
  })
}
