import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { computeTripWorth } from '../calculations'

export type TripInsert = Database['public']['Tables']['trips']['Insert']
export type TripRow = Database['public']['Tables']['trips']['Row']

export type TripListItem = TripRow & {
  vehicles?: { plate_number: string; vehicle_type: string } | null
  transport_contractors?: { name: string } | null
  drivers?: { name: string } | null
  customers?: { name: string } | null
  trip_photos?: Array<{ photo_url: string }> | null
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

  async create(
    supabase: SupabaseClient<Database>,
    payload: Omit<TripInsert, 'id' | 'created_at' | 'updated_at' | 'entry_time' | 'active'>
  ): Promise<TripRow> {
    // Normalize worth via shared module when rate/capacity provided without explicit worth
    const normalized: typeof payload = {
      ...payload,
      trip_worth:
        payload.trip_worth != null
          ? computeTripWorth({ tripWorth: payload.trip_worth })
          : payload.trip_worth,
    }

    const { data, error } = await supabase
      .from('trips')
      .insert({
        ...normalized,
        entry_time: new Date().toISOString(),
        active: true,
      })
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
    const { error } = await supabase
      .from('trips')
      .update({
        settled: true,
        settled_at: new Date().toISOString(),
        settled_by: payload.settled_by || null,
        payment_status: 'settled',
        payment_method: payload.payment_method,
        payment_reference: payload.payment_reference,
        settlement_amount: payload.settlement_amount || 0,
        settlement_account: payload.settlement_account || null,
        settlement_method: payload.payment_method || null,
        settlement_ref: payload.payment_reference || null,
      })
      .eq('id', id)

    if (error) throw error
  }
}
