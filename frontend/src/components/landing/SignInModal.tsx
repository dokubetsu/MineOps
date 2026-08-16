'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Image from 'next/image'
import { X, Lock, Mail, ArrowRight, AlertTriangle, Loader2 } from 'lucide-react'

interface SignInModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SignInModal({ isOpen, onClose }: SignInModalProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const supabase = createClient()

  if (!isOpen) return null

  const resolvePostLoginPath = async (userId: string): Promise<string | null> => {
    // Check if platform owner
    const { data: isOwner, error: rpcError } = await supabase.rpc('is_platform_owner')
    if (!rpcError && isOwner === true) return '/platform'

    const { data: platformRow } = await supabase
      .from('platform_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'platform_owner')
      .maybeSingle()
    if (platformRow) return '/platform'

    // Check if user has roles
    const { data: roles } = await supabase
      .from('user_roles')
      .select('id')
      .eq('user_id', userId)
      .limit(1)
    if (!roles || roles.length === 0) return '/platform/setup'

    // Check if organization is active
    const { data: orgActive, error: orgErr } = await supabase.rpc('is_user_org_active')
    if (!orgErr && orgActive === false) {
      await supabase.auth.signOut()
      return null
    }

    return '/dashboard'
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { data, error: signError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signError) {
        setError(signError.message)
        setLoading(false)
        return
      }

      if (data.user) {
        const dest = await resolvePostLoginPath(data.user.id)
        if (!dest) {
          setError('This organization has been deactivated. Contact your Khani operator.')
          setLoading(false)
          return
        }
        router.push(dest)
        router.refresh()
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred'
      setError(message)
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Dark backdrop blur */}
      <div
        className="fixed inset-0 bg-[#03080A]/85 backdrop-blur-md transition-opacity animate-in fade-in"
        onClick={onClose}
      />

      {/* Modal Dialog Container */}
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-[#0E1B1E] border border-white/[0.12] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_50px_rgba(0,0,0,0.8),0_0_80px_rgba(20,184,166,0.2)] p-6 sm:p-8 z-10 transition-all">
        {/* Top ambient highlight */}
        <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-foreground-muted hover:text-white rounded-lg hover:bg-white/[0.08] transition-colors"
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-white/10 to-white/[0.02] border border-white/15 p-2 mb-3 shadow-[0_0_20px_rgba(20,184,166,0.3)]">
            <Image src="/logo.png" alt="Khani" width={48} height={48} className="w-full h-full object-contain" />
          </div>
          <h2 className="text-xl font-display font-semibold text-white tracking-tight">
            Sign In to Khani
          </h2>
          <p className="text-xs text-foreground-muted mt-1">
            Mine Logistics, Cash Book &amp; Workforce Portal
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-foreground-muted mb-1.5 uppercase tracking-wider font-mono">
              Email Address
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-foreground-muted pointer-events-none">
                <Mail size={16} />
              </span>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="operator@mineops.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2.5 bg-[#050506] border border-white/10 rounded-lg text-sm text-foreground placeholder:text-foreground-subtle/50 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 transition-all duration-200"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-foreground-muted uppercase tracking-wider font-mono">
                Password
              </label>
            </div>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-foreground-muted pointer-events-none">
                <Lock size={16} />
              </span>
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2.5 bg-[#050506] border border-white/10 rounded-lg text-sm text-foreground placeholder:text-foreground-subtle/50 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 transition-all duration-200"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs animate-in fade-in">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full relative group overflow-hidden inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-accent hover:bg-accent-bright shadow-accent-cta transition-all duration-200 ease-expo-out disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out" />
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Authenticating Session...</span>
              </>
            ) : (
              <>
                <span>Access Operations Cockpit</span>
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>
        </form>

        {/* Footer Meta */}
        <div className="mt-6 pt-5 border-t border-white/[0.06] text-center space-y-2 text-xs text-foreground-muted">
          <p>
            Need an organization account? Contact your Khani platform operator.
          </p>
          <p>
            <a
              href="/platform/setup"
              className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors"
            >
              First-time platform owner bootstrap
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
