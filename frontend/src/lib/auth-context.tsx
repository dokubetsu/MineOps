'use client'

import { useState, useEffect, createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { clearOfflineCache } from '@/lib/offline-cache'
import {
  defaultFeatureMap,
  featuresFromRows,
  type FeatureKey,
  type FeatureMap,
} from '@/lib/features'

interface UserRole {
  user_id: string
  role: 'admin' | 'site_manager' | 'stakeholder' | 'employee' | 'site_employee'
  site_id: string | null
  organization_id: string
}

interface AuthContextType {
  user: User | null
  userRole: UserRole | null
  loading: boolean
  isAdmin: boolean
  isSiteManager: boolean
  isStakeholder: boolean
  isEmployee: boolean
  isSiteEmployee: boolean
  isPlatformOwner: boolean
  siteIds: string[]
  organizationId: string | null
  organizationName: string | null
  features: FeatureMap
  hasFeature: (key: FeatureKey) => boolean
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userRole: null,
  loading: true,
  isAdmin: false,
  isSiteManager: false,
  isStakeholder: false,
  isEmployee: false,
  isSiteEmployee: false,
  isPlatformOwner: false,
  siteIds: [],
  organizationId: null,
  organizationName: null,
  features: defaultFeatureMap(false),
  hasFeature: () => false,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [userRoles, setUserRoles] = useState<UserRole[]>([])
  const [organizationName, setOrganizationName] = useState<string | null>(null)
  const [isPlatformOwner, setIsPlatformOwner] = useState(false)
  const [features, setFeatures] = useState<FeatureMap>(() => defaultFeatureMap(false))
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const loadRoles = async (userId: string | undefined) => {
    if (!userId) {
      setUserRoles([])
      setOrganizationName(null)
      setIsPlatformOwner(false)
      setFeatures(defaultFeatureMap(false))
      clearOfflineCache()
      return
    }

    // RPC first (SECURITY DEFINER — reliable). Table select is secondary.
    const [rolesRes, ownerRpcRes, platformRes] = await Promise.all([
      supabase.from('user_roles').select('*').eq('user_id', userId),
      supabase.rpc('is_platform_owner'),
      supabase.from('platform_roles').select('role').eq('user_id', userId).maybeSingle(),
    ])

    if (ownerRpcRes.error) {
      console.warn('[auth] is_platform_owner failed — is migration 036 applied?', ownerRpcRes.error.message)
    }
    if (platformRes.error) {
      console.warn('[auth] platform_roles select failed:', platformRes.error.message)
    }

    const loadedRoles = (rolesRes.data as UserRole[] | null) || []
    setUserRoles(loadedRoles)
    const rpcOk = !ownerRpcRes.error && ownerRpcRes.data === true
    const platformOk = !platformRes.error && !!platformRes.data
    setIsPlatformOwner(rpcOk || platformOk)

    const priorityRole =
      loadedRoles.find((r) => r.role === 'admin') ||
      loadedRoles.find((r) => r.role === 'site_manager') ||
      loadedRoles.find((r) => r.role === 'stakeholder') ||
      loadedRoles.find((r) => r.role === 'employee') ||
      loadedRoles.find((r) => r.role === 'site_employee') ||
      null

    if (priorityRole?.organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', priorityRole.organization_id)
        .maybeSingle()
      setOrganizationName(org?.name ?? null)

      const { data: featRows, error: featErr } = await supabase
        .from('organization_features')
        .select('feature_key, enabled')
        .eq('organization_id', priorityRole.organization_id)
      // Phase B: fail-closed on load error or empty (no accidental full unlock)
      if (featErr) {
        console.warn('[auth] organization_features load failed:', featErr.message)
        setFeatures(defaultFeatureMap(false))
      } else {
        setFeatures(featuresFromRows(featRows))
      }
    } else {
      setOrganizationName(null)
      // Platform owner / no tenant org — no module entitlements to enforce
      setFeatures(defaultFeatureMap(false))
    }
  }

  useEffect(() => {
    const init = async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      setUser(currentUser)
      if (currentUser) {
        await loadRoles(currentUser.id)
      }
      setLoading(false)
    }
    void init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) {
        await loadRoles(currentUser.id)
      } else {
        setUserRoles([])
        setOrganizationName(null)
        setIsPlatformOwner(false)
        setFeatures(defaultFeatureMap(false))
        clearOfflineCache()
      }
      setLoading(false)
    })
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isAdmin = userRoles.some((r) => r.role === 'admin')
  const isSiteManager = userRoles.some((r) => r.role === 'site_manager')
  const isStakeholder = userRoles.some((r) => r.role === 'stakeholder')
  const isEmployee = userRoles.some((r) => r.role === 'employee')
  const isSiteEmployee = userRoles.some((r) => r.role === 'site_employee')
  const siteIds = userRoles.map((r) => r.site_id).filter(Boolean) as string[]

  const priorityRole =
    userRoles.find((r) => r.role === 'admin') ||
    userRoles.find((r) => r.role === 'site_manager') ||
    userRoles.find((r) => r.role === 'stakeholder') ||
    userRoles.find((r) => r.role === 'employee') ||
    userRoles.find((r) => r.role === 'site_employee') ||
    null

  // Phase B: only true when explicitly enabled
  const hasFeature = (key: FeatureKey) => features[key] === true

  return (
    <AuthContext.Provider
      value={{
        user,
        userRole: priorityRole,
        loading,
        isAdmin,
        isSiteManager,
        isStakeholder,
        isEmployee,
        isSiteEmployee,
        isPlatformOwner,
        siteIds,
        organizationId: priorityRole?.organization_id ?? null,
        organizationName,
        features,
        hasFeature,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
