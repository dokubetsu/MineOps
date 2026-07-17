import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'

export type TripInsert = Database['public']['Tables']['trips']['Insert']

export const tripsRepository = {
  async list(supabase: SupabaseClient<Database>, siteId: string, date: string, limit = 50, offset = 0): Promise<any[]> {
    const { data, error } = await supabase
      .from('trips')
      .select('*, vehicles(plate_number, vehicle_type), transport_contractors(name), drivers(name), customers(name), trip_photos(photo_url)')
      .eq('site_id', siteId)
      .eq('trip_date', date)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error
    return data || []
  },

  async create(
    supabase: SupabaseClient<Database>,
    payload: Omit<TripInsert, 'id' | 'created_at' | 'updated_at' | 'entry_time' | 'active'>
  ): Promise<any> {
    const { data, error } = await supabase
      .from('trips')
      .insert({
        ...payload,
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
