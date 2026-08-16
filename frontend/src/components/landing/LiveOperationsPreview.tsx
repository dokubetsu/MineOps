'use client'

import React, { useState } from 'react'
import {
  Truck,
  BookOpen,
  Users,
  PieChart,
  ShieldCheck,
  CheckCircle2,
  TrendingUp,
  Zap,
} from 'lucide-react'

export default function LiveOperationsPreview() {
  const [activeTab, setActiveTab] = useState<'trips' | 'cash' | 'roster' | 'dividends'>('trips')
  const [simulatedTrips, setSimulatedTrips] = useState([
    {
      id: 'TRP-8841',
      truck: 'VOLVO-FM460 (#14)',
      driver: 'K. Mthembu',
      material: 'Chrome Ore Grade A',
      gross: 42.8,
      tare: 14.2,
      net: 28.6,
      status: 'Loaded & Weighed',
      time: '10:42 AM',
      hash: '0x8f2d...b129',
    },
    {
      id: 'TRP-8840',
      truck: 'SCANIA-G440 (#09)',
      driver: 'S. Dlamini',
      material: 'Run of Mine (ROM)',
      gross: 39.5,
      tare: 13.8,
      net: 25.7,
      status: 'En Route',
      time: '10:15 AM',
      hash: '0x3c11...89a2',
    },
    {
      id: 'TRP-8839',
      truck: 'MERCEDES-ACTROS (#03)',
      driver: 'T. Van Zyl',
      material: 'Crushed Overburden',
      gross: 36.2,
      tare: 13.5,
      net: 22.7,
      status: 'Discharged & Signed',
      time: '09:50 AM',
      hash: '0x14e0...556c',
    },
  ])

  const [counter, setCounter] = useState(8842)

  const handleSimulateDispatch = () => {
    const newId = `TRP-${counter}`
    setCounter((prev) => prev + 1)
    const newTrip = {
      id: newId,
      truck: 'VOLVO-FMX (#22)',
      driver: 'J. Naidoo',
      material: 'High-Grade Lump Ore',
      gross: 44.1,
      tare: 14.0,
      net: 30.1,
      status: 'Weighbridge Dispatched',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      hash: `0x${Math.random().toString(16).substring(2, 8)}...${Math.random().toString(16).substring(2, 6)}`,
    }
    setSimulatedTrips([newTrip, ...simulatedTrips.slice(0, 2)])
  }

  return (
    <div className="w-full relative">
      {/* Outer Glow container */}
      <div className="relative rounded-2xl bg-gradient-to-b from-white/[0.08] via-white/[0.03] to-white/[0.015] border border-white/[0.1] shadow-card-hover p-1 md:p-2 backdrop-blur-xl">
        {/* Top Window Bar */}
        <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 border-b border-white/[0.07] bg-[#0E1B1E]/90 rounded-t-xl gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-red-500/80 shrink-0 inline-block" />
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-amber-500/80 shrink-0 inline-block" />
            <span className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-emerald-500/80 shrink-0 inline-block" />
            <span className="ml-1 sm:ml-2 text-[11px] sm:text-xs font-mono text-foreground-muted truncate hidden sm:inline-block">
              khani-cockpit // site: pit-north-alpha // RLS enabled
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-mono font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Synced (Offline Mesh Ready)
            </span>
          </div>
        </div>

        {/* Cockpit Content Area */}
        <div className="p-3.5 sm:p-6 bg-[#060F12]/95 rounded-b-xl max-w-full overflow-hidden">
          {/* Navigation Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 w-full min-w-0">
            {/* Scrollable Tab Bar on Mobile */}
            <div className="w-full sm:w-auto overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex items-center gap-1 sm:gap-1.5 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06] min-w-0">
              <button
                type="button"
                onClick={() => setActiveTab('trips')}
                className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  activeTab === 'trips'
                    ? 'bg-accent text-white shadow-accent-cta'
                    : 'text-foreground-muted hover:text-white'
                }`}
              >
                <Truck size={14} className="shrink-0" />
                <span>Haulage Telemetry</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('cash')}
                className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  activeTab === 'cash'
                    ? 'bg-accent text-white shadow-accent-cta'
                    : 'text-foreground-muted hover:text-white'
                }`}
              >
                <BookOpen size={14} className="shrink-0" />
                <span>Cash Book</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('roster')}
                className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  activeTab === 'roster'
                    ? 'bg-accent text-white shadow-accent-cta'
                    : 'text-foreground-muted hover:text-white'
                }`}
              >
                <Users size={14} className="shrink-0" />
                <span>Photo-Verified Roll Call</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('dividends')}
                className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  activeTab === 'dividends'
                    ? 'bg-accent text-white shadow-accent-cta'
                    : 'text-foreground-muted hover:text-white'
                }`}
              >
                <PieChart size={14} className="shrink-0" />
                <span>Revenue Shares</span>
              </button>
            </div>

            {activeTab === 'trips' && (
              <button
                type="button"
                onClick={handleSimulateDispatch}
                className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 sm:py-1.5 rounded-lg text-xs font-semibold bg-white/[0.08] hover:bg-white/[0.14] text-foreground border border-white/10 transition-all active:scale-[0.98]"
              >
                <Zap size={13} className="text-amber-400 shrink-0" />
                <span>Dispatch New Load</span>
              </button>
            )}
          </div>

          {/* Tab 1: Trips Telemetry */}
          {activeTab === 'trips' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Quick Metrics Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 sm:p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">
                    Shift Haulage
                  </div>
                  <div className="text-base sm:text-xl font-bold font-display text-white mt-1">
                    1,482.4 <span className="text-xs font-normal text-foreground-muted">Tons</span>
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-emerald-400 flex items-center gap-1 mt-1">
                    <TrendingUp size={12} /> +14.2% vs target
                  </div>
                </div>

                <div className="p-3 sm:p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">
                    Active Rigs
                  </div>
                  <div className="text-base sm:text-xl font-bold font-display text-white mt-1">
                    18 / 20 <span className="text-xs font-normal text-foreground-muted">online</span>
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-teal-300 mt-1">90% fleet utilization</div>
                </div>

                <div className="p-3 sm:p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">
                    Avg Turnaround
                  </div>
                  <div className="text-base sm:text-xl font-bold font-display text-white mt-1">
                    24.6 <span className="text-xs font-normal text-foreground-muted">mins</span>
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-emerald-400 mt-1">-3.2 min cycle speed</div>
                </div>

                <div className="p-3 sm:p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-foreground-muted">
                    Slip Audit Status
                  </div>
                  <div className="text-base sm:text-xl font-bold font-display text-white mt-1 flex items-center gap-1.5">
                    <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
                    <span className="truncate">100% Verified</span>
                  </div>
                  <div className="text-[10px] sm:text-[11px] text-foreground-muted mt-1 truncate">Tamper-evident logs</div>
                </div>
              </div>

              {/* Real-time Table */}
              <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-white/[0.02]">
                <table className="w-full min-w-[540px] text-left text-xs font-sans">
                  <thead>
                    <tr className="border-b border-white/[0.06] bg-white/[0.03] text-foreground-muted uppercase tracking-wider font-mono">
                      <th className="py-2.5 px-3.5">Trip ID</th>
                      <th className="py-2.5 px-3.5">Truck / Rig</th>
                      <th className="py-2.5 px-3.5">Material</th>
                      <th className="py-2.5 px-3.5">Gross / Net</th>
                      <th className="py-2.5 px-3.5">Status</th>
                      <th className="py-2.5 px-3.5">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {simulatedTrips.map((trip) => (
                      <tr key={trip.id} className="hover:bg-white/[0.03] transition-colors">
                        <td className="py-2.5 px-3.5 font-mono font-medium text-teal-300">
                          {trip.id}
                        </td>
                        <td className="py-2.5 px-3.5 text-white font-medium">
                          {trip.truck}
                          <span className="block text-[10px] text-foreground-muted font-normal">
                            {trip.driver}
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5 text-foreground-muted">{trip.material}</td>
                        <td className="py-2.5 px-3.5 font-mono">
                          <span className="text-white font-semibold">{trip.net} T</span>
                          <span className="text-foreground-subtle text-[10px] ml-1">
                            ({trip.gross}G)
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 border border-emerald-500/25 text-emerald-400">
                            <CheckCircle2 size={11} />
                            {trip.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3.5 font-mono text-foreground-muted">
                          {trip.time}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 2: Cash Book */}
          {activeTab === 'cash' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-emerald-500/[0.05] border border-emerald-500/20">
                  <div className="text-xs font-mono uppercase text-emerald-300">Opening Balance</div>
                  <div className="text-2xl font-bold font-display text-white mt-1">₹45,200.00</div>
                  <div className="text-xs text-foreground-muted mt-1">Verified with vault float</div>
                </div>
                <div className="p-4 rounded-xl bg-rose-500/[0.05] border border-rose-500/20">
                  <div className="text-xs font-mono uppercase text-rose-300">Disbursements (Fuel/Parts)</div>
                  <div className="text-2xl font-bold font-display text-white mt-1">₹8,450.00</div>
                  <div className="text-xs text-foreground-muted mt-1">All attached with slip receipts</div>
                </div>
                <div className="p-4 rounded-xl bg-teal-500/[0.05] border border-teal-500/20">
                  <div className="text-xs font-mono uppercase text-teal-300">Current Petty Vault</div>
                  <div className="text-2xl font-bold font-display text-white mt-1">₹36,750.00</div>
                  <div className="text-xs text-emerald-400 mt-1">100% matched with cash count</div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl border border-white/[0.07] bg-white/[0.02] text-xs font-mono text-foreground-muted flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="leading-relaxed">Rule Engine: Single-entry voucher validation with mandatory photo upload</span>
                <span className="text-teal-300 shrink-0 font-medium">Zero manual math drift</span>
              </div>
            </div>
          )}

          {/* Tab 3: Roster */}
          {activeTab === 'roster' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-xs font-mono uppercase text-foreground-muted">Clocked In Today</div>
                  <div className="text-2xl font-bold font-display text-white mt-1">142 / 146</div>
                  <div className="text-xs text-emerald-400 mt-1">97.2% shift attendance</div>
                </div>
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-xs font-mono uppercase text-foreground-muted">Excavator Operators</div>
                  <div className="text-2xl font-bold font-display text-white mt-1">12 / 12</div>
                  <div className="text-xs text-teal-300 mt-1">Full operational capacity</div>
                </div>
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-xs font-mono uppercase text-foreground-muted">Automated Payroll Accrual</div>
                  <div className="text-2xl font-bold font-display text-white mt-1">₹18,940</div>
                  <div className="text-xs text-foreground-muted mt-1">Calculated per shift wage matrix</div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Stakeholder Dividends */}
          {activeTab === 'dividends' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-xs font-mono uppercase text-foreground-muted">Monthly Gross Pit Output</div>
                  <div className="text-2xl font-bold font-display text-white mt-1">₹6,82,400</div>
                  <div className="text-xs text-emerald-400 mt-1">54,200 Tons extracted</div>
                </div>
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-xs font-mono uppercase text-foreground-muted">Operating Expenses (OPEX)</div>
                  <div className="text-2xl font-bold font-display text-white mt-1">₹2,14,100</div>
                  <div className="text-xs text-foreground-muted mt-1">Fuel, maintenance, wages</div>
                </div>
                <div className="p-4 rounded-xl bg-accent/[0.1] border border-accent/30">
                  <div className="text-xs font-mono uppercase text-teal-300">Distributable Net Revenue</div>
                  <div className="text-2xl font-bold font-display text-white mt-1">₹4,68,300</div>
                  <div className="text-xs text-emerald-400 mt-1">Calculated across 4 stakeholder tiers</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
