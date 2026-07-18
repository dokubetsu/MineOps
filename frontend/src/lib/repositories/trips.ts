import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { computeTripWorth, computeTripWorthFromRate, roundMoney } from '../calculations'

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
}

function normalizeWorth(payload: TripCreateInput): number | null {
  if (payload.trip_worth != null && !Number.isNaN(Number(payload.trip_worth))) {
    return computeTripWorth({ tripWorth: payload.trip_worth })
  }
  // Flat per-trip rate (reference paper: 12WH ₹1000, 10WH ₹800)
  if (payload.rate_per_cubic != null && !Number.isNaN(Number(payload.rate_per_cubic))) {
    return computeTripWorth({ rateAmount: payload.rate_per_cubic })
  }
  return null
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
   * Always normalizes trip_worth (and total_shipment_cost default) via shared math.
   */
  async create(
    supabase: SupabaseClient<Database>,
    payload: TripCreateInput
  ): Promise<TripRow> {
    const worth = normalizeWorth(payload)
    const total =
      payload.total_shipment_cost != null && !Number.isNaN(Number(payload.total_shipment_cost))
        ? roundMoney(Number(payload.total_shipment_cost))
        : worth

    const { data, error } = await supabase
      .from('trips')
      .insert({
        ...payload,
        rate_per_cubic:
          payload.rate_per_cubic != null ? Number(payload.rate_per_cubic) : null,
        trip_worth: worth,
        total_shipment_cost: total,
        entry_time: new Date().toISOString(),
        active: true,
      })
      .select()
      .single()

    if (error) throw error
    return data
  },

  async update(
    supabase: SupabaseClient<Database>,
    id: string,
    payload: TripUpdate & { rate_per_cubic?: number | null }
  ): Promise<TripRow> {
    const patch: TripUpdate & { rate_per_cubic?: number | null } = { ...payload }

    if (payload.trip_worth != null && !Number.isNaN(Number(payload.trip_worth))) {
      patch.trip_worth = computeTripWorth({ tripWorth: payload.trip_worth })
    } else if (payload.rate_per_cubic != null) {
      patch.trip_worth = computeTripWorth({ rateAmount: payload.rate_per_cubic })
    }
    if (payload.total_shipment_cost != null) {
      patch.total_shipment_cost = roundMoney(Number(payload.total_shipment_cost))
    } else if (patch.trip_worth != null) {
      patch.total_shipment_cost = patch.trip_worth
    }
    if (payload.rate_per_cubic != null) {
      patch.rate_per_cubic = Number(payload.rate_per_cubic)
    }

    const { data, error } = await supabase
      .from('trips')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error
    return data
  },

  async delete(supabase: SupabaseClient<Database>, id: string): Promise<void> {
    const { error } = await supabase
      .from('trips')
      .update({ active: false })
      .eq('id', id)

    if (error) throw error
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
