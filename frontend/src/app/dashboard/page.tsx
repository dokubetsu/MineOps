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

export default function DashboardPage() {
  const { loading: authLoading, isStakeholder } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState<string>('')
  const [recentTrips, setRecentTrips] = useState<ExtendedTrip[]>([])
  const [cashBook, setCashBook] = useState<CashBook | null>(null)
  const [cashEntries, setCashEntries] = useState<CashEntry[]>([])
  const today = format(new Date(), 'yyyy-MM-dd')
  const supabase = createClient()

  useEffect(() => {
    if (authLoading) return
    if (isStakeholder) {
      router.push('/dashboard/stakeholder')
      return
    }
    loadSites()
  }, [authLoading, isStakeholder])

  useEffect(() => {
    if (selectedSite && !isStakeholder) loadDashboardData()
  }, [selectedSite, isStakeholder])

  const loadSites = async () => {
    const { data } = await supabase.from('sites').select('*').eq('active', true).order('name')
    const loadedSites = data || []
    setSites(loadedSites)
    if (loadedSites.length > 0) {
      setSelectedSite(loadedSites[0].id)
    }
    setLoading(false)
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

    setRecentTrips((trips as any) || [])

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
  const byContractor = recentTrips.reduce((acc, t) => {
    const name = t.transport_contractors?.name || 'Unknown'
    acc[name] = (acc[name] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
        </div>
        {sites.length > 1 && (
          <select
            className="form-input form-select"
            style={{ width: 'auto', minWidth: '160px' }}
            value={selectedSite}
            onChange={e => setSelectedSite(e.target.value)}
          >
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
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
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid-2 mb-4" style={{ gap: '0.75rem' }}>
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
              <div className="stat-icon green">
                <BookOpen size={20} />
              </div>
              <div>
                <div className="stat-label">Cash Balance</div>
                <div className="stat-value" style={{ fontSize: '1.25rem' }}>
                  ₹{((cashBook?.closing_balance || 0)).toLocaleString('en-IN')}
                </div>
                <div className="stat-change positive">
                  <TrendingUp size={12} />
                  <span>Closing</span>
                </div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon green">
                <TrendingUp size={20} />
              </div>
              <div>
                <div className="stat-label">Cash In</div>
                <div className="stat-value" style={{ fontSize: '1.25rem', color: 'var(--success)' }}>
                  ₹{totalIn.toLocaleString('en-IN')}
                </div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon red">
                <TrendingDown size={20} />
              </div>
              <div>
                <div className="stat-label">Cash Out</div>
                <div className="stat-value" style={{ fontSize: '1.25rem', color: 'var(--danger)' }}>
                  ₹{totalOut.toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>

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

          {/* Today's Trips */}
          <div className="card mb-4">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Today's Trips</h3>
              <Link href="/dashboard/trips" style={{ fontSize: '0.8rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                View all <ChevronRight size={14} />
              </Link>
            </div>

            {/* Contractor breakdown */}
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
                  <span className="value" style={{ color: (cashBook.closing_balance - cashBook.opening_balance) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                    ₹{Math.abs(cashBook.closing_balance - cashBook.opening_balance).toLocaleString('en-IN')}
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
