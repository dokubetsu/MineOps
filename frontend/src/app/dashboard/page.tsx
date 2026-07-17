'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import {
  Truck, BookOpen, TrendingUp, TrendingDown,
  ChevronRight, Activity
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Site, CashBook, CashEntry, Trip } from '@/lib/supabase/types'

interface ExtendedTrip extends Trip {
  vehicles?: {
    plate_number: string
    vehicle_type: '12WH' | '10WH' | '6WH' | 'Other'
  } | null
  transport_contractors?: {
    name: string
  } | null
}

interface SiteRollup {
  site_id: string
  name: string
  trips: number
  material: number
  advance: number
  inward: number
  unsettled: number
  cash_out: number
  cash_closing: number | null
}

export default function DashboardPage() {
  const { loading: authLoading, isStakeholder, isSiteEmployee, isEmployee } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [recentTrips, setRecentTrips] = useState<ExtendedTrip[]>([])
  const [cashBook, setCashBook] = useState<CashBook | null>(null)
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([])
  const [siteRollups, setSiteRollups] = useState<SiteRollup[]>([])
  const [viewMode, setViewMode] = useState<'all' | 'site'>('all')
  const today = format(new Date(), 'yyyy-MM-dd')
  const supabase = createClient()

  useEffect(() => {
    if (authLoading) return
    if (isSiteEmployee || isEmployee) {
      router.push('/dashboard/my-work')
      return
    }
    if (isStakeholder) {
      router.push('/dashboard/stakeholder')
      return
    }
    loadSites()
  }, [authLoading, isStakeholder, isSiteEmployee, isEmployee])

  useEffect(() => {
    if (!selectedSite || isStakeholder) return
    if (viewMode === 'site') void loadDashboardData()
  }, [selectedSite, isStakeholder, viewMode])

  useEffect(() => {
    if (sites.length === 0 || isStakeholder) return
    if (viewMode === 'all') void loadAllSitesRollup(sites)
  }, [sites, viewMode, isStakeholder])

  const loadSites = async () => {
    const { data } = await supabase.from('sites').select('*').eq('active', true).order('name')
    const loadedSites = data || []
    setSites(loadedSites)
    if (loadedSites.length > 0) {
      setSelectedSite(loadedSites[0].id)
      // Multi-site: default to concurrent "all sites" rollup when more than one site
      setViewMode(loadedSites.length > 1 ? 'all' : 'site')
    }
    setLoading(false)
  }

  const loadAllSitesRollup = async (siteList: Site[]) => {
    setLoading(true)
    try {
      const siteIds = siteList.map((s) => s.id)
      const [{ data: trips }, { data: books }] = await Promise.all([
        supabase
          .from('trips')
          .select('id, site_id, cubic_capacity, advance_amount, total_shipment_cost, trip_worth, settled')
          .in('site_id', siteIds)
          .eq('trip_date', today)
          .eq('active', true)
          .limit(5000),
        supabase
          .from('cash_books')
          .select('id, site_id, closing_balance')
          .in('site_id', siteIds)
          .eq('book_date', today)
          .limit(500),
      ])

      const bookIds = (books || []).map((b) => b.id)
      const outByBook: Record<string, number> = {}
      if (bookIds.length > 0) {
        const { data: outs } = await supabase
          .from('cash_entries')
          .select('cash_book_id, amount, entry_type, active')
          .in('cash_book_id', bookIds)
          .eq('entry_type', 'out')
          .eq('active', true)
          .limit(10000)
        for (const e of outs || []) {
          outByBook[e.cash_book_id] = (outByBook[e.cash_book_id] || 0) + Number(e.amount)
        }
      }

      const bookBySite = new Map((books || []).map((b) => [b.site_id, b]))
      const rollups: SiteRollup[] = siteList.map((s) => {
        const siteTrips = (trips || []).filter((t) => t.site_id === s.id)
        const book = bookBySite.get(s.id)
        return {
          site_id: s.id,
          name: s.name,
          trips: siteTrips.length,
          material: siteTrips.reduce((sum, t) => sum + (Number(t.cubic_capacity) || 0), 0),
          advance: siteTrips.reduce((sum, t) => sum + (Number(t.advance_amount) || 0), 0),
          inward: siteTrips.reduce(
            (sum, t) => sum + (Number(t.total_shipment_cost) || Number(t.trip_worth) || 0),
            0
          ),
          unsettled: siteTrips
            .filter((t) => !t.settled)
            .reduce((sum, t) => sum + (Number(t.total_shipment_cost) || Number(t.trip_worth) || 0), 0),
          cash_out: book ? outByBook[book.id] || 0 : 0,
          cash_closing: book ? Number(book.closing_balance) : null,
        }
      })
      setSiteRollups(rollups)
    } catch {
      setSiteRollups([])
    } finally {
      setLoading(false)
    }
  }

  const loadDashboardData = async () => {
    setLoading(true)
    // Trips today
    const { data: trips } = await supabase
      .from('trips')
      .select('*, transport_contractors(name), vehicles(plate_number, vehicle_type)')
      .eq('site_id', selectedSite)
      .eq('trip_date', today)
      .eq('active', true)
      .order('created_at', { ascending: false })

    setRecentTrips((trips as ExtendedTrip[]) || [])

    // Cash book
    const { data: cb } = await supabase
      .from('cash_books')
      .select('*')
      .eq('site_id', selectedSite)
      .eq('book_date', today)
      .maybeSingle()

    setCashBook(cb || null)

    if (cb) {
      const { data: entries } = await supabase
        .from('cash_entries')
        .select('*')
        .eq('cash_book_id', cb.id)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(5)
      setCashEntries(entries || [])
    } else {
      setCashEntries([])
    }

    setLoading(false)
  }

  const totalIn = cashEntries.filter(e => e.entry_type === 'in').reduce((s, e) => s + e.amount, 0)
  const totalOut = cashEntries.filter(e => e.entry_type === 'out').reduce((s, e) => s + e.amount, 0)
  const totalSpentAdvances = recentTrips.reduce((s, t) => s + (t.advance_amount || 0), 0)
  const unsettledInwardWorth = recentTrips.filter(t => !t.settled).reduce((s, t) => s + (t.total_shipment_cost || t.trip_worth || 0), 0)
  const totalInwardRevenue = recentTrips.reduce((s, t) => s + (t.total_shipment_cost || t.trip_worth || 0), 0)
  const totalMaterialMoved = recentTrips.reduce((s, t) => s + (t.cubic_capacity || 0), 0)
  const byContractor = recentTrips.reduce((acc, t) => {
    const name = t.transport_contractors?.name || 'Unknown'
    acc[name] = (acc[name] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  const byVehicleType = recentTrips.reduce((acc, t) => {
    const type = t.vehicles?.vehicle_type || 'Other'
    if (!acc[type]) acc[type] = { count: 0, capacity: 0 }
    acc[type].count += 1
    acc[type].capacity += (t.cubic_capacity || 0)
    return acc
  }, {} as Record<string, { count: number; capacity: number }>)

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {sites.length > 1 && (
            <>
              <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${viewMode === 'all' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ borderRadius: 0 }}
                  onClick={() => setViewMode('all')}
                >
                  All sites
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${viewMode === 'site' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ borderRadius: 0 }}
                  onClick={() => setViewMode('site')}
                >
                  One site
                </button>
              </div>
              {viewMode === 'site' && (
                <select
                  className="form-input form-select"
                  style={{ width: 'auto', minWidth: '160px' }}
                  value={selectedSite}
                  onChange={(e) => setSelectedSite(e.target.value)}
                >
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {[1,2,3,4].map(i => (
            <div key={i} className="skeleton" style={{ height: '90px', borderRadius: 'var(--radius-lg)' }} />
          ))}
        </div>
      ) : sites.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon" style={{ fontSize: '2rem' }}>⛏️</div>
          <div className="empty-title">No Sites Configured</div>
          <div className="empty-desc">Go to Settings to add your first mine site.</div>
          <Link href="/dashboard/settings" className="btn btn-primary">Configure Sites</Link>
        </div>
      ) : viewMode === 'all' && sites.length > 1 ? (
        <>
          {/* Concurrent multi-site rollup */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div className="stat-card">
              <div className="stat-icon amber"><Truck size={20} /></div>
              <div>
                <div className="stat-label">Trips (all sites)</div>
                <div className="stat-value">{siteRollups.reduce((s, r) => s + r.trips, 0)}</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon info"><Activity size={20} style={{ color: 'var(--info)' }} /></div>
              <div>
                <div className="stat-label">Material (CUM)</div>
                <div className="stat-value">{siteRollups.reduce((s, r) => s + r.material, 0).toLocaleString()}</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon red"><TrendingDown size={20} style={{ color: 'var(--danger)' }} /></div>
              <div>
                <div className="stat-label">Advance + cash out</div>
                <div className="stat-value" style={{ fontSize: '1rem' }}>
                  ₹{(
                    siteRollups.reduce((s, r) => s + r.advance + r.cash_out, 0)
                  ).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon green"><TrendingUp size={20} style={{ color: 'var(--success)' }} /></div>
              <div>
                <div className="stat-label">Inward (pending)</div>
                <div className="stat-value" style={{ fontSize: '1rem', color: 'var(--success)' }}>
                  ₹{siteRollups.reduce((s, r) => s + r.inward, 0).toLocaleString('en-IN')}
                </div>
                <div className="stat-change" style={{ color: 'var(--amber)' }}>
                  ₹{siteRollups.reduce((s, r) => s + r.unsettled, 0).toLocaleString('en-IN')} unsettled
                </div>
              </div>
            </div>
          </div>

          <div className="card mb-4">
            <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
              All sites today ({siteRollups.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {siteRollups.map((r) => (
                <button
                  key={r.site_id}
                  type="button"
                  onClick={() => {
                    setSelectedSite(r.site_id)
                    setViewMode('site')
                  }}
                  className="card"
                  style={{
                    padding: '0.875rem 1rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-elevated)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{r.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {r.trips} trips · {r.material.toLocaleString()} CUM · Cash out ₹{r.cash_out.toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: 'var(--success)' }}>
                        ₹{r.inward.toLocaleString('en-IN')}
                      </div>
                      {r.unsettled > 0 && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--amber)' }}>
                          ₹{r.unsettled.toLocaleString('en-IN')} pending
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {siteRollups.length === 0 && (
                <div className="empty-desc">No site activity loaded for today.</div>
              )}
            </div>
          </div>

          <div className="card mb-4">
            <h3 style={{ marginBottom: '0.875rem', fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Quick Actions
            </h3>
            <div className="grid-2" style={{ gap: '0.625rem' }}>
              {[
                { href: '/dashboard/trips', icon: '🚛', label: 'Log Trip' },
                { href: '/dashboard/cash-book', icon: '💰', label: 'Cash Entry' },
                { href: '/dashboard/attendance', icon: '📋', label: 'Attendance' },
                { href: '/dashboard/payroll', icon: '💵', label: 'Payroll' },
              ].map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.875rem',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    textDecoration: 'none',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span style={{ fontSize: '1.25rem' }}>{action.icon}</span>
                  <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{action.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Stats Grid — single site */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <div className="stat-card">
              <div className="stat-icon amber">
                <Truck size={20} />
              </div>
              <div>
                <div className="stat-label">Today's Trips</div>
                <div className="stat-value">{recentTrips.length}</div>
                <div className="stat-change">
                  <Activity size={12} />
                  <span style={{ color: 'var(--text-muted)' }}>Live</span>
                </div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon info">
                <Activity size={20} style={{ color: 'var(--info)' }} />
              </div>
              <div>
                <div className="stat-label">Material Moved</div>
                <div className="stat-value">{totalMaterialMoved.toLocaleString()} CUM</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon red">
                <TrendingDown size={20} style={{ color: 'var(--danger)' }} />
              </div>
              <div>
                <div className="stat-label">Advance Spent</div>
                <div className="stat-value" style={{ fontSize: '1.15rem' }}>
                  ₹{totalSpentAdvances.toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon green">
                <TrendingUp size={20} style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <div className="stat-label">Inward Revenue</div>
                <div className="stat-value" style={{ fontSize: '1.15rem', color: 'var(--success)' }}>
                  ₹{totalInwardRevenue.toLocaleString('en-IN')}
                </div>
                {unsettledInwardWorth > 0 && (
                  <div className="stat-change" style={{ color: 'var(--amber)' }}>
                    ₹{unsettledInwardWorth.toLocaleString('en-IN')} pending
                  </div>
                )}
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon green">
                <BookOpen size={20} />
              </div>
              <div>
                <div className="stat-label">Cash Balance</div>
                <div className="stat-value" style={{ fontSize: '1.15rem' }}>
                  ₹{((cashBook?.closing_balance || 0)).toLocaleString('en-IN')}
                </div>
                <div className="stat-change positive">
                  <TrendingUp size={12} />
                  <span>Closing</span>
                </div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon red">
                <TrendingDown size={20} />
              </div>
              <div>
                <div className="stat-label">Cash Outflow</div>
                <div className="stat-value" style={{ fontSize: '1.15rem', color: 'var(--danger)' }}>
                  ₹{totalOut.toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>

          {/* Vehicle Capacity Utilization */}
          {Object.keys(byVehicleType).length > 0 && (
            <div className="card mb-4">
              <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem' }}>
                Vehicle Capacity Utilisation — Today
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.625rem' }}>
                {Object.entries(byVehicleType).map(([type, stats]) => (
                  <div key={type} style={{
                    padding: '0.75rem',
                    background: 'var(--bg-elevated)',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent)' }}>{stats.capacity} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>CUM</span></div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{type}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{stats.count} trip{stats.count !== 1 ? 's' : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="card mb-4">
            <h3 style={{ marginBottom: '0.875rem', fontSize: '0.9rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Quick Actions
            </h3>
            <div className="grid-2" style={{ gap: '0.625rem' }}>
              {[
                { href: '/dashboard/trips', icon: '🚛', label: 'Log Trip', color: 'var(--accent)' },
                { href: '/dashboard/cash-book', icon: '💰', label: 'Cash Entry', color: 'var(--success)' },
                { href: '/dashboard/attendance', icon: '📋', label: 'Attendance', color: 'var(--info)' },
                { href: '/dashboard/payroll', icon: '💵', label: 'Payroll', color: 'var(--text-secondary)' },
              ].map(action => (
                <Link
                  key={action.href}
                  href={action.href}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.875rem',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    textDecoration: 'none',
                    transition: 'all 0.15s',
                    color: 'var(--text-primary)',
                  }}
                >
                  <span style={{ fontSize: '1.25rem' }}>{action.icon}</span>
                  <span style={{ fontWeight: 500, fontSize: '0.875rem' }}>{action.label}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="card mb-4">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Today's Trips</h3>
              <Link href="/dashboard/trips" style={{ fontSize: '0.8rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                View all <ChevronRight size={14} />
              </Link>
            </div>

            {Object.keys(byContractor).length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.875rem' }}>
                {Object.entries(byContractor).map(([name, count]) => (
                  <span key={name} className="badge badge-amber">
                    {name}: {count}
                  </span>
                ))}
              </div>
            )}

            {recentTrips.length === 0 ? (


              <div className="empty-state" style={{ padding: '1.5rem' }}>
                <div style={{ fontSize: '1.5rem' }}>🚛</div>
                <div className="empty-desc">No trips logged today</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {recentTrips.slice(0, 5).map(trip => (
                  <div key={trip.id} className="trip-card">
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: 'var(--radius)',
                      background: 'var(--accent-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1rem',
                      flexShrink: 0,
                    }}>🚛</div>
                    <div style={{ flex: 1 }}>
                      <div className="trip-vehicle">{trip.vehicles?.plate_number || 'Unknown'}</div>
                      <div className="trip-contractor">{trip.transport_contractors?.name || '—'}</div>
                    </div>
                    <span className={`trip-type-badge ${trip.ownership_snapshot || 'rented'}`}>
                      {trip.vehicles?.vehicle_type || '?'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>



          {/* Cash Summary */}

          {cashBook && (
            <div className="card mb-4">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Today's Cash Book</h3>
                <Link href="/dashboard/cash-book" style={{ fontSize: '0.8rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  Open <ChevronRight size={14} />
                </Link>
              </div>

              <div className="balance-bar">
                <div className="balance-bar-item">
                  <span className="label">Opening</span>
                  <span className="value" style={{ fontSize: '0.9rem' }}>
                    ₹{(cashBook.opening_balance || 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="balance-bar-item">
                  <span className="label">Net</span>
                  <span className="value" style={{ color: ((cashBook.closing_balance ?? 0) - (cashBook.opening_balance ?? 0)) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    ₹{Math.abs((cashBook.closing_balance ?? 0) - (cashBook.opening_balance ?? 0)).toLocaleString('en-IN')}
                  </span>
                </div>

                <div className="balance-bar-item">
                  <span className="label">Closing</span>
                  <span className="value" style={{ color: 'var(--accent)' }}>
                    ₹{(cashBook.closing_balance || 0).toLocaleString('en-IN')}
                  </span>
                </div>
              </div>



              {cashEntries.slice(0, 3).map(entry => (
                <div key={entry.id} className="cash-row" style={{ marginTop: '0.5rem' }}>
                  <span className={`cash-dot ${entry.entry_type}`} />
                  <span className="cash-category">{entry.category}</span>
                  <span className={`cash-amount ${entry.entry_type}`}>
                    {entry.entry_type === 'in' ? '+' : '-'}₹{entry.amount.toLocaleString('en-IN')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
