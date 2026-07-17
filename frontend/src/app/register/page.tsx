'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from '@/lib/theme-context'
import { Sun, Moon, ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'

export default function RegisterPage() {
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const { theme, toggleTheme } = useTheme()

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/auth/register-tenant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ companyName, email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Registration failed')
      }

      toast.success('Organization registered successfully! Please log in.')
      router.push('/?registered=true')
    } catch (err: any) {
      console.error('Registration error:', err)
      setError(err.message || 'Something went wrong. Please try again.')
      setLoading(false)
    }
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

      <div style={{ width: '100%', maxWidth: '400px', position: 'relative' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{
            width: '64px',
            height: '64px',
            background: 'var(--accent-muted)',
            border: '2px solid var(--accent)',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 0.75rem',
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
            marginTop: '0.25rem',
          }}>Register a New Mining Organization</p>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
            <Link href="/" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
              <ArrowLeft size={16} />
            </Link>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
              Create Organization
            </h2>
          </div>

          <form onSubmit={handleRegister}>
            <div className="form-group">
              <label className="form-label">Company / Mining Name</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. Madha Mines"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Admin Email</label>
              <input
                className="form-input"
                type="email"
                placeholder="admin@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Admin Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="Min 6 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
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
                  <span className="spinner" /> Registering...
                </span>
              ) : 'Create & Sign Up'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1.5rem' }}>
          MineOps Operations Platform
        </p>
      </div>
    </div>
  )
}
