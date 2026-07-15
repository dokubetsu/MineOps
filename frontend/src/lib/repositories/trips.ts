import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'

export const tripsRepository = {
  async list(supabase: SupabaseClient<Database>, siteId: string, date: string, limit = 50, offset = 0): Promise<any[]> {
    const { data, error } = await supabase
      .from('trips')
      .select('*, vehicles(plate_number, vehicle_type), transport_contractors(name), drivers(name)')
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
    payload: {
      site_id: string
      vehicle_id: string | null
      contractor_id: string | null
      trip_date: string
      ownership_snapshot: string
      dd_number: string | null
      permit_number: string | null
      load_info: string | null
      notes: string | null
      photo_url: string | null
    }
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
      settlement_amount: number
      settlement_account: string
    }
  ): Promise<void> {
    const { error } = await supabase
      .from('trips')
      .update({
        settled: true,
        settlement_amount: payload.settlement_amount,
        settlement_account: payload.settlement_account,
      })
      .eq('id', id)

    if (error) throw error
  }
}
