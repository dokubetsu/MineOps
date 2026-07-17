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
  /** When trip_worth omitted, compute from rate × capacity */
  rate_per_cubic?: number | null
}

function normalizeWorth(payload: TripCreateInput): number | null {
  if (payload.trip_worth != null && !Number.isNaN(Number(payload.trip_worth))) {
    return computeTripWorth({ tripWorth: payload.trip_worth })
  }
  if (payload.rate_per_cubic != null || payload.cubic_capacity != null) {
    return computeTripWorthFromRate(payload.cubic_capacity, payload.rate_per_cubic)
  }
  return payload.trip_worth != null ? roundMoney(Number(payload.trip_worth)) : null
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
    const { rate_per_cubic: _rate, ...rest } = payload
    const worth = normalizeWorth(payload)
    const total =
      rest.total_shipment_cost != null && !Number.isNaN(Number(rest.total_shipment_cost))
        ? roundMoney(Number(rest.total_shipment_cost))
        : worth

    const { data, error } = await supabase
      .from('trips')
      .insert({
        ...rest,
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
    const { rate_per_cubic, ...rest } = payload
    const patch: TripUpdate = { ...rest }

    if (rest.trip_worth != null && !Number.isNaN(Number(rest.trip_worth))) {
      patch.trip_worth = computeTripWorth({ tripWorth: rest.trip_worth })
    } else if (rate_per_cubic != null || rest.cubic_capacity != null) {
      patch.trip_worth = computeTripWorthFromRate(rest.cubic_capacity, rate_per_cubic)
    }
    if (rest.total_shipment_cost != null) {
      patch.total_shipment_cost = roundMoney(Number(rest.total_shipment_cost))
    } else if (patch.trip_worth != null) {
      patch.total_shipment_cost = patch.trip_worth
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
    const amount =
      payload.settlement_amount != null
        ? roundMoney(Number(payload.settlement_amount))
        : 0

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

    if (error) throw error
  },
}
