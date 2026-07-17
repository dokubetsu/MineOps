'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme-context'
import { Sun, Moon, Shield } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * First-time setup: create the only platform_owner account when none exists.
 * After bootstrap, sign in on / with those credentials.
 */
export default function PlatformSetupPage() {
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()
  const [status, setStatus] = useState<'loading' | 'available' | 'blocked'>('loading')
  const [requiresSecret, setRequiresSecret] = useState(false)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ email: '', password: '', secret: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch('/api/platform/bootstrap')
      .then((r) => r.json())
      .then((json) => {
        if (json.needs_migration) {
          setNeedsMigration(true)
          setStatus('blocked')
          setMessage(json.error || 'Run migration 036 first')
          return
        }
        if (json.available) {
          setRequiresSecret(!!json.requires_secret)
          setStatus('available')
        } else {
          setStatus('blocked')
          setMessage(
            json.owner_count > 0
              ? 'A platform owner already exists. Sign in with that account.'
              : json.error || 'Bootstrap unavailable'
          )
        }
      })
      .catch((e) => {
        setStatus('blocked')
        setMessage(e.message || 'Failed to check bootstrap status')
      })
  }, [])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const res = await fetch('/api/platform/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          secret: form.secret || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Bootstrap failed')
      toast.success('Platform owner created — sign in now')
      router.push('/')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        background: 'var(--bg-gradient)',
      }}
    >
      <button
        type="button"
        onClick={toggleTheme}
        className="btn btn-ghost btn-icon"
        style={{ position: 'fixed', top: '1.5rem', right: '1.5rem' }}
      >
        {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
      </button>

      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <Shield size={36} style={{ color: 'var(--accent)', margin: '0 auto 0.75rem' }} />
          <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--accent)' }}>
            Platform owner setup
          </h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 6 }}>
            One-time: create the operator account that manages all mining orgs
          </p>
        </div>

        <div className="card" style={{ padding: '1.5rem' }}>
          {status === 'loading' && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
              <div className="spinner" />
            </div>
          )}

          {status === 'blocked' && (
            <div>
              {needsMigration && (
                <p style={{ fontSize: '0.85rem', color: 'var(--danger)', marginBottom: '1rem' }}>
                  Database migration required: apply{' '}
                  <code>036_platform_owner_and_org_features.sql</code> (
                  <code>supabase db push</code>), then refresh this page.
                </p>
              )}
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                {message}
              </p>
              <button type="button" className="btn btn-primary w-full" onClick={() => router.push('/')}>
                Go to sign in
              </button>
            </div>
          )}

          {status === 'available' && (
            <form onSubmit={onSubmit}>
              <div className="form-group">
                <label className="form-label">Your operator email</label>
                <input
                  className="form-input"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="you@company.com"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input
                  className="form-input"
                  type="password"
                  required
                  minLength={6}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Min 6 characters"
                />
              </div>
              {requiresSecret && (
                <div className="form-group">
                  <label className="form-label">Bootstrap secret</label>
                  <input
                    className="form-input"
                    type="password"
                    required
                    value={form.secret}
                    onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
                    placeholder="PLATFORM_BOOTSTRAP_SECRET from env"
                  />
                </div>
              )}
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                After this succeeds, sign in on the main login page with the same email/password.
                You will be taken to /platform.
              </p>
              <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create platform owner'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
