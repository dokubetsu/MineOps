/**
 * Per-org trip ops policies — billing visibility, settlement, quantity units.
 * Loaded from organizations.*; never hard-code org IDs.
 */

export type QuantityUnit = 'm3' | 'unit'

export type TripOpsPolicy = {
  billingAdminOnly: boolean
  settlementAdminOnly: boolean
  quantityUnit: QuantityUnit
  unitsPerM3: number
}

export const DEFAULT_TRIP_OPS_POLICY: TripOpsPolicy = {
  billingAdminOnly: false,
  settlementAdminOnly: false,
  quantityUnit: 'm3',
  unitsPerM3: 1,
}

export type AppRole =
  | 'admin'
  | 'site_manager'
  | 'stakeholder'
  | 'employee'
  | 'site_employee'
  | 'unload_clerk'

export const ROLE_PRIORITY: readonly AppRole[] = [
  'admin',
  'site_manager',
  'unload_clerk',
  'stakeholder',
  'employee',
  'site_employee',
] as const

export function pickPrimaryRole(
  roles: (string | { role: string })[] | null | undefined
): AppRole | null {
  if (!roles || roles.length === 0) return null
  const roleStrings = roles.map((r) => (typeof r === 'string' ? r : r.role))
  for (const prio of ROLE_PRIORITY) {
    if (roleStrings.includes(prio)) return prio
  }
  return null
}

export function tripOpsFromOrgRow(row: {
  billing_admin_only?: boolean | null
  settlement_admin_only?: boolean | null
  quantity_unit?: string | null
  units_per_m3?: number | string | null
} | null | undefined): TripOpsPolicy {
  if (!row) return { ...DEFAULT_TRIP_OPS_POLICY }
  const unit = row.quantity_unit === 'unit' ? 'unit' : 'm3'
  const unitsPerM3 = Number(row.units_per_m3)
  return {
    billingAdminOnly: row.billing_admin_only === true,
    settlementAdminOnly: row.settlement_admin_only === true,
    quantityUnit: unit,
    unitsPerM3: Number.isFinite(unitsPerM3) && unitsPerM3 > 0 ? unitsPerM3 : 1,
  }
}

/** Tenant admin only when org policy restricts billing. */
export function canSeeTripBilling(
  role: string | null | undefined,
  policy: TripOpsPolicy
): boolean {
  if (!policy.billingAdminOnly) return true
  return role === 'admin'
}

/** Tenant admin only when org policy restricts settlement. */
export function canSettleTrips(
  role: string | null | undefined,
  policy: TripOpsPolicy
): boolean {
  if (!policy.settlementAdminOnly) return true
  return role === 'admin'
}

export function canDocumentUnload(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'unload_clerk'
}

/** Rate / capacity label for the org’s commercial unit. */
export function quantityUnitLabel(policy: TripOpsPolicy): string {
  return policy.quantityUnit === 'unit' ? 'unit' : 'm³'
}

export function rateUnitLabel(policy: TripOpsPolicy): string {
  return policy.quantityUnit === 'unit' ? '₹/unit' : '₹/m³'
}

export function otherTripCostsLabel(): string {
  return 'Other costs'
}

/**
 * Vehicle-type default capacity is defined in m³.
 * Convert to the org’s commercial quantity for form defaults.
 */
export function defaultCommercialCapacity(
  vehicleType: string,
  policy: TripOpsPolicy,
  m3ForType: (type: string) => string | number
): string {
  const m3 = Number(m3ForType(vehicleType))
  if (!Number.isFinite(m3) || m3 <= 0) return ''
  if (policy.quantityUnit === 'unit') {
    return String(roundQty(m3 * policy.unitsPerM3))
  }
  return String(m3)
}

/** Commercial qty → m³ (for reports / internal equivalence). */
export function commercialQtyToM3(qty: number, policy: TripOpsPolicy): number {
  if (!Number.isFinite(qty)) return 0
  if (policy.quantityUnit === 'm3') return qty
  return qty / policy.unitsPerM3
}

/** m³ → commercial qty. */
export function m3ToCommercialQty(m3: number, policy: TripOpsPolicy): number {
  if (!Number.isFinite(m3)) return 0
  if (policy.quantityUnit === 'm3') return m3
  return m3 * policy.unitsPerM3
}

/**
 * Billing worth: rate is always ₹ per commercial unit; qty is commercial qty.
 * When rates were historically ₹/m³ and org switches to unit mode without
 * re-entering rates, pass rateIsPerM3=true to convert: worth = (rate/unitsPerM3)*qty.
 * Default: rates match the org commercial unit (no extra conversion).
 */
export function computeCommercialTripWorth(opts: {
  commercialQty: number
  ratePerCommercialOrM3: number
  policy: TripOpsPolicy
  /** If true, treat rate as ₹/m³ and convert using units_per_m3 */
  rateIsPerM3?: boolean
}): number | null {
  const qty = opts.commercialQty
  const rate = opts.ratePerCommercialOrM3
  if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(rate) || rate <= 0) return null
  let ratePerCommercial = rate
  if (opts.rateIsPerM3 && opts.policy.quantityUnit === 'unit') {
    ratePerCommercial = rate / opts.policy.unitsPerM3
  }
  return Math.round(ratePerCommercial * qty * 100) / 100
}

function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000
}
