'use client'

import { useState, useEffect, createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { clearOfflineCache } from '@/lib/offline-cache'
import { clearSignedUrlCache } from '@/lib/image-utils'
import {
  defaultFeatureMap,
  featuresFromRows,
  type FeatureKey,
  type FeatureMap,
} from '@/lib/features'
import {
  DEFAULT_TRIP_OPS_POLICY,
  tripOpsFromOrgRow,
  pickPrimaryRole,
  type TripOpsPolicy,
  type AppRole,
} from '@/lib/trip-ops-policy'
import { fetchSessionContext } from '@/lib/session-context'

interface UserRole {
  user_id: string
  role: AppRole
  site_id: string | null
  organization_id: string
}

export type AssignedSite = { id: string; name: string; location?: string | null }

interface AuthContextType {
  user: User | null
  userRole: UserRole | null
  loading: boolean
  isAdmin: boolean
  isSiteManager: boolean
  isStakeholder: boolean
  isEmployee: boolean
  isSiteEmployee: boolean
  isUnloadClerk: boolean
  isPlatformOwner: boolean
  siteIds: string[]
  assignedSites: AssignedSite[]
  assignedSiteName: string | null
  organizationId: string | null
  organizationName: string | null
  features: FeatureMap
  hasFeature: (key: FeatureKey) => boolean
  tripOps: TripOpsPolicy
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
  isUnloadClerk: false,
  isPlatformOwner: false,
  siteIds: [],
  assignedSites: [],
  assignedSiteName: null,
  organizationId: null,
  organizationName: null,
  features: defaultFeatureMap(false),
  hasFeature: () => false,
  tripOps: DEFAULT_TRIP_OPS_POLICY,
})

function pickPriorityRole(loadedRoles: UserRole[]): UserRole | null {
  const primaryRole = pickPrimaryRole(loadedRoles)
  return loadedRoles.find((r) => r.role === primaryRole) || null
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [userRoles, setUserRoles] = useState<UserRole[]>([])
  const [organizationName, setOrganizationName] = useState<string | null>(null)
  const [assignedSites, setAssignedSites] = useState<AssignedSite[]>([])
  const [isPlatformOwner, setIsPlatformOwner] = useState(false)
  const [features, setFeatures] = useState<FeatureMap>(() => defaultFeatureMap(false))
  const [tripOps, setTripOps] = useState<TripOpsPolicy>(DEFAULT_TRIP_OPS_POLICY)
  const [loading, setLoading] = useState(true)
  const [supabase] = useState(() => createClient())

  const loadRoles = async (userId: string | undefined, isCurrent?: () => boolean) => {
    if (!userId) {
      if (isCurrent && !isCurrent()) return
      setUserRoles([])
      setOrganizationName(null)
      setAssignedSites([])
      setIsPlatformOwner(false)
      setFeatures(defaultFeatureMap(false))
      setTripOps(DEFAULT_TRIP_OPS_POLICY)
      clearOfflineCache()
      clearSignedUrlCache()
      return
    }

    const sessionCtx = await fetchSessionContext(supabase, userId)
    if (isCurrent && !isCurrent()) return

    if (!sessionCtx) {
      setUserRoles([])
      setOrganizationName(null)
      setAssignedSites([])
      setIsPlatformOwner(false)
      setFeatures(defaultFeatureMap(false))
      setTripOps(DEFAULT_TRIP_OPS_POLICY)
      return
    }

    setUserRoles(sessionCtx.user_roles)
    setIsPlatformOwner(sessionCtx.is_platform_owner)
    setAssignedSites(sessionCtx.assigned_sites)
    setOrganizationName(sessionCtx.organization?.name ?? null)
    setTripOps(tripOpsFromOrgRow(sessionCtx.organization))
    setFeatures(featuresFromRows(sessionCtx.features))
  }

  useEffect(() => {
    let activeSeq = 0

    const init = async () => {
      const seq = ++activeSeq
      const isCurrent = () => seq === activeSeq
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (!isCurrent()) return
      setUser(currentUser)
      if (currentUser) {
        await loadRoles(currentUser.id, isCurrent)
      }
      if (isCurrent()) {
        setLoading(false)
      }
    }
    void init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const seq = ++activeSeq
      const isCurrent = () => seq === activeSeq
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) {
        await loadRoles(currentUser.id, isCurrent)
      } else {
        if (!isCurrent()) return
        setUserRoles([])
        setOrganizationName(null)
        setAssignedSites([])
        setIsPlatformOwner(false)
        setFeatures(defaultFeatureMap(false))
        setTripOps(DEFAULT_TRIP_OPS_POLICY)
        clearOfflineCache()
        clearSignedUrlCache()
      }
      if (isCurrent()) {
        setLoading(false)
      }
    })

    return () => {
      activeSeq++
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase client is stable (instantiated via useState initializer) and init runs once on mount
  }, [])

  const isAdmin = userRoles.some((r) => r.role === 'admin')
  const isSiteManager = userRoles.some((r) => r.role === 'site_manager')
  const isStakeholder = userRoles.some((r) => r.role === 'stakeholder')
  const isEmployee = userRoles.some((r) => r.role === 'employee')
  const isSiteEmployee = userRoles.some((r) => r.role === 'site_employee')
  const isUnloadClerk = userRoles.some((r) => r.role === 'unload_clerk')
  const siteIds = userRoles.map((r) => r.site_id).filter(Boolean) as string[]

  const priorityRole = pickPriorityRole(userRoles)
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
        isUnloadClerk,
        isPlatformOwner,
        siteIds,
        assignedSites,
        assignedSiteName: assignedSites[0]?.name ?? null,
        organizationId: priorityRole?.organization_id ?? null,
        organizationName,
        features,
        hasFeature,
        tripOps,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
