/**
 * Shared MDM trip-cost resolution: admin rate (₹/m³) × cubic capacity.
 * Used by My Work + Trips to keep create/edit pricing consistent.
 */
import { computeTripWorthFromRate } from './calculations'
import {
  resolveTripRateForCustomer,
  type CustomerRateRow,
  type RateRow,
  type TripRateSource,
} from './trip-constants'

export type ResolvedTripCost = {
  rate: number | null
  source: TripRateSource | 'manual'
  worth: number | null
}

/**
 * Resolve MDM rate for vehicle/customer/org (honoring asOfDate effective windows),
 * then compute total = rate × capacity. Falls back to manualEntered when no rate.
 */
export function resolveMdmTripCost(opts: {
  vehicleType: string
  capacity: number
  customer?: CustomerRateRow | null
  orgRates?: RateRow[] | null
  asOfDate?: string | null
  manualEntered?: number | null
}): ResolvedTripCost {
  const { rate, source } = resolveTripRateForCustomer(
    opts.vehicleType,
    opts.customer,
    opts.orgRates,
    opts.asOfDate
  )
  if (rate != null && rate > 0) {
    return {
      rate,
      source,
      worth: computeTripWorthFromRate(opts.capacity, rate),
    }
  }
  const manual = opts.manualEntered
  if (manual != null && Number.isFinite(manual) && manual > 0) {
    return { rate: null, source: 'manual', worth: manual }
  }
  return { rate: null, source: 'none', worth: null }
}
