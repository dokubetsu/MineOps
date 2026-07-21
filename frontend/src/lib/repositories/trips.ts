import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { computeTripWorth, roundMoney } from '../calculations'
import { cashBookRepository } from './cash-book'

export type TripInsert = Database['public']['Tables']['trips']['Insert']
export type TripRow = Database['public']['Tables']['trips']['Row']
export type TripUpdate = Database['public']['Tables']['trips']['Update']

export type TripListItem = TripRow & {
  vehicles?: { plate_number: string; vehicle_type: string } | null
  transport_contractors?: { name: string } | null
  drivers?: { name: string } | null
  customers?: { name: string } | null
  trip_photos?: Array<{ photo_url: string }> | null
}

export type TripCreateInput = Omit<
  TripInsert,
  'id' | 'created_at' | 'updated_at' | 'entry_time' | 'active'
> & {
  /** Flat ₹ per trip by vehicle type (column name historical: rate_per_cubic) */
  rate_per_cubic?: number | null
  /** Optional plate for cash advance note */
  _vehicle_plate?: string | null
}

/**
 * Trip cost is explicit only — never invent from rate defaults.
 * If trip_worth empty but total_shipment_cost set, use that for worth.
 */
function normalizeWorth(payload: TripCreateInput): number | null {
  if (payload.trip_worth != null && !Number.isNaN(Number(payload.trip_worth))) {
    return computeTripWorth({ tripWorth: payload.trip_worth })
  }
  if (
    payload.total_shipment_cost != null &&
    !Number.isNaN(Number(payload.total_shipment_cost))
  ) {
    return computeTripWorth({ tripWorth: payload.total_shipment_cost })
  }
  return null
}

async function syncAdvanceFromTrip(
  supabase: SupabaseClient<Database>,
  trip: TripRow,
  vehiclePlate?: string | null
): Promise<void> {
  try {
    await cashBookRepository.syncTripAdvance(supabase, {
      siteId: trip.site_id,
      bookDate: String(trip.trip_date).slice(0, 10),
      tripId: trip.id,
      amount: trip.advance_amount,
      contractorId: trip.contractor_id,
      vehiclePlate: vehiclePlate ?? null,
    })
  } catch (err) {
    // Feature gate / RLS / locked book — keep trip; cash can be fixed later
    console.warn('[trips] advance → cash sync failed', err)
  }
}

export const tripsRepository = {
  async list(
    supabase: SupabaseClient<Database>,
    siteId: string,
    date: string,
    limit = 50,
    offset = 0
  ): Promise<TripListItem[]> {
    const { data, error } = await supabase
      .from('trips')
      .select('*, vehicles(plate_number, vehicle_type), transport_contractors(name), drivers(name), customers(name), trip_photos(photo_url)')
      .eq('site_id', siteId)
      .eq('trip_date', date)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    return (data as TripListItem[]) || []
  },

  /**
   * Single create path for admin trips + my-work.
   * Trip cost is explicit; advance_amount is mirrored into cash book OUT.
   */
  async create(
    supabase: SupabaseClient<Database>,
    payload: TripCreateInput
  ): Promise<TripRow> {
    const { _vehicle_plate, ...insertPayload } = payload
    const worth = normalizeWorth(payload)
    const total =
      payload.total_shipment_cost != null && !Number.isNaN(Number(payload.total_shipment_cost))
        ? roundMoney(Number(payload.total_shipment_cost))
        : worth

    const { data, error } = await supabase
      .from('trips')
      .insert({
        ...insertPayload,
        rate_per_cubic:
          payload.rate_per_cubic != null && Number(payload.rate_per_cubic) > 0
            ? Number(payload.rate_per_cubic)
            : null,
        trip_worth: worth,
        total_shipment_cost: total,
        advance_amount: roundMoney(Number(payload.advance_amount) || 0),
        entry_time: new Date().toISOString(),
        active: true,
      })
      .select()
      .single()

    if (error) throw error
    await syncAdvanceFromTrip(supabase, data, _vehicle_plate)
    return data
  },

  async update(
    supabase: SupabaseClient<Database>,
    id: string,
    payload: TripUpdate & { rate_per_cubic?: number | null; _vehicle_plate?: string | null }
  ): Promise<TripRow> {
    const { _vehicle_plate, ...rest } = payload
    const patch: TripUpdate & { rate_per_cubic?: number | null } = { ...rest }

    if (payload.trip_worth != null && !Number.isNaN(Number(payload.trip_worth))) {
      patch.trip_worth = computeTripWorth({ tripWorth: payload.trip_worth })
    }
    // Do not invent trip_worth from rate_per_cubic
    if (payload.total_shipment_cost != null) {
      patch.total_shipment_cost = roundMoney(Number(payload.total_shipment_cost))
    } else if (patch.trip_worth != null && payload.trip_worth != null) {
      // only auto-fill shipment when caller sent trip_worth and left shipment unset
      if (payload.total_shipment_cost === undefined) {
        // leave shipment as-is unless trip_worth was the only cost field
      }
    }
    if (payload.rate_per_cubic != null) {
      const r = Number(payload.rate_per_cubic)
      patch.rate_per_cubic = Number.isFinite(r) && r > 0 ? r : null
    }
    if (payload.advance_amount != null) {
      patch.advance_amount = roundMoney(Number(payload.advance_amount) || 0)
    }

    const { data, error } = await supabase
      .from('trips')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    await syncAdvanceFromTrip(supabase, data, _vehicle_plate)
    return data
  },

  async delete(supabase: SupabaseClient<Database>, id: string): Promise<void> {
    // Load site/date for advance cleanup
    const { data: existing } = await supabase
      .from('trips')
      .select('id, site_id, trip_date, advance_amount')
      .eq('id', id)
      .maybeSingle()

    const { error } = await supabase
      .from('trips')
      .update({ active: false })
      .eq('id', id)

    if (error) throw error

    if (existing) {
      try {
        await cashBookRepository.syncTripAdvance(supabase, {
          siteId: existing.site_id,
          bookDate: String(existing.trip_date).slice(0, 10),
          tripId: existing.id,
          amount: 0,
        })
      } catch (err) {
        console.warn('[trips] advance cleanup on delete failed', err)
      }
    }
  },

  async settle(
    supabase: SupabaseClient<Database>,
    id: string,
    payload: {
      settlement_amount?: number
      settlement_account?: string
      payment_status?: string
      payment_method?: string
      payment_reference?: string
      settled_by?: string
    }
  ): Promise<void> {
    // Phase 1: settled trips require amount > 0 (DB trigger also enforces)
    if (payload.settlement_amount == null || Number.isNaN(Number(payload.settlement_amount))) {
      throw new Error('Settlement amount is required and must be greater than zero')
    }
    const amount = roundMoney(Number(payload.settlement_amount))
    if (amount <= 0) {
      throw new Error('Settlement amount must be greater than zero')
    }

    const { error } = await supabase
      .from('trips')
      .update({
        settled: true,
        settled_at: new Date().toISOString(),
        settled_by: payload.settled_by || null,
        payment_status: 'settled',
        payment_method: payload.payment_method,
        payment_reference: payload.payment_reference,
        settlement_amount: amount,
        settlement_account: payload.settlement_account || null,
        settlement_method: payload.payment_method || null,
        settlement_ref: payload.payment_reference || null,
      })
      .eq('id', id)

    if (error) {
      const msg = error.message || ''
      if (/settlement_amount|greater than zero/i.test(msg)) {
        throw new Error('Settlement amount must be greater than zero')
      }
      throw error
    }
  },
}
