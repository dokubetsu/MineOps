'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme-context'
import { passwordPolicyHint } from '@/lib/password-policy'
import { Sun, Moon, Shield } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * First-time setup: create the only platform_owner account when none exists.
 * Production requires PLATFORM_BOOTSTRAP_SECRET (Phase A).
 */
export default function PlatformSetupPage() {
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()
  const [status, setStatus] = useState<'loading' | 'available' | 'blocked'>('loading')
  const [requiresSecret, setRequiresSecret] = useState(false)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [missingSecret, setMissingSecret] = useState(false)
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
          setMessage(json.error || 'Apply database migrations (through 042) first')
          return
        }
        if (json.blocked_by_missing_secret) {
          setMissingSecret(true)
          setStatus('blocked')
          setMessage(
            json.message ||
              'Production requires PLATFORM_BOOTSTRAP_SECRET in the host environment before first-time setup.'
          )
          return
        }
        if (json.available) {
          setRequiresSecret(!!json.requires_secret)
          setStatus('available')
        } else {
          setStatus('blocked')
          setMessage(
            json.owner_count > 0
              ? 'A platform owner already exists. Sign in with that account. Bootstrap is closed.'
              : json.message || json.error || 'Bootstrap unavailable'
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
      if (json.next_steps?.length) {
        toast('Next: rotate PLATFORM_BOOTSTRAP_SECRET after login', { icon: '🔐' })
      }
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
                  Database migrations required (through <code>042</code>). Run{' '}
                  <code>supabase db push</code> against the linked project, then refresh. See{' '}
                  <code>docs/DEPLOYMENT_CHECKLIST.md</code>.
                </p>
              )}
              {missingSecret && (
                <p style={{ fontSize: '0.85rem', color: 'var(--danger)', marginBottom: '1rem' }}>
                  Set a long random value for <code>PLATFORM_BOOTSTRAP_SECRET</code> in Vercel
                  (Production), redeploy, then return here and enter the same secret in the form.
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
                  minLength={10}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={passwordPolicyHint()}
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
                    placeholder="Same as PLATFORM_BOOTSTRAP_SECRET in env"
                  />
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    Required in production. Rotate or remove the env var after setup succeeds.
                  </p>
                </div>
              )}
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                After success: sign in on <code>/</code> with the same email/password →{' '}
                <code>/platform</code>. Then rotate <code>PLATFORM_BOOTSTRAP_SECRET</code>.
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
