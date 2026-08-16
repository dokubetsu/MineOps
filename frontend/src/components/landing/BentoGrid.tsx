'use client'

import React from 'react'
import SpotlightCard from './SpotlightCard'
import {
  Truck,
  PieChart,
  WifiOff,
  ShieldCheck,
  Zap,
  CheckCircle2,
  TrendingUp,
  Receipt,
  ScanFace,
  Layers,
} from 'lucide-react'

export default function BentoGrid() {
  return (
    <section id="features" className="py-24 sm:py-32 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/30 text-teal-300 text-xs font-mono tracking-widest uppercase mb-4">
            <Layers size={13} />
            Modular Mining Architecture
          </div>
          <h2 className="text-3xl sm:text-5xl font-display font-semibold text-white tracking-tight leading-tight">
            Built for harsh mine sites.{' '}
            <span className="bg-gradient-to-r from-[#0D9488] via-teal-300 to-[#14B8A6] bg-clip-text text-transparent">
              Engineered with mathematical rigor.
            </span>
          </h2>
          <p className="mt-4 text-base sm:text-lg text-foreground-muted">
            Replace error-prone paper registers and untracked WhatsApp manifests with an integrated, offline-ready operations suite.
          </p>
        </div>

        {/* 6-Column Asymmetric Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-6 auto-rows-auto">
          {/* Card 1: Hero Feature (4 Columns on Desktop) */}
          <SpotlightCard className="md:col-span-4 p-6 sm:p-8 flex flex-col justify-between group">
            <div>
              <div className="flex items-center justify-between mb-6">
                <div className="w-12 h-12 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent">
                  <Truck size={24} />
                </div>
                <span className="px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  Sub-second Slip Logging
                </span>
              </div>

              <h3 className="text-2xl sm:text-3xl font-display font-semibold text-white tracking-tight">
                Digital Trip Sheets &amp; Automated Weighbridge Reconciliation
              </h3>
              <p className="mt-3 text-sm sm:text-base text-foreground-muted leading-relaxed">
                Capture gross, tare, and net weights with instant slip photo OCR and offline queueing. Unload clerks verify contractor dispatches at the port or plant before hauliers leave the gate.
              </p>
            </div>

            {/* Mock Visual Inside Hero Card */}
            <div className="mt-8 pt-6 border-t border-white/[0.06] grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/[0.06]">
                <div className="text-[11px] font-mono text-foreground-muted">Gross &amp; Tare Audit</div>
                <div className="text-base font-semibold text-white mt-1">Automatic Net Math</div>
                <p className="text-[11px] text-foreground-subtle mt-0.5">Eliminates calculation discrepancies</p>
              </div>
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/[0.06]">
                <div className="text-[11px] font-mono text-foreground-muted">Weighbridge Receipts</div>
                <div className="text-base font-semibold text-white mt-1">Signed Storage Buckets</div>
                <p className="text-[11px] text-foreground-subtle mt-0.5">Private encrypted image archival</p>
              </div>
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/[0.06]">
                <div className="text-[11px] font-mono text-foreground-muted">Contractor Billing</div>
                <div className="text-base font-semibold text-white mt-1">Trip Sheet Export</div>
                <p className="text-[11px] text-foreground-subtle mt-0.5">One-click verified CSV / PDF manifests</p>
              </div>
            </div>
          </SpotlightCard>

          {/* Card 2: Photo-Verified Shift Rosters (2 Columns on Desktop) */}
          <SpotlightCard className="md:col-span-2 p-6 sm:p-8 flex flex-col justify-between group">
            <div>
              <div className="w-12 h-12 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-400 mb-6">
                <ScanFace size={24} />
              </div>
              <h3 className="text-xl sm:text-2xl font-display font-semibold text-white tracking-tight">
                Workforce &amp; Photo-Verified Roll Call
              </h3>
              <p className="mt-3 text-sm text-foreground-muted leading-relaxed">
                Roster miners, machine operators, and security crews with photo-verified gate roll calls. Auto-syncs daily shift presence directly to payroll wage brackets.
              </p>
            </div>

            <div className="mt-6 pt-5 border-t border-white/[0.06] flex items-center justify-between text-xs font-mono text-teal-300">
              <span>Shift Wage Policy Engine</span>
              <CheckCircle2 size={14} className="text-emerald-400" />
            </div>
          </SpotlightCard>

          {/* Card 3: Single-Entry Cash Ledger (2 Columns on Desktop) */}
          <SpotlightCard className="md:col-span-2 p-6 sm:p-8 flex flex-col justify-between group">
            <div>
              <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-6">
                <Receipt size={24} />
              </div>
              <h3 className="text-xl sm:text-2xl font-display font-semibold text-white tracking-tight">
                Digital Cash Book &amp; Petty Float
              </h3>
              <p className="mt-3 text-sm text-foreground-muted leading-relaxed">
                Track diesel refills, explosive permits, and spare parts. Mandatory receipt attachment stops cash leakage at remote pit outposts.
              </p>
            </div>

            <div className="mt-6 pt-5 border-t border-white/[0.06] flex items-center justify-between text-xs font-mono text-emerald-400">
              <span>Zero-Math Drift Ledger</span>
              <TrendingUp size={14} />
            </div>
          </SpotlightCard>

          {/* Card 4: Dynamic Stakeholder Distributions (2 Columns on Desktop) */}
          <SpotlightCard className="md:col-span-2 p-6 sm:p-8 flex flex-col justify-between group">
            <div>
              <div className="w-12 h-12 rounded-xl bg-teal-500/15 border border-teal-500/30 flex items-center justify-center text-teal-400 mb-6">
                <PieChart size={24} />
              </div>
              <h3 className="text-xl sm:text-2xl font-display font-semibold text-white tracking-tight">
                Stakeholder Revenue Sharing
              </h3>
              <p className="mt-3 text-sm text-foreground-muted leading-relaxed">
                Transparent revenue-sharing calculations based on pit gross sales minus verified operating expenditures, partitioned by custom equity shares.
              </p>
            </div>

            <div className="mt-6 pt-5 border-t border-white/[0.06] flex items-center justify-between text-xs font-mono text-teal-300">
              <span>Multi-Tier Equity Splits</span>
              <ShieldCheck size={14} className="text-emerald-400" />
            </div>
          </SpotlightCard>

          {/* Card 5: Offline-First Mesh Engine (2 Columns on Desktop) */}
          <SpotlightCard className="md:col-span-2 p-6 sm:p-8 flex flex-col justify-between group">
            <div>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-6">
                <WifiOff size={24} />
              </div>
              <h3 className="text-xl sm:text-2xl font-display font-semibold text-white tracking-tight">
                100% Offline Capability
              </h3>
              <p className="mt-3 text-sm text-foreground-muted leading-relaxed">
                Zero signal in the pit? Log full trips, clock attendance, and issue receipts offline. IndexedDB safely queues transactions and auto-syncs on reconnect.
              </p>
            </div>

            <div className="mt-6 pt-5 border-t border-white/[0.06] flex items-center justify-between text-xs font-mono text-emerald-400">
              <span>PWA + IndexedDB Sync</span>
              <Zap size={14} />
            </div>
          </SpotlightCard>
        </div>
      </div>
    </section>
  )
}
