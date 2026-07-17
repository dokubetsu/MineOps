'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthProvider, useAuth } from '@/lib/auth-context'
import { useTheme } from '@/lib/theme-context'
import { clearOfflineCache } from '@/lib/offline-cache'
import { Building2, LogOut, Sun, Moon, Shield } from 'lucide-react'

function PlatformShell({ children }: { children: React.ReactNode }) {
  const { user, loading, isPlatformOwner } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()
  const supabase = createClient()

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace('/')
      return
    }
    if (!isPlatformOwner) {
      router.replace('/dashboard')
    }
  }, [loading, user, isPlatformOwner, router])

  const handleLogout = async () => {
    clearOfflineCache()
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading || !user || !isPlatformOwner) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: '2rem', height: '2rem' }} />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="sidebar-logo">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <Shield size={22} style={{ color: 'var(--accent)' }} />
            <div>
              <div className="sidebar-logo-text">MineOps</div>
              <div className="sidebar-logo-sub">Platform Console</div>
            </div>
          </div>
        </div>
        <div className="sidebar-nav">
          <span className="sidebar-section-label">Control plane</span>
          <Link
            href="/platform"
            className={`sidebar-item ${pathname === '/platform' ? 'active' : ''}`}
          >
            <Building2 size={18} />
            Organizations
          </Link>
        </div>
        <div style={{ padding: '1rem 0.75rem', borderTop: '1px solid var(--border)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.5rem 0.875rem', borderRadius: 'var(--radius)',
            background: 'var(--bg-elevated)',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'rgba(245,158,11,0.15)', color: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '0.8rem',
            }}>
              {user.email?.[0]?.toUpperCase() || 'P'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--accent)' }}>Platform owner</div>
            </div>
            <button type="button" onClick={toggleTheme} className="btn-ghost btn btn-icon" title="Toggle theme">
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button type="button" onClick={handleLogout} className="btn-ghost btn btn-icon" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>
      <main className="main-content">{children}</main>
    </div>
  )
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <PlatformShell>{children}</PlatformShell>
    </AuthProvider>
  )
}
