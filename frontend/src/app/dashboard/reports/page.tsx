'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  subMonths,
  parseISO,
  isValid,
} from 'date-fns'
import { Download, FileText, Printer, Calendar } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site, Trip, CashBook, CashEntry } from '@/lib/supabase/types'
import { formatInr } from '@/lib/calculations'
import toast from 'react-hot-toast'

interface ExtendedTrip extends Trip {
  vehicles?: {
    plate_number: string
    vehicle_type: '12WH' | '10WH' | '6WH' | 'Other'
  } | null
  transport_contractors?: {
    name: string
  } | null
}

interface ExtendedCashEntry extends CashEntry {
  book_date?: string
}

export default function ReportsPage() {
  const { isAdmin, isSiteManager, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  /** day | week | month report structure */
  const [rangeMode, setRangeMode] = useState<'day' | 'week' | 'month'>('month')
  const [period, setPeriod] = useState(format(startOfMonth(new Date()), 'yyyy-MM'))
  const [dayDate, setDayDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [weekDate, setWeekDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [loading, setLoading] = useState(false)
  const [trips, setTrips] = useState<ExtendedTrip[]>([])
  const [cashEntries, setCashEntries] = useState<ExtendedCashEntry[]>([])
  const [cashBooks, setCashBooks] = useState<CashBook[]>([])
  const [activeReport, setActiveReport] = useState<'trips' | 'cash' | 'contractor' | 'employee'>('trips')

  // Employee report states
  const [employees, setEmployees] = useState<any[]>([])
  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [employeeData, setEmployeeData] = useState<{
    attendance: any[]
    leaves: any[]
    payroll: any[]
    details: any | null
  }>({ attendance: [], leaves: [], payroll: [], details: null })

  // MoM Comparison states
  const [comparison, setComparison] = useState<{
    prevTripsCount: number
    tripsDiffPct: number | null
    prevTotalIn: number
    inDiffPct: number | null
    prevTotalOut: number
    outDiffPct: number | null
  } | null>(null)

  // Date-range export state
  const [exportFrom, setExportFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [exportTo, setExportTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [exportLoading, setExportLoading] = useState(false)
  const [tripsTruncated, setTripsTruncated] = useState(false)
  const [cashTruncated, setCashTruncated] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin && !isSiteManager) {
      router.push('/dashboard')
      return
    }
    supabase.from('sites').select('*').eq('active', true).order('name').limit(200).then(({ data, error }) => {
      if (error) {
        toast.error(`Error loading sites: ${error.message}`)
      } else {
        const loaded = data || []
        setSites(loaded)
        if (isAdmin) {
          setSelectedSite('all')
        } else if (loaded.length > 0) {
          setSelectedSite(loaded[0].id)
        }
      }
    })
  }, [authLoading, isAdmin, isSiteManager])

  const getReportRange = (): { from: string; to: string; label: string } => {
    if (rangeMode === 'day') {
      const d = dayDate || format(new Date(), 'yyyy-MM-dd')
      return { from: d, to: d, label: d }
    }
    if (rangeMode === 'week') {
      const base = parseISO(weekDate || format(new Date(), 'yyyy-MM-dd'))
      const start = startOfWeek(isValid(base) ? base : new Date(), { weekStartsOn: 1 })
      const end = endOfWeek(isValid(base) ? base : new Date(), { weekStartsOn: 1 })
      return {
        from: format(start, 'yyyy-MM-dd'),
        to: format(end, 'yyyy-MM-dd'),
        label: `${format(start, 'yyyy-MM-dd')} → ${format(end, 'yyyy-MM-dd')}`,
      }
    }
    const from = `${period}-01`
    const to = format(endOfMonth(new Date(from)), 'yyyy-MM-dd')
    return { from, to, label: period }
  }

  useEffect(() => {
    if (selectedSite) loadData()
  }, [selectedSite, period, rangeMode, dayDate, weekDate])

  useEffect(() => {
    if (!selectedSite) return
    let query = supabase.from('employees').select('*, sites(name)').eq('active', true).order('name')
    if (selectedSite !== 'all') {
      query = query.eq('site_id', selectedSite)
    }
    query.then(({ data }) => {
      setEmployees(data || [])
      if (data?.length) setSelectedEmployee(data[0].id)
      else setSelectedEmployee('')
    })
  }, [selectedSite])

  const loadEmployeeReport = async () => {
    if (!selectedEmployee) return
    setLoading(true)
    const from = period + '-01'
    const to = format(endOfMonth(new Date(from)), 'yyyy-MM-dd')

    try {
      const [attRes, leavesRes, payrollRes, empRes] = await Promise.all([
        supabase.from('attendance').select('*').eq('employee_id', selectedEmployee).gte('att_date', from).lte('att_date', to).order('att_date'),
        supabase.from('leave_applications').select('*').eq('employee_id', selectedEmployee).order('from_date', { ascending: false }),
        supabase.from('payroll_lines').select('*, payroll_runs(period_month, status)').eq('employee_id', selectedEmployee),
        supabase.from('employees').select('*, sites(name)').eq('id', selectedEmployee).single()
      ])

      setEmployeeData({
        attendance: attRes.data || [],
        leaves: leavesRes.data || [],
        payroll: payrollRes.data || [],
        details: empRes.data || null
      })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeReport === 'employee' && selectedEmployee) {
      loadEmployeeReport()
    }
  }, [selectedEmployee, period, activeReport])

  const loadData = async () => {
    setLoading(true)
    const { from, to } = getReportRange()

    // Previous period of equal length for MoM-style comparison (month mode: prior calendar month)
    let prevFrom: string
    let prevTo: string
    if (rangeMode === 'month') {
      const prevMonthDate = subMonths(new Date(from), 1)
      prevFrom = format(prevMonthDate, 'yyyy-MM-01')
      prevTo = format(endOfMonth(prevMonthDate), 'yyyy-MM-dd')
    } else if (rangeMode === 'week') {
      const start = parseISO(from)
      const prevStart = new Date(start)
      prevStart.setDate(prevStart.getDate() - 7)
      const prevEnd = new Date(parseISO(to))
      prevEnd.setDate(prevEnd.getDate() - 7)
      prevFrom = format(prevStart, 'yyyy-MM-dd')
      prevTo = format(prevEnd, 'yyyy-MM-dd')
    } else {
      const d = parseISO(from)
      const prev = new Date(d)
      prev.setDate(prev.getDate() - 1)
      prevFrom = format(prev, 'yyyy-MM-dd')
      prevTo = prevFrom
    }

    let tripsQuery = supabase
      .from('trips')
      .select('*, vehicles(plate_number, vehicle_type), transport_contractors(name)')
      .gte('trip_date', from)
      .lte('trip_date', to)
      .eq('active', true)
      .order('trip_date')
      .limit(1000)

    let booksQuery = supabase
      .from('cash_books')
      .select('*, cash_entries(*)')
      .gte('book_date', from)
      .lte('book_date', to)
      .order('book_date')
      .limit(1000)

    let prevTripsQuery = supabase
      .from('trips')
      .select('id')
      .gte('trip_date', prevFrom)
      .lte('trip_date', prevTo)
      .eq('active', true)
      .limit(1000)

    let prevBooksQuery = supabase
      .from('cash_books')
      .select('*, cash_entries(*)')
      .gte('book_date', prevFrom)
      .lte('book_date', prevTo)
      .limit(1000)

    if (selectedSite !== 'all') {
      tripsQuery = tripsQuery.eq('site_id', selectedSite)
      booksQuery = booksQuery.eq('site_id', selectedSite)
      prevTripsQuery = prevTripsQuery.eq('site_id', selectedSite)
      prevBooksQuery = prevBooksQuery.eq('site_id', selectedSite)
    }

    const [
      { data: tripsData, error: tripsError },
      { data: booksData, error: booksError },
      { data: prevTripsData },
      { data: prevBooksData }
    ] = await Promise.all([
      tripsQuery,
      booksQuery,
      prevTripsQuery,
      prevBooksQuery
    ])

    if (tripsError) toast.error(`Error loading report trips: ${tripsError.message}`)
    if (booksError) toast.error(`Error loading report cash books: ${booksError.message}`)

    const currentTrips = tripsData || []
    setTrips((currentTrips as any) || [])
    setCashBooks(booksData || [])
    
    const allEntries: ExtendedCashEntry[] = (booksData || []).flatMap((b: any) =>
      (b.cash_entries || [])
        .filter((e: any) => e.active === true)
        .map((e: any) => ({ ...e, book_date: b.book_date }))
    )
    setCashEntries(allEntries)

    setTripsTruncated(currentTrips.length === 1000)
    setCashTruncated((booksData || []).length === 1000 || allEntries.length >= 1000)

    // MoM variance math
    const prevTripsCount = prevTripsData?.length || 0
    const tripsDiff = currentTrips.length - prevTripsCount
    const tripsDiffPct = prevTripsCount > 0 ? (tripsDiff / prevTripsCount) * 100 : (tripsDiff > 0 ? null : 0)

    const currentIn = allEntries.filter(e => e.entry_type === 'in').reduce((s, e) => s + e.amount, 0)
    const currentOut = allEntries.filter(e => e.entry_type === 'out').reduce((s, e) => s + e.amount, 0)

    const prevEntries = (prevBooksData || []).flatMap((b: any) =>
      (b.cash_entries || [])
        .filter((e: any) => e.active === true)
    )
    const prevTotalIn = prevEntries.filter((e: any) => e.entry_type === 'in').reduce((s: number, e: any) => s + e.amount, 0)
    const prevTotalOut = prevEntries.filter((e: any) => e.entry_type === 'out').reduce((s: number, e: any) => s + e.amount, 0)

    const inDiff = currentIn - prevTotalIn
    const inDiffPct = prevTotalIn > 0 ? (inDiff / prevTotalIn) * 100 : (inDiff > 0 ? null : 0)

    const outDiff = currentOut - prevTotalOut
    const outDiffPct = prevTotalOut > 0 ? (outDiff / prevTotalOut) * 100 : (outDiff > 0 ? null : 0)

    setComparison({
      prevTripsCount,
      tripsDiffPct,
      prevTotalIn,
      inDiffPct,
      prevTotalOut,
      outDiffPct,
    })

    setLoading(false)
  }

  // Sanitizes against CSV formula injection (prevents starting with =, +, -, @)
  const sanitizeCSVCell = (c: string) => {
    if (!c) return ''
    const valStr = String(c)
    if (['=', '+', '-', '@', '\t', '\r'].some(char => valStr.startsWith(char))) {
      return `'${valStr}`
    }
    return valStr
  }

  // Export to CSV helper
  const exportCSV = (rows: string[][], filename: string) => {
    const csv = rows.map(r => r.map(c => `"${sanitizeCSVCell(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const periodLabel = () => getReportRange().label.replace(/[^\w.-]+/g, '_')

  /** Monthly (and general) totals requested by ops */
  const reportTotals = (() => {
    const advancePaid = trips.reduce((s, t) => s + (Number(t.advance_amount) || 0), 0)
    const expense = cashEntries
      .filter((e) => e.entry_type === 'out')
      .reduce((s, e) => s + (Number(e.amount) || 0), 0)
    const toBePaidContractors = trips
      .filter((t) => t.payment_status !== 'settled' && !t.settled)
      .reduce((s, t) => {
        const cost = Number(t.trip_worth ?? t.total_shipment_cost) || 0
        const adv = Number(t.advance_amount) || 0
        return s + Math.max(0, cost - adv)
      }, 0)
    const pendingAmounts = trips
      .filter((t) => (t.payment_status || 'pending') === 'pending')
      .reduce((s, t) => s + (Number(t.trip_worth ?? t.total_shipment_cost) || 0), 0)
    const tripCostTotal = trips.reduce(
      (s, t) => s + (Number(t.trip_worth ?? t.total_shipment_cost) || 0),
      0
    )
    return { advancePaid, expense, toBePaidContractors, pendingAmounts, tripCostTotal }
  })()

  const exportTripsCSV = () => {
    const rows = [
      ['Date', 'Plate Number', 'Vehicle Type', 'Contractor', 'Ownership', 'Permit', 'Cubic Capacity', 'Advance', 'Customer', 'Drop Location', 'Distance (KM)', 'Trip cost', 'Payment Status', 'Load Info'],
      ...trips.map(t => [
        t.trip_date,
        t.vehicles?.plate_number || '',
        t.vehicles?.vehicle_type || '',
        t.transport_contractors?.name || '',
        t.ownership_snapshot || '',
        t.permit_number || '',
        t.cubic_capacity || '',
        t.advance_amount || 0,
        (t as any).customers?.name || '',
        t.drop_location || '',
        t.distance_km || '',
        t.trip_worth || '',
        t.payment_status || 'pending',
        t.load_info || '',
      ]),
      [],
      ['SUMMARY'],
      ['Advance paid', String(reportTotals.advancePaid)],
      ['Trip cost total', String(reportTotals.tripCostTotal)],
      ['To be paid to contractors', String(reportTotals.toBePaidContractors)],
      ['Pending collection amounts', String(reportTotals.pendingAmounts)],
    ]
    exportCSV(rows, `trips_${selectedSite}_${periodLabel()}.csv`)
  }

  const exportCashCSV = () => {
    const rows = [
      ['Date', 'Type', 'Category', 'Amount', 'Note', 'Contractor'],
      ...cashEntries.map(e => [
        e.book_date || '',
        e.entry_type,
        e.category,
        String(e.amount),
        e.note || '',
        (e as any).contractor_id || '',
      ]),
      [],
      ['SUMMARY'],
      ['Total expenses (out)', String(reportTotals.expense)],
      ['Total cash in', String(cashEntries.filter(e => e.entry_type === 'in').reduce((s, e) => s + e.amount, 0))],
    ]
    exportCSV(rows, `cashbook_${selectedSite}_${periodLabel()}.csv`)
  }

  const exportPeriodSummaryCSV = () => {
    const { label } = getReportRange()
    const rows = [
      ['Report period', label],
      ['Site', selectedSite === 'all' ? 'All sites' : sites.find((s) => s.id === selectedSite)?.name || selectedSite],
      ['Trips count', String(trips.length)],
      ['Advance paid', String(reportTotals.advancePaid)],
      ['Expenses (cash out)', String(reportTotals.expense)],
      ['To be paid to contractors', String(reportTotals.toBePaidContractors)],
      ['Pending amounts (unsettled trip cost)', String(reportTotals.pendingAmounts)],
      ['Trip cost total', String(reportTotals.tripCostTotal)],
    ]
    exportCSV(rows, `summary_${selectedSite}_${periodLabel()}.csv`)
  }

  // ─── Date-range cashflow export ───────────────────────────────────────────
  const exportDateRangeCash = async () => {
    if (!selectedSite || !exportFrom || !exportTo) return
    if (exportFrom > exportTo) {
      toast.error('Start date must be before end date.')
      return
    }
    setExportLoading(true)

    const { data: booksData, error: booksError } = await supabase
      .from('cash_books')
      .select('book_date, opening_balance, closing_balance, status, cash_entries(*)')
      .eq('site_id', selectedSite)
      .gte('book_date', exportFrom)
      .lte('book_date', exportTo)
      .order('book_date')
      .limit(2000)

    if (booksError) {
      toast.error(`Error fetching data: ${booksError.message}`)
      setExportLoading(false)
      return
    }

    const allEntries: ExtendedCashEntry[] = (booksData || []).flatMap((b: any) =>
      (b.cash_entries || [])
        .filter((e: any) => e.active === true)
        .map((e: any) => ({ ...e, book_date: b.book_date }))
    )

    // Summary header rows
    const totalIn = allEntries.filter((e: any) => e.entry_type === 'in').reduce((s: number, e: any) => s + e.amount, 0)
    const totalOut = allEntries.filter((e: any) => e.entry_type === 'out').reduce((s: number, e: any) => s + e.amount, 0)
    const openingBal = (booksData?.[0] as any)?.opening_balance ?? 0
    
    // Date-range closing balance referencing the actual DB closing balance of the last book
    const lastBook = booksData && booksData.length > 0 ? booksData[booksData.length - 1] : null
    const closingBal = lastBook ? (lastBook.closing_balance ?? (openingBal + totalIn - totalOut)) : (openingBal + totalIn - totalOut)

    const siteName = sites.find(s => s.id === selectedSite)?.name || selectedSite

    const rows = [
      ['MineOps Cash Flow Report'],
      ['Site', siteName],
      ['Period', `${exportFrom} to ${exportTo}`],
      ['Generated', format(new Date(), 'dd MMM yyyy HH:mm')],
      [],
      ['Opening Balance', String(openingBal)],
      ['Total Cash In', String(totalIn)],
      ['Total Cash Out', String(totalOut)],
      ['Closing Balance', String(closingBal)],
      [],
      ['Date', 'Type', 'Category', 'Amount (₹)', 'Note'],
      ...allEntries.map((e: any) => [
        format(new Date(e.book_date), 'dd MMM yyyy'),
        e.entry_type === 'in' ? 'Cash In' : 'Cash Out',
        e.category,
        String(e.amount),
        e.note || '',
      ]),
    ]

    const dateLabel = `${exportFrom}_to_${exportTo}`
    exportCSV(rows, `cashflow_${siteName}_${dateLabel}.csv`)
    setExportLoading(false)
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
          <p className="page-subtitle">Daily, weekly & monthly reports — view and download</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={exportPeriodSummaryCSV}>
            <Download size={16} /> Download summary
          </button>
          <button className="btn btn-secondary btn-sm" onClick={printReport}>
            <Printer size={16} /> Print
          </button>
        </div>
      </div>

      {/* Controls: period type + site */}
      <div className="card mb-4" style={{ padding: '0.875rem 1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          {(
            [
              { key: 'day' as const, label: 'Daily' },
              { key: 'week' as const, label: 'Weekly' },
              { key: 'month' as const, label: 'Monthly' },
            ] as const
          ).map((m) => (
            <button
              key={m.key}
              type="button"
              className={`btn btn-sm ${rangeMode === m.key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setRangeMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="form-input form-select" style={{ flex: 1, minWidth: '140px' }}
            value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
            {isAdmin && <option value="all">All Sites (Global)</option>}
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {rangeMode === 'day' && (
            <input
              type="date"
              className="form-input"
              style={{ flex: 1, minWidth: '140px' }}
              value={dayDate}
              onChange={(e) => setDayDate(e.target.value)}
            />
          )}
          {rangeMode === 'week' && (
            <input
              type="date"
              className="form-input"
              style={{ flex: 1, minWidth: '140px' }}
              value={weekDate}
              onChange={(e) => setWeekDate(e.target.value)}
              title="Any day in the week (Mon–Sun)"
            />
          )}
          {rangeMode === 'month' && (
            <input
              type="month"
              className="form-input"
              style={{ flex: 1, minWidth: '140px' }}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          )}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          Period: <strong>{getReportRange().label}</strong>
          {rangeMode === 'week' ? ' (week starts Monday)' : ''}
        </div>
      </div>

      {/* Totals strip — monthly report amounts (also shown for day/week) */}
      <div className="grid-2 mb-4" style={{ gap: '0.75rem' }}>
        <div className="card" style={{ padding: '0.875rem 1rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Advance paid
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.25rem' }}>
            {formatInr(reportTotals.advancePaid)}
          </div>
        </div>
        <div className="card" style={{ padding: '0.875rem 1rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Expense
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.25rem' }}>
            {formatInr(reportTotals.expense)}
          </div>
        </div>
        <div className="card" style={{ padding: '0.875rem 1rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            To be paid to contractors
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.25rem' }}>
            {formatInr(reportTotals.toBePaidContractors)}
          </div>
        </div>
        <div className="card" style={{ padding: '0.875rem 1rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
            Pending amounts
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.25rem' }}>
            {formatInr(reportTotals.pendingAmounts)}
          </div>
        </div>
      </div>

      {/* Warning banner for data limit truncation */}
      {(tripsTruncated || cashTruncated) && (
        <div className="card mb-4" style={{ borderLeft: '4px solid var(--warning)', padding: '0.875rem 1rem', background: 'rgba(217, 119, 6, 0.1)' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '1.2rem' }}>⚠️</span>
            <div style={{ fontSize: '0.8rem', color: 'var(--warning)', fontWeight: 500 }}>
              Report data limit reached (1000 rows). Some records may not be visible. Please narrow down the date period/filter.
            </div>
          </div>
        </div>
      )}

      {activeReport === 'employee' && (
        <div className="card mb-4" style={{ padding: '0.875rem 1rem' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' }}>
            Select Employee
          </label>
          <select 
            className="form-input form-select" 
            value={selectedEmployee} 
            onChange={e => setSelectedEmployee(e.target.value)}
          >
            <option value="">-- Choose Employee --</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name} ({emp.role})</option>
            ))}
          </select>
        </div>
      )}

      {/* ─── Date-range Cash Flow Export Card ─────────────────────────────── */}
      <div className="card mb-4" style={{ padding: '1rem' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          marginBottom: '0.875rem',
        }}>
          <Calendar size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>Cash Flow Export by Date Range</span>
        </div>
        <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: '130px' }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              From
            </label>
            <input
              type="date"
              className="form-input"
              value={exportFrom}
              onChange={e => setExportFrom(e.target.value)}
            />
          </div>
          <div style={{ flex: 1, minWidth: '130px' }}>
            <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              To
            </label>
            <input
              type="date"
              className="form-input"
              value={exportTo}
              onChange={e => setExportTo(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ minWidth: '130px' }}
            onClick={exportDateRangeCash}
            disabled={exportLoading || !selectedSite}
          >
            {exportLoading ? <span className="spinner" /> : <><Download size={15} /> Export CSV</>}
          </button>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
          Exports all cash entries for the selected site between the chosen dates, with a summary of opening/closing balances.
        </div>
      </div>

      {/* Month-over-Month Comparison Cards */}
      {comparison && (
        <div className="grid-3 mb-4" style={{ gap: '0.75rem' }}>
          <div className="card" style={{ padding: '0.875rem 1rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>MoM Trips</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '1.15rem', fontWeight: 700 }}>{trips.length}</span>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: (comparison.tripsDiffPct === null || comparison.tripsDiffPct >= 0) ? 'var(--success)' : 'var(--danger)' }}>
                {comparison.tripsDiffPct === null ? 'New' : `${comparison.tripsDiffPct >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(comparison.tripsDiffPct))}%`}
              </span>
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
              vs {comparison.prevTripsCount} last month
            </div>
          </div>

          <div className="card" style={{ padding: '0.875rem 1rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>MoM Cash In</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '1.15rem', fontWeight: 700 }} title={`₹${totalIn.toLocaleString('en-IN')}`}>{formatInr(totalIn)}</span>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: (comparison.inDiffPct === null || comparison.inDiffPct >= 0) ? 'var(--success)' : 'var(--danger)' }}>
                {comparison.inDiffPct === null ? 'New' : `${comparison.inDiffPct >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(comparison.inDiffPct))}%`}
              </span>
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
              vs {formatInr(comparison.prevTotalIn)} last month
            </div>
          </div>

          <div className="card" style={{ padding: '0.875rem 1rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>MoM Cash Out</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginTop: '0.25rem' }}>
              <span style={{ fontSize: '1.15rem', fontWeight: 700 }} title={`₹${totalOut.toLocaleString('en-IN')}`}>{formatInr(totalOut)}</span>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: (comparison.outDiffPct === null || comparison.outDiffPct <= 0) ? 'var(--success)' : 'var(--danger)' }}>
                {comparison.outDiffPct === null ? 'New' : `${comparison.outDiffPct >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(comparison.outDiffPct))}%`}
              </span>
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
              vs {formatInr(comparison.prevTotalOut)} last month
            </div>
          </div>
        </div>
      )}

      {/* Report tabs */}
      <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '1rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.25rem', flexWrap: 'wrap' }}>
        {[
          { key: 'trips', label: `🚛 Trips (${trips.length})` },
          { key: 'cash', label: `💰 Cash Book (${cashEntries.length})` },
          { key: 'contractor', label: `📊 Contractors (${Object.keys(contractorSummary).length})` },
          { key: 'employee', label: `👤 Employee (${employees.length})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveReport(tab.key as any)}
            style={{
              flex: 1, padding: '0.5rem', border: 'none', borderRadius: '7px',
              cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '0.8rem', fontWeight: 500,
              background: activeReport === tab.key ? 'var(--accent)' : 'transparent',
              color: activeReport === tab.key ? '#0a0b0f' : 'var(--text-muted)',
              transition: 'all 0.15s',
              minWidth: '100px',
            }}>
            {tab.label}
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
                      <th>Permit No.</th>
                      <th>Trip Worth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.length === 0 ? (
                      <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No trips in this period</td></tr>
                    ) : trips.map(t => (
                      <tr key={t.id}>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{format(new Date(t.trip_date), 'd MMM')}</td>
                        <td><strong style={{ fontFamily: 'var(--font-display)' }}>{t.vehicles?.plate_number}</strong></td>
                        <td><span className="badge badge-amber">{t.vehicles?.vehicle_type}</span></td>
                        <td>{t.transport_contractors?.name || '—'}</td>
                        <td><span className={`badge ${t.ownership_snapshot === 'owned' ? 'badge-blue' : 'badge-gray'}`}>{t.ownership_snapshot}</span></td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t.permit_number || '—'}</td>
                        <td><strong style={{ color: 'var(--success)' }} title={`₹${Number(t.trip_worth ?? 0).toLocaleString('en-IN')}`}>{formatInr(t.trip_worth ?? 0)}</strong></td>
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
                    <div className="stat-value" style={{ fontSize: '1.2rem', color: 'var(--success)' }} title={`₹${totalIn.toLocaleString('en-IN')}`}>{formatInr(totalIn)}</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon red"><FileText size={18} /></div>
                  <div>
                    <div className="stat-label">Total Out</div>
                    <div className="stat-value" style={{ fontSize: '1.2rem', color: 'var(--danger)' }} title={`₹${totalOut.toLocaleString('en-IN')}`}>{formatInr(totalOut)}</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon amber"><FileText size={18} /></div>
                  <div>
                    <div className="stat-label">Net</div>
                    <div className="stat-value" style={{ fontSize: '1.2rem', color: (totalIn - totalOut) >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {formatInr(totalIn - totalOut)}
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
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{format(new Date(e.book_date || ''), 'd MMM')}</td>
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

          {/* Employee Summary Report */}
          {activeReport === 'employee' && (
            <div>
              {!selectedEmployee ? (
                <div className="empty-state">
                  <div style={{ fontSize: '2.5rem' }}>👤</div>
                  <div className="empty-title">No employee selected</div>
                  <div className="empty-desc">Select an employee from the dropdown above to view muster logs, leave history, and payroll data.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Profile Card */}
                  {employeeData.details && (
                    <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{employeeData.details.name}</h3>
                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {employeeData.details.role} · {employeeData.details.phone || 'No phone'}
                        </p>
                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Site: {employeeData.details.sites?.name || 'Unassigned'}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent)' }}>
                          Wage: ₹{Number(employeeData.details.wage_rate).toLocaleString('en-IN')} / {employeeData.details.wage_type}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                          Entitled Leave Balance: <strong>{employeeData.details.leave_balance ?? 15}</strong> days
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Summary grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem' }}>
                    <div className="card" style={{ textAlign: 'center', padding: '0.75rem' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Present</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--success)', marginTop: '0.25rem' }}>
                        {employeeData.attendance.filter((a: any) => a.status === 'present').length}
                      </div>
                    </div>
                    <div className="card" style={{ textAlign: 'center', padding: '0.75rem' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Leave</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent)', marginTop: '0.25rem' }}>
                        {employeeData.attendance.filter((a: any) => a.status === 'leave').length}
                      </div>
                    </div>
                    <div className="card" style={{ textAlign: 'center', padding: '0.75rem' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Half-Day</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--info)', marginTop: '0.25rem' }}>
                        {employeeData.attendance.filter((a: any) => a.status === 'half-day').length}
                      </div>
                    </div>
                    <div className="card" style={{ textAlign: 'center', padding: '0.75rem' }}>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Absent</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--danger)', marginTop: '0.25rem' }}>
                        {employeeData.attendance.filter((a: any) => a.status === 'absent').length}
                      </div>
                    </div>
                  </div>

                  {/* Attendance Log Card */}
                  <div className="card">
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>Attendance muster logs for this period</h4>
                    {employeeData.attendance.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>No attendance records found for this period</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                        {employeeData.attendance.map((att: any) => (
                          <div key={att.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0.5rem', borderRadius: '5px', background: 'var(--bg-secondary)', fontSize: '0.75rem' }}>
                            <span>{format(new Date(att.att_date), 'd MMMM yyyy')}</span>
                            <span style={{
                              fontWeight: 600,
                              color: att.status === 'present' ? 'var(--success)' : att.status === 'leave' ? 'var(--accent)' : att.status === 'half-day' ? 'var(--info)' : 'var(--danger)'
                            }}>{att.status.toUpperCase()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Leave History Card */}
                  <div className="card">
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>Leave requests history</h4>
                    {employeeData.leaves.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>No leave applications logged</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                        {employeeData.leaves.map((lv: any) => (
                          <div key={lv.id} style={{ padding: '0.5rem', borderRadius: '5px', background: 'var(--bg-secondary)', fontSize: '0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500, marginBottom: '0.15rem' }}>
                              <span>{format(new Date(lv.from_date), 'd MMM')} → {format(new Date(lv.to_date), 'd MMM yyyy')}</span>
                              <span style={{
                                color: lv.status === 'approved' ? 'var(--success)' : lv.status === 'rejected' ? 'var(--danger)' : 'var(--warning)'
                              }}>{lv.status.toUpperCase()}</span>
                            </div>
                            {lv.reason && <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontStyle: 'italic' }}>"{lv.reason}"</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Payroll Summary Card */}
                  <div className="card">
                    <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>Payroll ledger items</h4>
                    {employeeData.payroll.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>No payroll runs found for this employee</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {employeeData.payroll.map((pr: any) => (
                          <div key={pr.id} style={{ padding: '0.5rem', borderRadius: '5px', background: 'var(--bg-secondary)', fontSize: '0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginBottom: '0.15rem' }}>
                              <span>Period: {format(new Date(pr.payroll_runs?.period_month), 'MMMM yyyy')}</span>
                              <span>₹{Number(pr.final_amount).toLocaleString('en-IN')}</span>
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                              Wages: ₹{Number(pr.computed_amount).toLocaleString('en-IN')} (adjustment: ₹{Number(pr.adjustment).toLocaleString('en-IN')})
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
