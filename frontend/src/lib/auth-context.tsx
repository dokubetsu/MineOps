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
  const [userRole, setUserRole] = useState<UserRole | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      if (user) {
        const { data } = await supabase
          .from('user_roles')
          .select('*')
          .eq('user_id', user.id)
          .limit(1)
          .single()
        setUserRole(data || null)
      }
      setLoading(false)
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        const { data } = await supabase
          .from('user_roles')
          .select('*')
          .eq('user_id', session.user.id)
          .limit(1)
          .single()
        setUserRole(data || null)
      } else {
        setUserRole(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Collect all site_ids for this user
  const [siteIds, setSiteIds] = useState<string[]>([])
  useEffect(() => {
    if (!user) return
    supabase
      .from('user_roles')
      .select('site_id')
      .eq('user_id', user.id)
      .then(({ data }) => {
        setSiteIds((data || []).map((r: any) => r.site_id).filter(Boolean))
      })
  }, [user])

  return (
    <AuthContext.Provider value={{
      user,
      userRole,
      loading,
      isAdmin: userRole?.role === 'admin',
      isSiteManager: userRole?.role === 'site_manager',
      isStakeholder: userRole?.role === 'stakeholder',
      siteIds,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
