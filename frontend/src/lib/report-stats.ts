/**
 * Pure report aggregations aligned with field paper (reference/):
 * daily trip sheet, weekly/monthly type counts, business ₹/trip pack.
 */

export type VehicleTypeKey = '12WH' | '10WH' | '6WH' | 'Other'

export interface TripStatRow {
  trip_date?: string | null
  permit_number?: string | null
  trip_worth?: number | string | null
  total_shipment_cost?: number | string | null
  advance_amount?: number | string | null
  payment_status?: string | null
  settled?: boolean | null
  vehicles?: { plate_number?: string | null; vehicle_type?: string | null } | null
  transport_contractors?: { name?: string | null } | null
  created_by?: string | null
}

export function isNoPermit(trip: TripStatRow): boolean {
  const p = (trip.permit_number || '').trim()
  return p.length === 0
}

export function tripVehicleType(trip: TripStatRow): VehicleTypeKey {
  const t = trip.vehicles?.vehicle_type || 'Other'
  if (t === '12WH' || t === '10WH' || t === '6WH') return t
  return 'Other'
}

export function tripCost(trip: TripStatRow): number {
  return Number(trip.trip_worth ?? trip.total_shipment_cost) || 0
}

/** Paper weekly/monthly: 12WH / 10WH / 6WH / NO.P / total */
export function countTripsByType(trips: TripStatRow[]): {
  '12WH': number
  '10WH': number
  '6WH': number
  Other: number
  noPermit: number
  total: number
} {
  const out = { '12WH': 0, '10WH': 0, '6WH': 0, Other: 0, noPermit: 0, total: trips.length }
  for (const t of trips) {
    out[tripVehicleType(t)] += 1
    if (isNoPermit(t)) out.noPermit += 1
  }
  return out
}

/** Daily counts keyed by yyyy-MM-dd */
export function dailyTripTypeCounts(trips: TripStatRow[]): Array<{
  date: string
  '12WH': number
  '10WH': number
  '6WH': number
  Other: number
  noPermit: number
  trips: number
}> {
  const map = new Map<
    string,
    { '12WH': number; '10WH': number; '6WH': number; Other: number; noPermit: number; trips: number }
  >()
  for (const t of trips) {
    const d = String(t.trip_date || '').slice(0, 10)
    if (!d) continue
    if (!map.has(d)) {
      map.set(d, { '12WH': 0, '10WH': 0, '6WH': 0, Other: 0, noPermit: 0, trips: 0 })
    }
    const row = map.get(d)!
    row[tripVehicleType(t)] += 1
    if (isNoPermit(t)) row.noPermit += 1
    row.trips += 1
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }))
}

/**
 * Business report style: count × average recorded trip cost → value.
 * Uses only real `trip_worth` / `total_shipment_cost` averages.
 * Never invents revenue from app hard-coded defaults (Excel-replacement integrity).
 * `defaultRates` kept for API compatibility but ignored for valuation.
 */
export function businessPackByType(
  trips: TripStatRow[],
  _defaultRates?: Record<string, number>
): Array<{
  vehicleType: string
  count: number
  ratePerTrip: number
  value: number
}> {
  const buckets: Record<string, { count: number; sum: number; withCost: number }> = {
    '12WH': { count: 0, sum: 0, withCost: 0 },
    '10WH': { count: 0, sum: 0, withCost: 0 },
    '6WH': { count: 0, sum: 0, withCost: 0 },
    Other: { count: 0, sum: 0, withCost: 0 },
  }
  for (const t of trips) {
    const vt = tripVehicleType(t)
    buckets[vt].count += 1
    const cost = tripCost(t)
    if (cost > 0) {
      buckets[vt].sum += cost
      buckets[vt].withCost += 1
    }
  }
  return (['12WH', '10WH', '6WH', 'Other'] as const).map((vehicleType) => {
    const b = buckets[vehicleType]
    // Average only over trips that have a recorded cost — no synthetic rates
    const ratePerTrip =
      b.withCost > 0 ? Math.round(b.sum / b.withCost) : 0
    // Value = sum of actual costs (not count × invented rate)
    const value = Math.round(b.sum)
    return { vehicleType, count: b.count, ratePerTrip, value }
  })
}

/** Serial daily sheet rows (paper: SL NO, vehicle, transport) */
export function dailyTripSheetRows(trips: TripStatRow[]): Array<{
  sl: number
  date: string
  plate: string
  transport: string
  vehicleType: string
  permit: string
  tripCost: number
}> {
  const sorted = [...trips].sort((a, b) => {
    const d = String(a.trip_date).localeCompare(String(b.trip_date))
    if (d !== 0) return d
    return (a.vehicles?.plate_number || '').localeCompare(b.vehicles?.plate_number || '')
  })
  return sorted.map((t, i) => ({
    sl: i + 1,
    date: String(t.trip_date || '').slice(0, 10),
    plate: t.vehicles?.plate_number || '',
    transport: t.transport_contractors?.name || '',
    vehicleType: tripVehicleType(t),
    permit: (t.permit_number || '').trim() || 'NO.P',
    tripCost: tripCost(t),
  }))
}

export function groupTripsByTransport(trips: TripStatRow[]): Array<{ name: string; count: number }> {
  const m = new Map<string, number>()
  for (const t of trips) {
    const name = (t.transport_contractors?.name || '—').trim() || '—'
    m.set(name, (m.get(name) || 0) + 1)
  }
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}
