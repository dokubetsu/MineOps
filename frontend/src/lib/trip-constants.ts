/**
 * Shared trip / expense domain constants used by admin trips + my-work.
 *
 * Trip total cost = customer rate (₹/m³) × cubic capacity.
 * Distance, drop location, etc. are reporting-only (not in total cost).
 */

export const VEHICLE_TYPES = ['12WH', '10WH', '6WH', 'Other'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

/** Must match DB CHECK on vehicles.ownership ('rented' | 'owned'). */
export const OWNERSHIP_TYPES = ['rented', 'owned'] as const
export type OwnershipType = (typeof OWNERSHIP_TYPES)[number]

/**
 * Site expense categories (cash book OUT).
 * Trip Expense (Fastag) and Fuel/Diesel support optional transport contractor.
 */
export const EXPENSE_CATEGORIES = [
  'Meal Expense',
  'Trip Expense (Fastag payment)',
  'Fuel / Diesel expense',
  'Advance salary',
  'Advance for trip',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

/** Categories that display an optional transport contractor field */
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
  'Trip settlement collection',
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
 * @deprecated Removed — admin must configure rates in Settings → Org rates.
 * Returns 0 to signal "no default available."
 */
export function getDefaultTripRate(_type: string): number {
  return 0
}

/** @deprecated Use org negotiated rates. Returns 0. */
export function getDefaultRatePerCubic(type: string): number {
  return getDefaultTripRate(type)
}

export type RateRow = {
  vehicle_type?: string | null
  rate_per_cubic?: number | string | null
  rate_per_km?: number | string | null
  effective_from?: string | null
  effective_to?: string | null
}

/** True when asOfDate is within [effective_from, effective_to] (NULL to = open-ended). */
export function isRateEffectiveOn(
  asOfDate: string | null | undefined,
  effectiveFrom?: string | null,
  effectiveTo?: string | null
): boolean {
  if (!asOfDate) return true
  const asOf = asOfDate.slice(0, 10)
  if (effectiveFrom && asOf < effectiveFrom.slice(0, 10)) return false
  if (effectiveTo && asOf > effectiveTo.slice(0, 10)) return false
  return true
}

/**
 * Prefer org negotiated rate (stored in rate_per_cubic as ₹/m³).
 * No app default — trip cost is entered manually when no rate is configured.
 * Pass asOfDate (trip_date) to honor effective_from / effective_to (migration 060).
 */
export function resolveTripRate(
  vehicleType: string,
  rates: RateRow[] | null | undefined,
  asOfDate?: string | null
): { rate: number | null; fromNegotiated: boolean; source: 'vehicle_type' | 'none' } {
  const row = (rates || []).find(
    (r) =>
      r.vehicle_type === vehicleType &&
      isRateEffectiveOn(asOfDate, r.effective_from, r.effective_to)
  )
  const negotiated = row != null ? Number(row.rate_per_cubic) : NaN
  if (Number.isFinite(negotiated) && negotiated > 0) {
    return { rate: negotiated, fromNegotiated: true, source: 'vehicle_type' }
  }
  return { rate: null, fromNegotiated: false, source: 'none' }
}

export type CustomerRateRow = {
  id?: string
  default_trip_rate?: number | string | null
  trip_rates?: Record<string, number | string> | null
  rates_effective_from?: string | null
  rates_effective_to?: string | null
}

export type TripRateSource =
  | 'customer_type'
  | 'customer_default'
  | 'vehicle_type'
  | 'none'

/**
 * ₹/m³ rate hint for a trip (never invents an app default):
 * 1) customer trip_rates[vehicleType] (₹/m³)
 * 2) customer default_trip_rate (₹/m³)
 * 3) org negotiated_rates by vehicle type (₹/m³)
 * 4) none — user enters trip cost manually
 *
 * asOfDate (typically trip_date) filters customer + org effective date windows.
 */
export function resolveTripRateForCustomer(
  vehicleType: string,
  customer: CustomerRateRow | null | undefined,
  orgRates: RateRow[] | null | undefined,
  asOfDate?: string | null
): { rate: number | null; source: TripRateSource } {
  if (
    customer &&
    isRateEffectiveOn(asOfDate, customer.rates_effective_from, customer.rates_effective_to)
  ) {
    const map = customer.trip_rates || {}
    const typed = Number(map[vehicleType])
    if (Number.isFinite(typed) && typed > 0) {
      return { rate: typed, source: 'customer_type' }
    }
    const def = Number(customer.default_trip_rate)
    if (Number.isFinite(def) && def > 0) {
      return { rate: def, source: 'customer_default' }
    }
  }
  const base = resolveTripRate(vehicleType, orgRates, asOfDate)
  return { rate: base.rate, source: base.source }
}

/** @deprecated Use resolveTripRate */
export function resolveRatePerCubic(
  vehicleType: string,
  rates: RateRow[] | null | undefined
): { rate: number | null; fromNegotiated: boolean } {
  const r = resolveTripRate(vehicleType, rates)
  return { rate: r.rate, fromNegotiated: r.fromNegotiated }
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

/**
 * Look up org rate_per_km (₹/km) for a vehicle type from org rates.
 */
export function resolveDistanceRate(
  vehicleType: string,
  negotiatedRates?: Array<{
    vehicle_type: string
    rate_per_km?: number | null
    effective_from?: string | null
    effective_to?: string | null
  }> | null,
  asOfDate?: string | null
): number | null {
  if (!negotiatedRates || !vehicleType) return null
  const match = negotiatedRates.find(
    (r) =>
      r.vehicle_type === vehicleType &&
      isRateEffectiveOn(asOfDate, r.effective_from, r.effective_to)
  )
  const rate = Number(match?.rate_per_km)
  if (Number.isFinite(rate) && rate > 0) return rate
  return null
}
