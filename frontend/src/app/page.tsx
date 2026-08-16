'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import AmbientBlobs from '@/components/landing/AmbientBlobs'
import LandingNavbar from '@/components/landing/LandingNavbar'
import BentoGrid from '@/components/landing/BentoGrid'
import LiveOperationsPreview from '@/components/landing/LiveOperationsPreview'
import SignInModal from '@/components/landing/SignInModal'
import SpotlightCard from '@/components/landing/SpotlightCard'
import {
  ArrowRight,
  ShieldCheck,
  Zap,
  Activity,
  Cpu,
  Lock,
  Mail,
  Server,
  Database,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronRight,
  Sparkles,
} from 'lucide-react'

export default function LandingPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [error, setError] = useState('')
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)

  const router = useRouter()
  const supabase = createClient()

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
        queueMicrotask(() => {
          setError('This organization has been deactivated. Contact your Khani operator.')
        })
      }
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const dest = await resolvePostLoginPath(session.user.id)
        if (dest) {
          router.push(dest)
        } else {
          setError('This organization has been deactivated. Contact your Khani operator.')
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

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#050506] flex items-center justify-center relative">
        <AmbientBlobs />
        <div className="relative z-10 flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center animate-pulse">
            <Image src="/logo.png" alt="Khani" width={24} height={24} className="w-6 h-6 object-contain" />
          </div>
          <p className="text-xs font-mono text-foreground-muted tracking-wider uppercase">
            Initialising Khani Operations...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#050506] text-foreground font-sans selection:bg-accent/30 selection:text-white relative overflow-x-hidden">
      {/* 4-Layer Ambient Lighting Background */}
      <AmbientBlobs />

      {/* Top Glassmorphism Navigation */}
      <LandingNavbar onOpenSignIn={() => setIsAuthModalOpen(true)} />

      {/* Hero Section */}
      <section className="relative pt-32 sm:pt-40 lg:pt-48 pb-20 sm:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center text-center max-w-4xl mx-auto">
            {/* Eyebrow Badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/10 shadow-[0_0_20px_rgba(94,106,210,0.15)] text-xs font-mono text-indigo-300 mb-8 backdrop-blur-md hover:border-accent/40 transition-colors">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
              <span className="font-semibold tracking-wide">KHANI V2.4</span>
              <span className="text-foreground-muted">•</span>
              <span className="text-foreground-muted">Industrial Mine Operations Platform</span>
              <ChevronRight size={13} className="text-indigo-400" />
            </div>

            {/* Display Headline */}
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-display font-semibold tracking-[-0.03em] leading-[1.08] text-white">
              The operating system for{' '}
              <span className="block bg-gradient-to-r from-white via-indigo-200 to-[#5E6AD2] bg-clip-text text-transparent">
                mine logistics &amp; workforce.
              </span>
            </h1>

            {/* Lead Paragraph */}
            <p className="mt-6 text-base sm:text-xl text-foreground-muted max-w-2xl leading-relaxed">
              Real-time haul truck telemetry, automated weighbridge slip audit, photo-verified shift rosters, and single-entry cash books built for remote, zero-connectivity pits.
            </p>

            {/* Action Buttons */}
            <div className="mt-10 flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                className="w-full sm:w-auto relative group overflow-hidden inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl text-sm font-semibold text-white bg-accent hover:bg-accent-bright shadow-accent-cta transition-all duration-300 ease-expo-out hover:shadow-[0_0_30px_rgba(94,106,210,0.6)] active:scale-[0.98]"
              >
                <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/25 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out" />
                <Sparkles size={16} />
                <span>Launch Operations Cockpit</span>
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </button>

              <a
                href="#live-preview"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl text-sm font-semibold text-foreground-muted hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.16] shadow-card-ambient transition-all duration-200 ease-expo-out"
              >
                <Activity size={16} className="text-accent" />
                <span>Explore Live Cockpit</span>
              </a>
            </div>

            {/* Key Assurance Indicators */}
            <div className="mt-12 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs font-mono text-foreground-muted border-t border-white/[0.06] pt-8">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-emerald-400" />
                <span>100% Offline-First IndexedDB</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck size={15} className="text-indigo-400" />
                <span>PostgreSQL Row-Level Security</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap size={15} className="text-amber-400" />
                <span>Sub-Second Slip OCR Reconciliation</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Live Interactive Cockpit Demo */}
      <section id="live-preview" className="py-12 sm:py-20 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/10 text-indigo-300 text-xs font-mono tracking-widest uppercase mb-3">
              <Activity size={12} className="text-accent" />
              Interactive Simulation
            </div>
            <h2 className="text-2xl sm:text-4xl font-display font-semibold text-white tracking-tight">
              Experience the Operations Cockpit
            </h2>
            <p className="mt-2 text-sm text-foreground-muted">
              Click tabs to inspect real-time truck cycles, verified petty cash floats, and automated dividend distribution.
            </p>
          </div>

          <LiveOperationsPreview />
        </div>
      </section>

      {/* Asymmetric Bento Grid Features */}
      <BentoGrid />

      {/* Architectural Rigor & Tech Stack Section */}
      <section id="architecture" className="py-24 sm:py-32 relative border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/30 text-indigo-300 text-xs font-mono tracking-widest uppercase mb-4">
                <Cpu size={13} />
                Architecture Blueprint
              </div>
              <h2 className="text-3xl sm:text-5xl font-display font-semibold text-white tracking-tight leading-tight">
                Streamlined client-to-database backendless engine.
              </h2>
              <p className="mt-4 text-base text-foreground-muted leading-relaxed">
                Khani utilizes PostgreSQL database constraints, SECURITY DEFINER RPCs, and authenticated signed storage URLs to eliminate fragile intermediary API layers and duplicate business calculations.
              </p>

              <div className="mt-8 space-y-4">
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] flex items-start gap-3.5">
                  <div className="p-2 rounded-lg bg-accent/15 text-accent shrink-0 mt-0.5">
                    <Database size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white font-display">Row-Level Security (RLS)</h3>
                    <p className="text-xs text-foreground-muted mt-0.5">
                      Strict tenant organization isolation enforced directly within PostgreSQL kernel policies.
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] flex items-start gap-3.5">
                  <div className="p-2 rounded-lg bg-purple-500/15 text-purple-400 shrink-0 mt-0.5">
                    <Server size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white font-display">Pure Math Single-Source-of-Truth</h3>
                    <p className="text-xs text-foreground-muted mt-0.5">
                      Payroll accruals, contractor haul tonnages, and dividend shares calculated with zero rounding drift.
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] flex items-start gap-3.5">
                  <div className="p-2 rounded-lg bg-emerald-500/15 text-emerald-400 shrink-0 mt-0.5">
                    <Lock size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white font-display">Private Image Vaults</h3>
                    <p className="text-xs text-foreground-muted mt-0.5">
                      Weighbridge slips and cash receipts stored in encrypted private Supabase Storage buckets.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Architecture Visual Card */}
            <SpotlightCard className="p-6 sm:p-8">
              <div className="text-xs font-mono uppercase tracking-wider text-indigo-300 mb-4 flex items-center justify-between">
                <span>System Topology</span>
                <span className="text-emerald-400">PWA Active</span>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div className="p-3 rounded-lg bg-[#050506] border border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white">
                    <span className="w-2 h-2 rounded-full bg-accent" />
                    <span>Client Application</span>
                  </div>
                  <span className="text-foreground-muted">Next.js 16 + React 19 App Router</span>
                </div>

                <div className="flex justify-center text-foreground-muted">↓ Encrypted SSR / JWT Protocol</div>

                <div className="p-3 rounded-lg bg-[#050506] border border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    <span>PostgreSQL Engine</span>
                  </div>
                  <span className="text-foreground-muted">Triggers, RLS, Definer RPCs</span>
                </div>

                <div className="flex justify-center text-foreground-muted">↓ Encrypted Storage Sync</div>

                <div className="p-3 rounded-lg bg-[#050506] border border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>Signed Evidence Buckets</span>
                  </div>
                  <span className="text-foreground-muted">Trip Slips, Receipts, Roll Call Evidence</span>
                </div>
              </div>
            </SpotlightCard>
          </div>
        </div>
      </section>

      {/* Production Verification & Stats Banner */}
      <section className="py-16 sm:py-20 relative border-t border-white/[0.06] bg-black/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            <div>
              <div className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-white tracking-tight">
                2.4M+
              </div>
              <div className="text-xs sm:text-sm font-mono text-foreground-muted mt-2 uppercase tracking-wider">
                Tons Tracked &amp; Billed
              </div>
            </div>

            <div>
              <div className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-indigo-300 tracking-tight">
                99.98%
              </div>
              <div className="text-xs sm:text-sm font-mono text-foreground-muted mt-2 uppercase tracking-wider">
                Offline Sync Accuracy
              </div>
            </div>

            <div>
              <div className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-emerald-400 tracking-tight">
                ₹0.00
              </div>
              <div className="text-xs sm:text-sm font-mono text-foreground-muted mt-2 uppercase tracking-wider">
                Cash Book Math Drift
              </div>
            </div>

            <div>
              <div className="text-3xl sm:text-4xl lg:text-5xl font-display font-bold text-white tracking-tight">
                &lt; 30s
              </div>
              <div className="text-xs sm:text-sm font-mono text-foreground-muted mt-2 uppercase tracking-wider">
                Weighbridge Turnaround
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Dedicated Sign-In & Operations Portal Section */}
      <section id="security" className="py-24 sm:py-32 relative border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-md mx-auto">
            <SpotlightCard className="p-8 sm:p-10">
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-white/10 to-white/[0.02] border border-white/15 p-2 mb-3 shadow-[0_0_20px_rgba(94,106,210,0.25)]">
                  <Image src="/logo.png" alt="Khani" width={48} height={48} className="w-full h-full object-contain" />
                </div>
                <h2 className="text-2xl font-display font-semibold text-white tracking-tight">
                  Operator Sign In
                </h2>
                <p className="text-xs text-foreground-muted mt-1.5">
                  Direct authentication for mine managers, clerks, and stakeholders
                </p>
              </div>

              {/* Seamless Auth Form with Exact Selectors */}
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
                      placeholder="admin@khani.com"
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
                  className="w-full relative group overflow-hidden inline-flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-sm font-semibold text-white bg-accent hover:bg-accent-bright shadow-accent-cta transition-all duration-200 ease-expo-out disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-in-out" />
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Signing In...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign In</span>
                      <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-white/[0.06] text-center space-y-2 text-xs text-foreground-muted">
                <p>Need an organization account? Contact your Khani platform operator.</p>
                <p>
                  <a
                    href="/platform/setup"
                    className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors"
                  >
                    First-time platform owner setup
                  </a>
                </p>
              </div>
            </SpotlightCard>
          </div>
        </div>
      </section>

      {/* Deep Space Footer */}
      <footer className="py-12 border-t border-white/[0.06] bg-[#020203] relative z-10 text-xs text-foreground-muted">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Khani" width={20} height={20} className="w-5 h-5 object-contain" />
            <span className="font-semibold text-white font-display">Khani Operations Platform</span>
            <span>•</span>
            <span>Industrial Mine Logistics &amp; Workforce Management</span>
          </div>

          <div className="flex items-center gap-6">
            <span className="flex items-center gap-1.5 text-emerald-400 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              All Systems Operational
            </span>
            <span className="text-foreground-subtle">© {new Date().getFullYear()} Khani Systems</span>
          </div>
        </div>
      </footer>

      {/* Global Sign In Dialog Modal */}
      <SignInModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
    </div>
  )
}
