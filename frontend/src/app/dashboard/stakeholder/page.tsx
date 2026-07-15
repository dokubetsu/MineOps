'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, subDays, startOfMonth } from 'date-fns'
import { TrendingUp, TrendingDown, Truck, DollarSign } from 'lucide-react'
import { Site } from '@/lib/supabase/types'
import toast from 'react-hot-toast'

interface TrendItem {
  date: string
  trips: number
  net: number
}

interface StakeholderSiteData {
  site: Site | null
  sharePercent: number
  tripCount: number
  totalIn: number
  totalOut: number
  net: number
  myShare: number
  latestBalance: number
  latestBalanceDate: string | null
  trend: TrendItem[]
  byContractor: Record<string, number>
}

export default function StakeholderDashboardPage() {
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState<StakeholderSiteData[]>([])
  const [period, setPeriod] = useState<'7d' | '30d' | 'month'>('30d')
  const supabase = createClient()

  useEffect(() => {
    loadData()
  }, [period])

  const loadData = async () => {
    setLoading(true)
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError) {
      toast.error(`Authentication error: ${userError.message}`)
      setLoading(false)
      return
    }
    if (!user) { setLoading(false); return }

    // Get stakeholder site access
    const { data: access, error: accessError } = await supabase
      .from('stakeholder_site_access')
      .select('*, sites(id, name, location, active, created_at, updated_at)')
      .eq('stakeholder_user_id', user.id)
      .limit(100)

    if (accessError) {
      toast.error(`Error loading stakeholder site access: ${accessError.message}`)
      setLoading(false)
      return
    }

    const today = new Date()
    const fromDate = period === '7d'
      ? format(subDays(today, 6), 'yyyy-MM-dd')
      : period === '30d'
        ? format(subDays(today, 29), 'yyyy-MM-dd')
        : format(startOfMonth(today), 'yyyy-MM-dd')
    const toDate = format(today, 'yyyy-MM-dd')

    const siteData = await Promise.all((access || []).map(async (a: any) => {
      const siteId = a.site_id

      // Trip count
      const { count: tripCount, error: countError } = await supabase
        .from('trips')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', siteId)
        .gte('trip_date', fromDate)
        .lte('trip_date', toDate)
        .eq('active', true)

      if (countError) console.error(`Error loading trips count for site ${siteId}:`, countError.message)

      // Cash aggregates via stakeholder view
      const { data: summary, error: summaryError } = await supabase
        .from('stakeholder_daily_summary')
        .select('book_date, total_in, total_out, trip_count')
        .eq('site_id', siteId)
        .gte('book_date', fromDate)
        .lte('book_date', toDate)
        .order('book_date')
        .limit(366)

      if (summaryError) console.error(`Error loading daily summaries for site ${siteId}:`, summaryError.message)

      const rows = summary || []
      const totalIn = rows.reduce((s: number, r: any) => s + (r.total_in || 0), 0)
      const totalOut = rows.reduce((s: number, r: any) => s + (r.total_out || 0), 0)
      const net = totalIn - totalOut
      const myShare = Math.round((net * a.share_percent) / 100)

      // Latest cash book for current balance
      const { data: latestCb, error: cbError } = await supabase
        .from('cash_books')
        .select('closing_balance, book_date')
        .eq('site_id', siteId)
        .lte('book_date', toDate)
        .order('book_date', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cbError) console.error(`Error loading latest cash book for site ${siteId}:`, cbError.message)

      // Trips per day trend (last 14 rows max)
      const trend: TrendItem[] = rows.slice(-14).map((r: any) => ({
        date: r.book_date,
        trips: r.trip_count || 0,
        net: (r.total_in || 0) - (r.total_out || 0),
      }))

      // Contractor breakdown
      const { data: trips, error: tripsError } = await supabase
        .from('trips')
        .select('transport_contractors(name)')
        .eq('site_id', siteId)
        .gte('trip_date', fromDate)
        .lte('trip_date', toDate)
        .eq('active', true)
        .limit(1000)

      if (tripsError) console.error(`Error loading contractor breakdown for site ${siteId}:`, tripsError.message)

      const byContractor: Record<string, number> = {}
      for (const t of trips || []) {
        const name = (t as any).transport_contractors?.name || 'Unknown'
        byContractor[name] = (byContractor[name] || 0) + 1
      }

      return {
        site: a.sites as Site | null,
        sharePercent: a.share_percent,
        tripCount: tripCount || 0,
        totalIn,
        totalOut,
        net,
        myShare,
        latestBalance: latestCb?.closing_balance || 0,
        latestBalanceDate: latestCb?.book_date || null,
        trend,
        byContractor,
      }
    }))

    setSites(siteData)
    setLoading(false)
  }

  const fmt = (n: number) => `₹${Math.abs(n).toLocaleString('en-IN')}`

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Dashboard</h1>
          <p className="page-subtitle">Revenue Share Overview</p>
        </div>
        {/* Period selector */}
        <div style={{ display: 'flex', gap: '0.375rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.25rem' }}>
          {(['7d', '30d', 'month'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{
                padding: '0.375rem 0.75rem', border: 'none', borderRadius: '7px',
                cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '0.8rem', fontWeight: 500,
                background: period === p ? 'var(--accent)' : 'transparent',
                color: period === p ? '#0a0b0f' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}>
              {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : 'This Month'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {[1, 2].map(i => <div key={i} className="skeleton" style={{ height: '220px', borderRadius: 'var(--radius-lg)' }} />)}
        </div>
      ) : sites.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '2rem' }}>📊</div>
          <div className="empty-title">No Sites Assigned</div>
          <div className="empty-desc">Contact your admin to get access to site data</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {sites.map((siteData, idx) => (
            <div key={idx}>
              {/* Site Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.875rem' }}>
                <span style={{ fontSize: '1.5rem' }}>⛏️</span>
                <div>
                  <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{siteData.site?.name}</h2>
                  <span style={{ fontSize: '0.8rem', color: 'var(--accent)', fontWeight: 600 }}>
                    {siteData.sharePercent}% Revenue Share
                  </span>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid-2 mb-4" style={{ gap: '0.75rem' }}>
                <div className="stat-card card-accent">
                  <div className="stat-icon amber"><DollarSign size={20} /></div>
                  <div>
                    <div className="stat-label">My Share</div>
                    <div className="stat-value" style={{ fontSize: '1.4rem', color: siteData.myShare >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {siteData.myShare >= 0 ? '' : '-'}{fmt(siteData.myShare)}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      {siteData.sharePercent}% of ₹{Math.abs(siteData.net).toLocaleString('en-IN')} net
                    </div>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon amber"><Truck size={20} /></div>
                  <div>
                    <div className="stat-label">Total Trips</div>
                    <div className="stat-value">{siteData.tripCount}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>in period</div>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon green"><TrendingUp size={20} /></div>
                  <div>
                    <div className="stat-label">Total Cash In</div>
                    <div className="stat-value" style={{ fontSize: '1.2rem', color: 'var(--success)' }}>{fmt(siteData.totalIn)}</div>
                  </div>
                </div>

                <div className="stat-card">
                  <div className="stat-icon red"><TrendingDown size={20} /></div>
                  <div>
                    <div className="stat-label">Total Cash Out</div>
                    <div className="stat-value" style={{ fontSize: '1.2rem', color: 'var(--danger)' }}>{fmt(siteData.totalOut)}</div>
                  </div>
                </div>
              </div>

              {/* Current Balance */}
              {siteData.latestBalance !== undefined && (
                <div className="card mb-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Current Balance
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)', marginTop: '0.2rem' }}>
                      ₹{(siteData.latestBalance || 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>as of</div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                      {siteData.latestBalanceDate ? format(new Date(siteData.latestBalanceDate), 'd MMM yyyy') : '—'}
                    </div>
                  </div>
                </div>
              )}

              {/* Contractor Breakdown */}
              {Object.keys(siteData.byContractor).length > 0 && (
                <div className="card mb-4">
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.875rem', fontWeight: 600 }}>
                    Trips by Contractor
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                    {Object.entries(siteData.byContractor)
                      .sort(([, a], [, b]) => (b as number) - (a as number))
                      .map(([name, count]) => {
                        const pct = siteData.tripCount > 0 ? Math.round(((count as number) / siteData.tripCount) * 100) : 0
                        return (
                          <div key={name}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                              <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{name}</span>
                              <span style={{ fontSize: '0.875rem', color: 'var(--accent)', fontWeight: 600 }}>{count as number} trips ({pct}%)</span>
                            </div>
                            <div style={{ height: '6px', background: 'var(--bg-elevated)', borderRadius: '999px', overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: '999px', transition: 'width 0.5s ease' }} />
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {/* Daily Trend SVG Sparkline Chart */}
              {siteData.trend.length > 0 && (
                <div className="card mb-4">
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.875rem', fontWeight: 600 }}>
                    Daily Trip Trend
                  </div>
                  <div style={{ position: 'relative', height: '60px', width: '100%' }}>
                    {(() => {
                      const max = Math.max(...siteData.trend.map((t) => t.trips), 1)
                      const len = siteData.trend.length
                      const points = siteData.trend.map((t, i) => {
                        const x = len > 1 ? (i / (len - 1)) * 300 : 150
                        const y = 55 - (t.trips / max) * 45
                        return { x, y, label: `${t.date}: ${t.trips} trips` }
                      })

                      const pathD = len > 1 
                        ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
                        : `M 0 55 L 300 55`
                      const areaD = len > 1
                        ? `${pathD} L 300 60 L 0 60 Z`
                        : `M 0 55 L 300 55 L 300 60 L 0 60 Z`

                      return (
                        <svg viewBox="0 0 300 60" style={{ width: '100%', height: '60px', overflow: 'visible' }}>
                          <defs>
                            <linearGradient id={`grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
                              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          {/* Area path */}
                          <path d={areaD} fill={`url(#grad-${idx})`} />
                          {/* Line path */}
                          <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                          {/* Interactive data dots */}
                          {points.map((p, i) => (
                            <circle 
                              key={i} 
                              cx={p.x} 
                              cy={p.y} 
                              r="3.5" 
                              fill="var(--bg-card)" 
                              stroke="var(--accent)" 
                              strokeWidth="2"
                              style={{ cursor: 'pointer' }}
                            >
                              <title>{p.label}</title>
                            </circle>
                          ))}
                        </svg>
                      )
                    })()}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.375rem' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      {siteData.trend[0]?.date ? format(new Date(siteData.trend[0].date), 'd MMM') : ''}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      {siteData.trend[siteData.trend.length - 1]?.date ? format(new Date(siteData.trend[siteData.trend.length - 1].date), 'd MMM') : ''}
                    </span>
                  </div>
                </div>
              )}

              {idx < sites.length - 1 && <hr className="divider" />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
