'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { Download, FileText, Printer } from 'lucide-react'

export default function ReportsPage() {
  const [sites, setSites] = useState<any[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [period, setPeriod] = useState(format(startOfMonth(new Date()), 'yyyy-MM'))
  const [loading, setLoading] = useState(false)
  const [trips, setTrips] = useState<any[]>([])
  const [cashEntries, setCashEntries] = useState<any[]>([])
  const [cashBooks, setCashBooks] = useState<any[]>([])
  const [activeReport, setActiveReport] = useState<'trips' | 'cash' | 'contractor'>('trips')
  const supabase = createClient()

  useEffect(() => {
    supabase.from('sites').select('*').eq('active', true).order('name').limit(200).then(({ data, error }) => {
      if (error) {
        alert(`Error loading sites: ${error.message}`)
      } else {
        setSites(data || [])
        if (data?.length) setSelectedSite(data[0].id)
      }
    })
  }, [])

  useEffect(() => { if (selectedSite) loadData() }, [selectedSite, period])

  const loadData = async () => {
    setLoading(true)
    const from = period + '-01'
    const to = format(endOfMonth(new Date(from)), 'yyyy-MM-dd')

    const [{ data: tripsData, error: tripsError }, { data: booksData, error: booksError }] = await Promise.all([
      supabase
        .from('trips')
        .select('*, vehicles(plate_number, vehicle_type), transport_contractors(name)')
        .eq('site_id', selectedSite)
        .gte('trip_date', from)
        .lte('trip_date', to)
        .neq('active', false)
        .order('trip_date')
        .limit(1000),
      supabase
        .from('cash_books')
        .select('*, cash_entries(*)')
        .eq('site_id', selectedSite)
        .gte('book_date', from)
        .lte('book_date', to)
        .order('book_date')
        .limit(1000),
    ])

    if (tripsError) alert(`Error loading report trips: ${tripsError.message}`)
    if (booksError) alert(`Error loading report cash books: ${booksError.message}`)

    setTrips(tripsData || [])
    setCashBooks(booksData || [])
    const allEntries = (booksData || []).flatMap((b: any) =>
      (b.cash_entries || [])
        .filter((e: any) => e.active !== false)
        .map((e: any) => ({ ...e, book_date: b.book_date }))
    )
    setCashEntries(allEntries)
    setLoading(false)
  }

  // Export to CSV
  const exportCSV = (rows: string[][], filename: string) => {
    const csv = rows.map(r => r.map(c => `"${(c || '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportTripsCSV = () => {
    const rows = [
      ['Date', 'Plate Number', 'Vehicle Type', 'Contractor', 'Ownership', 'DD Number', 'Permit', 'Load Info'],
      ...trips.map(t => [
        t.trip_date,
        t.vehicles?.plate_number || '',
        t.vehicles?.vehicle_type || '',
        t.transport_contractors?.name || '',
        t.ownership_snapshot || '',
        t.dd_number || '',
        t.permit_number || '',
        t.load_info || '',
      ]),
    ]
    exportCSV(rows, `trips_${selectedSite}_${period}.csv`)
  }

  const exportCashCSV = () => {
    const rows = [
      ['Date', 'Type', 'Category', 'Amount', 'Note'],
      ...cashEntries.map(e => [
        e.book_date,
        e.entry_type,
        e.category,
        String(e.amount),
        e.note || '',
      ]),
    ]
    exportCSV(rows, `cashbook_${selectedSite}_${period}.csv`)
  }

  // Print
  const printReport = () => window.print()

  // Contractor summary
  const contractorSummary = trips.reduce((acc, t) => {
    const name = t.transport_contractors?.name || 'Unknown'
    const type = t.vehicles?.vehicle_type || '?'
    const key = `${name}|${type}`
    if (!acc[key]) acc[key] = { name, type, count: 0 }
    acc[key].count++
    return acc
  }, {} as Record<string, { name: string; type: string; count: number }>)

  const totalIn = cashEntries.filter(e => e.entry_type === 'in').reduce((s, e) => s + e.amount, 0)
  const totalOut = cashEntries.filter(e => e.entry_type === 'out').reduce((s, e) => s + e.amount, 0)

  // Group cash by category
  const byCategoryOut = cashEntries.filter(e => e.entry_type === 'out').reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amount
    return acc
  }, {} as Record<string, number>)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports & Export</h1>
          <p className="page-subtitle">Monthly summaries and data export</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={printReport}>
            <Printer size={16} /> Print
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="card mb-4" style={{ padding: '0.875rem 1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {sites.length > 1 && (
            <select className="form-input form-select" style={{ flex: 1, minWidth: '140px' }}
              value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <input type="month" className="form-input" style={{ flex: 1, minWidth: '140px' }}
            value={period} onChange={e => setPeriod(e.target.value)} />
        </div>
      </div>

      {/* Report tabs */}
      <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '1rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.25rem' }}>
        {([
          { key: 'trips', label: '🚛 Trips', count: trips.length },
          { key: 'cash', label: '💰 Cash Book', count: cashEntries.length },
          { key: 'contractor', label: '📊 By Contractor', count: Object.keys(contractorSummary).length },
        ] as const).map(tab => (
          <button key={tab.key} onClick={() => setActiveReport(tab.key)}
            style={{
              flex: 1, padding: '0.5rem', border: 'none', borderRadius: '7px',
              cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '0.8rem', fontWeight: 500,
              background: activeReport === tab.key ? 'var(--accent)' : 'transparent',
              color: activeReport === tab.key ? '#0a0b0f' : 'var(--text-muted)',
              transition: 'all 0.15s',
            }}>
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '48px', borderRadius: 'var(--radius)' }} />)}
        </div>
      ) : (
        <>
          {/* Trips Report */}
          {activeReport === 'trips' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                  <strong style={{ color: 'var(--accent)', fontSize: '1.1rem' }}>{trips.length}</strong> total trips in {format(new Date(period + '-01'), 'MMMM yyyy')}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={exportTripsCSV}>
                  <Download size={14} /> Export CSV
                </button>
              </div>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Plate</th>
                      <th>Type</th>
                      <th>Contractor</th>
                      <th>Ownership</th>
                      <th>DD No.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.length === 0 ? (
                      <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No trips in this period</td></tr>
                    ) : trips.map(t => (
                      <tr key={t.id}>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{format(new Date(t.trip_date), 'd MMM')}</td>
                        <td><strong style={{ fontFamily: 'var(--font-display)' }}>{t.vehicles?.plate_number}</strong></td>
                        <td><span className="badge badge-amber">{t.vehicles?.vehicle_type}</span></td>
                        <td>{t.transport_contractors?.name || '—'}</td>
                        <td><span className={`badge ${t.ownership_snapshot === 'owned' ? 'badge-blue' : 'badge-gray'}`}>{t.ownership_snapshot}</span></td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t.dd_number || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cash Book Report */}
          {activeReport === 'cash' && (
            <div>
              {/* Summary cards */}
              <div className="grid-3 mb-4" style={{ gap: '0.75rem' }}>
                <div className="stat-card">
                  <div className="stat-icon green"><FileText size={18} /></div>
                  <div>
                    <div className="stat-label">Total In</div>
                    <div className="stat-value" style={{ fontSize: '1.2rem', color: 'var(--success)' }}>₹{totalIn.toLocaleString('en-IN')}</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon red"><FileText size={18} /></div>
                  <div>
                    <div className="stat-label">Total Out</div>
                    <div className="stat-value" style={{ fontSize: '1.2rem', color: 'var(--danger)' }}>₹{totalOut.toLocaleString('en-IN')}</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon amber"><FileText size={18} /></div>
                  <div>
                    <div className="stat-label">Net</div>
                    <div className="stat-value" style={{ fontSize: '1.2rem', color: (totalIn - totalOut) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      ₹{Math.abs(totalIn - totalOut).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Category breakdown */}
              <div className="card mb-4">
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.875rem', fontWeight: 600 }}>
                  Expenditure by Category
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {Object.entries(byCategoryOut)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .map(([cat, amt]) => {
                      const pct = Math.round(((amt as number) / totalOut) * 100) || 0
                      return (
                        <div key={cat}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{cat}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>₹{(amt as number).toLocaleString('en-IN')} ({pct}%)</span>
                          </div>
                          <div style={{ height: '4px', background: 'var(--bg-elevated)', borderRadius: '999px' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--danger)', borderRadius: '999px', opacity: 0.7 }} />
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.875rem' }}>
                <button className="btn btn-secondary btn-sm" onClick={exportCashCSV}>
                  <Download size={14} /> Export CSV
                </button>
              </div>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr><th>Date</th><th>Type</th><th>Category</th><th>Note</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
                  </thead>
                  <tbody>
                    {cashEntries.length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No entries in this period</td></tr>
                    ) : cashEntries.map(e => (
                      <tr key={e.id}>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{format(new Date(e.book_date), 'd MMM')}</td>
                        <td><span className={`cash-dot ${e.entry_type}`} style={{ display: 'inline-block' }} /></td>
                        <td>{e.category}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{e.note || '—'}</td>
                        <td style={{ textAlign: 'right', color: e.entry_type === 'in' ? 'var(--success)' : 'var(--danger)', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                          {e.entry_type === 'in' ? '+' : '-'}₹{e.amount.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Contractor Summary */}
          {activeReport === 'contractor' && (
            <div>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.875rem' }}>
                Contractor-wise trip breakdown for {format(new Date(period + '-01'), 'MMMM yyyy')}
              </div>
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr><th>Contractor</th><th>Vehicle Type</th><th>Trips</th><th>% of Total</th></tr>
                  </thead>
                  <tbody>
                    {(Object.values(contractorSummary) as { name: string; type: string; count: number }[])
                      .sort((a, b) => b.count - a.count)
                      .map(row => (
                        <tr key={`${row.name}|${row.type}`}>
                          <td style={{ fontWeight: 500 }}>{row.name}</td>
                          <td><span className="badge badge-amber">{row.type}</span></td>
                          <td><strong style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', color: 'var(--accent)' }}>{row.count}</strong></td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div style={{ height: '6px', flex: 1, background: 'var(--bg-elevated)', borderRadius: '999px', maxWidth: '80px' }}>
                                <div style={{ height: '100%', width: `${Math.round((row.count / trips.length) * 100)}%`, background: 'var(--accent)', borderRadius: '999px' }} />
                              </div>
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{Math.round((row.count / trips.length) * 100)}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'var(--bg-elevated)' }}>
                      <td colSpan={2} style={{ fontWeight: 700, padding: '0.875rem 1rem' }}>Total</td>
                      <td style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--accent)', fontSize: '1.1rem' }}>{trips.length}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
