/**
 * Shared trip / expense domain constants used by admin trips + my-work.
 *
 * Trip pricing follows field reference paper (local reference/ folder, untracked):
 *   trip value = fixed ₹ per trip by vehicle type (not distance, not m³).
 * Column `negotiated_rates.rate_per_cubic` stores that ₹/trip value
 * (historical column name; product meaning is per trip).
 */

export const VEHICLE_TYPES = ['12WH', '10WH', '6WH', 'Other'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

export const OWNERSHIP_TYPES = ['rented', 'leased', 'owned'] as const
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number]

/**
 * Site expense categories (cash book OUT).
 * Trip Expense (Fastag) and Fuel/Diesel require transport contractor.
 */
export const EXPENSE_CATEGORIES = [
  'Meal Expense',
  'Trip Expense (Fastag payment)',
  'Fuel / Diesel expense',
  'Advance salary',
  'Advance for trip',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

/** Categories that require an optional/required transport contractor field */
export const EXPENSE_CATEGORIES_WITH_CONTRACTOR: readonly string[] = [
  'Trip Expense (Fastag payment)',
  'Fuel / Diesel expense',
]

export function expenseRequiresContractor(category: string): boolean {
  return EXPENSE_CATEGORIES_WITH_CONTRACTOR.includes(category)
}

/** Cash book admin UI — outgoing types (align with field expense list + legacy) */
export const CASH_ENTRY_CATEGORIES_OUT = [
  ...EXPENSE_CATEGORIES,
  'Repair & Spares',
  'Other outgoing',
] as const

export const CASH_ENTRY_CATEGORIES_IN = [
  'Cash received from main office',
  'Other incoming',
] as const

/** Default cubic capacity for a vehicle type (ops logging only; not used in price). */
export function getCapacityForType(type: string): string {
  switch (type) {
    case '12WH':
      return '20'
    case '10WH':
      return '16'
    case '6WH':
      return '10'
    default:
      return '8'
  }
}

/**
 * Fallback ₹ **per trip** when Master Data has no negotiated_rates row.
 * Matches field business report (12WH ₹1000, 10WH ₹800).
 */
export function getDefaultTripRate(type: string): number {
  switch (type) {
    case '12WH':
      return 1000
    case '10WH':
      return 800
    case '6WH':
      return 600
    default:
      return 500
  }
}

/** @deprecated Use getDefaultTripRate — same values, old name */
export function getDefaultRatePerCubic(type: string): number {
  return getDefaultTripRate(type)
}

export type RateRow = { vehicle_type?: string | null; rate_per_cubic?: number | string | null }

/**
 * Prefer org negotiated rate (stored in rate_per_cubic as ₹/trip); else built-in default.
 */
export function resolveTripRate(
  vehicleType: string,
  rates: RateRow[] | null | undefined
): { rate: number; fromNegotiated: boolean } {
  const row = (rates || []).find((r) => r.vehicle_type === vehicleType)
  const negotiated = row != null ? Number(row.rate_per_cubic) : NaN
  if (Number.isFinite(negotiated) && negotiated > 0) {
    return { rate: negotiated, fromNegotiated: true }
  }
  return { rate: getDefaultTripRate(vehicleType), fromNegotiated: false }
}

/** @deprecated Use resolveTripRate */
export function resolveRatePerCubic(
  vehicleType: string,
  rates: RateRow[] | null | undefined
): { rate: number; fromNegotiated: boolean } {
  return resolveTripRate(vehicleType, rates)
}

export function vehicleTypeLabel(type: string): string {
  switch (type) {
    case '12WH':
      return '12 Wheeler (12WH)'
    case '10WH':
      return '10 Wheeler (10WH)'
    case '6WH':
      return '6 Wheeler (6WH)'
    default:
      return type || 'Other'
  }
}
