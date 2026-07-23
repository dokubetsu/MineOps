/**
 * Resolve free-text contractor name → transport_contractors.id
 * Prefers SECURITY DEFINER RPC (migration 058); falls back to select + insert.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export async function resolveOrCreateContractorId(
  supabase: SupabaseClient<Database>,
  orgId: string | null | undefined,
  nameOrEmpty: string | null | undefined
): Promise<string | null> {
  const name = (nameOrEmpty || '').trim()
  if (!name) return null

  // Prefer RPC (handles RLS for site employees)
  const { data: rpcId, error: rpcErr } = await supabase.rpc('resolve_or_create_contractor', {
    p_name: name,
  })
  if (!rpcErr && rpcId) return rpcId as string

  if (!orgId) {
    if (rpcErr) throw rpcErr
    return null
  }

  // Fallback: match existing
  const { data: existing } = await supabase
    .from('transport_contractors')
    .select('id, name')
    .eq('organization_id', orgId)
    .ilike('name', name)
    .limit(5)

  const exact = (existing || []).find(
    (c) => c.name.trim().toLowerCase() === name.toLowerCase()
  )
  if (exact?.id) return exact.id

  const { data: created, error: insErr } = await supabase
    .from('transport_contractors')
    .insert({
      name,
      organization_id: orgId,
      active: true,
    })
    .select('id')
    .single()

  if (insErr) {
    // Race: another writer created same name
    const { data: retry } = await supabase
      .from('transport_contractors')
      .select('id')
      .eq('organization_id', orgId)
      .ilike('name', name)
      .limit(1)
      .maybeSingle()
    if (retry?.id) return retry.id
    throw insErr
  }
  return created?.id ?? null
}

/** Display name for a contractor id from a local list */
export function contractorNameById(
  contractors: Array<{ id: string; name: string }>,
  id: string | null | undefined
): string {
  if (!id) return ''
  return contractors.find((c) => c.id === id)?.name || ''
}
