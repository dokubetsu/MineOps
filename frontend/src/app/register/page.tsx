'use client'

import Link from 'next/link'
import { useTheme } from '@/lib/theme-context'
import { Sun, Moon, ArrowLeft, ShieldOff } from 'lucide-react'

/**
 * Public self-registration is disabled.
 * Organizations and first admins are provisioned by platform_owner via /platform.
 */
export default function RegisterPage() {
  const { theme, toggleTheme } = useTheme()

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      background: 'var(--bg-gradient)',
    }}>
      <button
        type="button"
        onClick={toggleTheme}
        className="btn btn-ghost btn-icon"
        style={{
          position: 'fixed',
          top: '1.5rem',
          right: '1.5rem',
          zIndex: 100,
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
        }}
        title="Toggle Theme"
      >
        {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
      </button>

      <div style={{ width: '100%', maxWidth: '400px' }}>
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <ShieldOff size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 1rem' }} />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            Registration closed
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
            New mining organizations are provisioned by the MineOps platform operator.
            Your company admin will receive login credentials from them — you do not self-register here.
          </p>
          <Link href="/" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={16} /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
