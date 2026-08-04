/**
 * Shared MDM trip-cost resolution: admin rate × commercial quantity.
 * Rate is ₹ per org commercial unit (m³ or unit). Optional rateIsPerM3
 * converts legacy ₹/m³ rates when the org uses unit mode.
 */
import {
  resolveTripRateForCustomer,
  type CustomerRateRow,
  type RateRow,
  type TripRateSource,
} from './trip-constants'
import { computeCommercialTripWorth, type TripOpsPolicy, DEFAULT_TRIP_OPS_POLICY } from './trip-ops-policy'

export type ResolvedTripCost = {
  rate: number | null
  source: TripRateSource | 'manual'
  worth: number | null
}

/**
 * Resolve MDM rate for vehicle/customer/org (honoring asOfDate effective windows),
 * then compute total = rate × commercial capacity.
 */
export function resolveMdmTripCost(opts: {
  vehicleType: string
  /** Quantity in the org’s commercial unit (stored on trips.cubic_capacity) */
  capacity: number
  customer?: CustomerRateRow | null
  orgRates?: RateRow[] | null
  asOfDate?: string | null
  manualEntered?: number | null
  tripOps?: TripOpsPolicy | null
  /** Treat resolved rate as ₹/m³ even when org quantity_unit is unit */
  rateIsPerM3?: boolean
}): ResolvedTripCost {
  const policy = opts.tripOps ?? DEFAULT_TRIP_OPS_POLICY
  const { rate, source } = resolveTripRateForCustomer(
    opts.vehicleType,
    opts.customer,
    opts.orgRates,
    opts.asOfDate
  )
  if (rate != null && rate > 0) {
    const worth = computeCommercialTripWorth({
      commercialQty: opts.capacity,
      ratePerCommercialOrM3: rate,
      policy,
      rateIsPerM3: opts.rateIsPerM3 === true,
    })
    return {
      rate,
      source,
      worth,
    }
  }
  const manual = opts.manualEntered
  if (manual != null && Number.isFinite(manual) && manual > 0) {
    return { rate: null, source: 'manual', worth: manual }
  }
  return { rate: null, source: 'none', worth: null }
}
