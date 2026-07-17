import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { Site } from '../supabase/types'

/**
 * Shared site list helpers — prefer this over copy-pasted selects in pages.
 */
export const sitesRepository = {
  async listActive(
    supabase: SupabaseClient<Database>,
    limit = 500
  ): Promise<Site[]> {
    const { data, error } = await supabase
      .from('sites')
      .select('*')
      .eq('active', true)
      .order('name')
      .limit(limit)

    if (error) throw error
    return (data as Site[]) || []
  },

  async listAll(
    supabase: SupabaseClient<Database>,
    limit = 200
  ): Promise<Site[]> {
    const { data, error } = await supabase
      .from('sites')
      .select('*')
      .order('name')
      .limit(limit)

    if (error) throw error
    return (data as Site[]) || []
  },
}
