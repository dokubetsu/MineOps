'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme-context'
import { Sun, Moon } from 'lucide-react'
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()
  const { theme, toggleTheme } = useTheme()

  const resolvePostLoginPath = async (userId: string): Promise<string | null> => {
    // Prefer SECURITY DEFINER RPC — works even if table RLS is picky
    const { data: isOwner, error: rpcError } = await supabase.rpc('is_platform_owner')
    if (!rpcError && isOwner === true) return '/platform'

    const { data: platformRow } = await supabase
      .from('platform_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'platform_owner')
      .maybeSingle()
    if (platformRow) return '/platform'

    // No tenant role either → send to setup (not empty dashboard)
    const { data: roles } = await supabase
      .from('user_roles')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
    if (!roles || roles.length === 0) return '/platform/setup'

    // Deactivated tenant org — block access
    const { data: orgActive, error: orgErr } = await supabase.rpc('is_user_org_active')
    if (!orgErr && orgActive === false) {
      await supabase.auth.signOut()
      return null
    }

    return '/dashboard'
  }

  useEffect(() => {
    // Surface proxy redirect for inactive orgs
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('error') === 'org_inactive') {
        setError('This organization has been deactivated. Contact your MineOps operator.')
      }
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const dest = await resolvePostLoginPath(session.user.id)
        if (dest) {
          router.push(dest)
        } else {
          setError('This organization has been deactivated. Contact your MineOps operator.')
          setCheckingSession(false)
        }
      } else {
        setCheckingSession(false)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { data, error: signError } = await supabase.auth.signInWithPassword({ email, password })
    if (signError) {
      console.error('Login error detailed:', signError.message)
      setError(signError.message)
      setLoading(false)
    } else if (data.user) {
      const dest = await resolvePostLoginPath(data.user.id)
      if (!dest) {
        setError('This organization has been deactivated. Contact your MineOps operator.')
        setLoading(false)
        return
      }
      router.push(dest)
      router.refresh()
    }
  }

  if (checkingSession) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-gradient)',
      }}>
        <div className="spinner" style={{ width: '2rem', height: '2rem' }} />
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      background: 'var(--bg-gradient)',
    }}>
      {/* Background pattern */}
      <div style={{
        position: 'fixed',
        inset: 0,
        backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(245,158,11,0.06) 1px, transparent 0)',
        backgroundSize: '32px 32px',
        pointerEvents: 'none',
      }} />

      {/* Theme Toggler */}
      <button
        onClick={toggleTheme}
        className="btn btn-ghost btn-icon"
        style={{
          position: 'fixed',
          top: '1.5rem',
          right: '1.5rem',
          zIndex: 100,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-card)',
        }}
        title="Toggle Theme"
      >
        {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
      </button>

      <div style={{ width: '100%', maxWidth: '380px', position: 'relative' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            width: '64px',
            height: '64px',
            background: 'var(--accent-muted)',
            border: '2px solid var(--accent)',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 1rem',
            fontSize: '1.75rem',
          }}>⛏️</div>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '1.75rem',
            fontWeight: 800,
            color: 'var(--accent)',
            letterSpacing: '-0.03em',
          }}>MineOps</h1>
          <p style={{
            fontSize: '0.875rem',
            color: 'var(--text-muted)',
            marginTop: '0.375rem',
          }}>Mine Logistics & Workforce Management</p>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '2rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '1.5rem', fontWeight: 600 }}>
            Sign In
          </h2>

          <form onSubmit={handleLogin}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div style={{
                background: 'var(--danger-muted)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 'var(--radius)',
                padding: '0.75rem 1rem',
                fontSize: '0.875rem',
                color: 'var(--danger)',
                marginBottom: '1rem',
              }}>
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary btn-lg w-full"
              disabled={loading}
            >
              {loading ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="spinner" /> Signing in...
                </span>
              ) : 'Sign In'}
            </button>
          </form>
          
          <div style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Need an organization account? Contact your MineOps platform operator.
          </div>
          <div style={{ textAlign: 'center', marginTop: '0.75rem', fontSize: '0.75rem' }}>
            <a href="/platform/setup" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>
              First-time platform owner setup
            </a>
          </div>
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1.5rem' }}>
          MineOps Operations Platform
        </p>
      </div>
    </div>
  )
}
