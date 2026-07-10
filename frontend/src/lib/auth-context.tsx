'use client'

import { useState, useEffect, createContext, useContext } from 'react'
import { createClient } from '@/lib/supabase/client'

interface UserRole {
  user_id: string
  role: 'admin' | 'site_manager' | 'stakeholder'
  site_id: string | null
}

interface AuthContextType {
  user: any | null
  userRole: UserRole | null
  loading: boolean
  isAdmin: boolean
  isSiteManager: boolean
  isStakeholder: boolean
  siteIds: string[]
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userRole: null,
  loading: true,
  isAdmin: false,
  isSiteManager: false,
  isStakeholder: false,
  siteIds: [],
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null)
  const [userRoles, setUserRoles] = useState<UserRole[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const loadRoles = async (userId: string | undefined) => {
    if (!userId) {
      setUserRoles([])
      return
    }
    const { data } = await supabase
      .from('user_roles')
      .select('*')
      .eq('user_id', userId)
    setUserRoles(data || [])
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
      }
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  const isAdmin = userRoles.some(r => r.role === 'admin')
  const isSiteManager = userRoles.some(r => r.role === 'site_manager')
  const isStakeholder = userRoles.some(r => r.role === 'stakeholder')
  const siteIds = userRoles.map(r => r.site_id).filter(Boolean) as string[]

  return (
    <AuthContext.Provider value={{
      user,
      userRole: userRoles[0] || null, // backward-compatible fallback
      loading,
      isAdmin,
      isSiteManager,
      isStakeholder,
      siteIds,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
