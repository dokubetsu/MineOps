'use client'

import { useState, useEffect, createContext, useContext } from 'react'
import { createClient } from '@/lib/supabase/client'

interface UserRole {
  user_id: string
  role: 'admin' | 'site_manager' | 'stakeholder' | 'employee' | 'site_employee'
  site_id: string | null
  organization_id: string
}

interface AuthContextType {
  user: any | null
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
  const [user, setUser] = useState<any>(null)
  const [userRoles, setUserRoles] = useState<UserRole[]>([])
  const [organizationName, setOrganizationName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const loadRoles = async (userId: string | undefined) => {
    if (!userId) {
      setUserRoles([])
      setOrganizationName(null)
      if (typeof document !== 'undefined') {
        document.cookie = 'user-role=; path=/; max-age=0; SameSite=Lax'
      }
      return
    }

    const { data } = await supabase
      .from('user_roles')
      .select('*')
      .eq('user_id', userId)
    
    const loadedRoles = (data as any) || []
    setUserRoles(loadedRoles)

    // Set cookie for middleware caching
    if (typeof document !== 'undefined') {
      const roles = loadedRoles.map((r: any) => r.role)
      const priority = roles.includes('admin')
        ? 'admin'
        : roles.includes('site_manager')
        ? 'site_manager'
        : roles.includes('stakeholder')
        ? 'stakeholder'
        : roles.includes('employee')
        ? 'employee'
        : roles.includes('site_employee')
        ? 'site_employee'
        : ''
      if (priority) {
        document.cookie = `user-role=${priority}; path=/; max-age=86400; SameSite=Lax`
      } else {
        document.cookie = 'user-role=; path=/; max-age=0; SameSite=Lax'
      }
    }

    const { data: org } = await supabase.from('organizations').select('name').maybeSingle()
    setOrganizationName(org?.name ?? null)
  }

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      if (user) {
        await loadRoles(user.id)
      }
      setLoading(false)
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const currentUser = session?.user ?? null
      setUser(currentUser)
      if (currentUser) {
        await loadRoles(currentUser.id)
      } else {
        setUserRoles([])
        setOrganizationName(null)
      }
      setLoading(false)
    })
    return () => subscription.unsubscribe()
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
