'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthProvider, useAuth } from '@/lib/auth-context'
import { useTheme } from '@/lib/theme-context'
import { clearOfflineCache } from '@/lib/offline-cache'
import { clearSignedUrlCache } from '@/lib/image-utils'
import { Building2, LogOut, Sun, Moon, Shield, AlertTriangle } from 'lucide-react'

function PlatformShell({ children }: { children: React.ReactNode }) {
  const { user, loading, isPlatformOwner } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()
  const supabase = createClient()
  const [deniedHint, setDeniedHint] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!user) {
      // Allow /platform/setup without login
      if (pathname?.startsWith('/platform/setup')) return
      router.replace('/')
      return
    }
    if (!isPlatformOwner) {
      if (pathname?.startsWith('/platform/setup')) return
      setDeniedHint(
        'This account is not a platform owner. Create one at /platform/setup (first time only), or sign in with a platform owner account.'
      )
    } else {
      setDeniedHint(null)
    }
  }, [loading, user, isPlatformOwner, router, pathname])

  const handleLogout = async () => {
    clearOfflineCache()
    clearSignedUrlCache()
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  // Setup page: no shell chrome required
  if (pathname?.startsWith('/platform/setup')) {
    return <>{children}</>
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: '2rem', height: '2rem' }} />
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: '2rem', height: '2rem' }} />
      </div>
    )
  }

  if (!isPlatformOwner) {
    return (
      <div
        data-testid="platform-access-denied"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          background: 'var(--bg-gradient)',
        }}
      >
        <div className="card" style={{ maxWidth: 440, padding: '1.75rem', textAlign: 'center' }}>
          <AlertTriangle size={36} style={{ color: 'var(--accent)', margin: '0 auto 1rem' }} />
          <h1 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            No platform access
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
            {deniedHint}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <Link href="/platform/setup" className="btn btn-primary">
              First-time platform setup
            </Link>
            <button type="button" className="btn btn-secondary" onClick={handleLogout}>
              Sign out
            </button>
            <Link href="/dashboard" className="btn btn-ghost">
              Go to tenant dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {/* Mobile Header for Platform Owner */}
      <header className="mobile-header">
        <div className="mobile-header-brand">
          <img
            src="/logo-icon.png"
            alt="Khani"
            style={{ height: '32px', width: '32px', borderRadius: '6px', objectFit: 'cover' }}
          />
          <span className="mobile-header-title" style={{ fontSize: '0.9rem' }}>
            Khani Console
          </span>
        </div>
        <div className="mobile-header-actions" style={{ gap: '0.5rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
            {user.email}
          </span>
          <button type="button" onClick={toggleTheme} className="btn-ghost btn btn-icon" style={{ padding: '0.25rem' }} title="Toggle theme">
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          <button type="button" onClick={handleLogout} className="btn-ghost btn btn-icon" style={{ padding: '0.25rem' }} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <nav className="sidebar">
        <div className="sidebar-logo">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <img
              src="/logo-icon.png"
              alt="Khani"
              style={{ height: '40px', width: '40px', objectFit: 'cover', borderRadius: '10px', flexShrink: 0 }}
            />
            <div>
              <div className="sidebar-logo-text">Khani</div>
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.5rem 0.875rem',
              borderRadius: 'var(--radius)',
              background: 'var(--bg-elevated)',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'rgba(245,158,11,0.15)',
                color: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.8rem',
              }}
            >
              {user.email?.[0]?.toUpperCase() || 'P'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
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
