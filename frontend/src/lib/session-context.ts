import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from './supabase/database.types'
import { AppRole } from './trip-ops-policy'

export interface SessionContextUserRole {
  user_id: string
  role: AppRole
  site_id: string | null
  organization_id: string
}

export interface SessionContextAssignedSite {
  id: string
  name: string
  location?: string | null
}

export interface SessionContextOrg {
  id: string
  name: string
  active?: boolean | null
  billing_admin_only?: boolean | null
  settlement_admin_only?: boolean | null
  quantity_unit?: string | null
  units_per_m3?: number | null
}

export interface SessionContextFeature {
  feature_key: string
  enabled: boolean
}

export interface SessionContextResult {
  authenticated: boolean
  user_id: string | null
  is_platform_owner: boolean
  user_roles: SessionContextUserRole[]
  assigned_sites: SessionContextAssignedSite[]
  organization: SessionContextOrg | null
  features: SessionContextFeature[]
  org_active: boolean
}

/**
 * Fetches consolidated session state in a single DB round trip via get_session_context RPC.
 * Falls back gracefully to discrete queries if migration 070 has not yet been applied.
 *
 * @param supabase - Supabase client instance (server or browser).
 * @param userId - Optional known user ID. When provided, optimizes the legacy multi-query
 * fallback by eliminating a redundant auth.getUser() network call.
 */
export async function fetchSessionContext(
  supabase: SupabaseClient<Database>,
  userId?: string
): Promise<SessionContextResult | null> {
  // 1. Try consolidated RPC
  const { data: rpcData, error: rpcError } = await (supabase.rpc as any)('get_session_context')
  if (!rpcError && rpcData && typeof rpcData === 'object') {
    return rpcData as SessionContextResult
  }

  // 2. Fallback if RPC is missing / legacy DB
  const targetUid = userId || (await supabase.auth.getUser()).data.user?.id
  if (!targetUid) {
    return {
      authenticated: false,
      user_id: null,
      is_platform_owner: false,
      user_roles: [],
      assigned_sites: [],
      organization: null,
      features: [],
      org_active: true,
    }
  }

  // Parallel fallback fetches
  const [rolesRes, ownerRpcRes, platformRes, orgActiveRes] = await Promise.all([
    supabase.from('user_roles').select('*').eq('user_id', targetUid),
    supabase.rpc('is_platform_owner'),
    supabase.from('platform_roles').select('role').eq('user_id', targetUid).maybeSingle(),
    supabase.rpc('is_user_org_active'),
  ])

  const isPlatformOwner =
    (!ownerRpcRes.error && ownerRpcRes.data === true) ||
    (!platformRes.error && !!platformRes.data)

  const roles = (rolesRes.data as SessionContextUserRole[] | null) || []
  const priorityRole =
    roles.find((r) => r.role === 'admin') ||
    roles.find((r) => r.role === 'site_manager') ||
    roles.find((r) => r.role === 'unload_clerk') ||
    roles.find((r) => r.role === 'stakeholder') ||
    roles.find((r) => r.role === 'employee') ||
    roles.find((r) => r.role === 'site_employee') ||
    null

  let org: SessionContextOrg | null = null
  let features: SessionContextFeature[] = []
  let assignedSites: SessionContextAssignedSite[] = []

  const roleSiteIds = [...new Set(roles.map((r) => r.site_id).filter(Boolean) as string[])]
  if (roleSiteIds.length > 0) {
    const { data: rpcSites, error: rpcSitesErr } = await supabase.rpc('get_my_assigned_sites')
    if (!rpcSitesErr && Array.isArray(rpcSites) && rpcSites.length > 0) {
      assignedSites = rpcSites.map((s: any) => ({
        id: s.id,
        name: s.name,
        location: s.location ?? null,
      }))
    } else {
      const { data: siteRows } = await supabase
        .from('sites')
        .select('id, name, location')
        .in('id', roleSiteIds)
      assignedSites = (siteRows || []).map((s) => ({
        id: s.id,
        name: s.name,
        location: s.location ?? null,
      }))
    }
  }

  if (priorityRole?.organization_id) {
    const [orgRes, featRes] = await Promise.all([
      supabase
        .from('organizations')
        .select('id, name, active, billing_admin_only, settlement_admin_only, quantity_unit, units_per_m3')
        .eq('id', priorityRole.organization_id)
        .maybeSingle(),
      supabase
        .from('organization_features')
        .select('feature_key, enabled')
        .eq('organization_id', priorityRole.organization_id),
    ])
    org = orgRes.data as SessionContextOrg | null
    features = (featRes.data as SessionContextFeature[]) || []
  }

  const orgActive = !orgActiveRes.error ? orgActiveRes.data !== false : true

  return {
    authenticated: true,
    user_id: targetUid,
    is_platform_owner: isPlatformOwner,
    user_roles: roles,
    assigned_sites: assignedSites,
    organization: org,
    features,
    org_active: orgActive,
  }
}
