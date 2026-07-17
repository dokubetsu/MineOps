'use client'

import { useState, useEffect, createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { clearOfflineCache } from '@/lib/offline-cache'

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
  siteIds: string[]
  organizationId: string | null
  organizationName: string | null
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
  siteIds: [],
  organizationId: null,
  organizationName: null,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [userRoles, setUserRoles] = useState<UserRole[]>([])
  const [organizationName, setOrganizationName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const loadRoles = async (userId: string | undefined) => {
    if (!userId) {
      setUserRoles([])
      setOrganizationName(null)
      // Clear sensitive offline cache when session ends
      clearOfflineCache()
      return
    }

    const { data } = await supabase
      .from('user_roles')
      .select('*')
      .eq('user_id', userId)

    const loadedRoles = (data as UserRole[] | null) || []
    setUserRoles(loadedRoles)

    // Do NOT set a role cookie — middleware must not trust client-writable cookies.
    // JWT app_metadata is synced by the DB trigger; middleware falls back to DB lookup.

    const { data: org } = await supabase.from('organizations').select('name').maybeSingle()
    setOrganizationName(org?.name ?? null)
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
        clearOfflineCache()
      }
      setLoading(false)
    })
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- single init
  }, [])

  const isAdmin = userRoles.some(r => r.role === 'admin')
  const isSiteManager = userRoles.some(r => r.role === 'site_manager')
  const isStakeholder = userRoles.some(r => r.role === 'stakeholder')
  const isEmployee = userRoles.some(r => r.role === 'employee')
  const isSiteEmployee = userRoles.some(r => r.role === 'site_employee')
  const siteIds = userRoles.map(r => r.site_id).filter(Boolean) as string[]

  // Deterministic priority (admin > site_manager > stakeholder > employee > site_employee) instead of
  // userRoles[0], since the underlying query has no ORDER BY and a user with
  // more than one role row could otherwise get an arbitrary one back.
  const priorityRole =
    userRoles.find(r => r.role === 'admin') ||
    userRoles.find(r => r.role === 'site_manager') ||
    userRoles.find(r => r.role === 'stakeholder') ||
    userRoles.find(r => r.role === 'employee') ||
    userRoles.find(r => r.role === 'site_employee') ||
    null

  return (
    <AuthContext.Provider value={{
      user,
      userRole: priorityRole, // backward-compatible fallback
      loading,
      isAdmin,
      isSiteManager,
      isStakeholder,
      isEmployee,
      isSiteEmployee,
      siteIds,
      organizationId: priorityRole?.organization_id ?? null,
      organizationName,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
