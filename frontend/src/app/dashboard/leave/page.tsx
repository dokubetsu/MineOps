'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { Plus, Check, X, Clock } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site, Employee } from '@/lib/supabase/types'
import toast from 'react-hot-toast'

interface LeaveApplication {
  id: string
  employee_id: string
  from_date: string
  to_date: string
  reason: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string | null
  updated_at: string | null
  employees?: {
    name: string
    site_id: string
  } | null
}

interface LeaveEmployee {
  id: string
  name: string
  site_id: string | null
}

export default function LeavePage() {
  const { isAdmin, isSiteManager, loading: authLoading } = useAuth()
  const router = useRouter()
  const [applications, setApplications] = useState<LeaveApplication[]>([])
  const [employees, setEmployees] = useState<LeaveEmployee[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [form, setForm] = useState({
    employee_id: '', from_date: format(new Date(), 'yyyy-MM-dd'),
    to_date: format(new Date(), 'yyyy-MM-dd'), reason: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin && !isSiteManager) {
      router.push('/dashboard')
      return
    }
    loadInitialData()
  }, [authLoading, isAdmin, isSiteManager])

  useEffect(() => { if (selectedSite) loadApplications() }, [selectedSite, activeTab])

  const loadInitialData = async () => {
    const [{ data: sitesData, error: sitesError }, { data: empsData, error: empsError }] = await Promise.all([
      supabase.from('sites').select('*').eq('active', true).order('name').limit(500),
      supabase.from('employees').select('id, name, site_id').eq('active', true).order('name').limit(500),
    ])

    if (sitesError) toast.error(`Error loading sites: ${sitesError.message}`)
    if (empsError) toast.error(`Error loading employees: ${empsError.message}`)

    setSites(sitesData || [])
    setEmployees(empsData || [])
    if (sitesData && sitesData.length > 0) setSelectedSite(sitesData[0].id)
  }

  const loadApplications = async () => {
    setLoading(true)
    const siteEmpIds = employees
      .filter(e => e.site_id === selectedSite)
      .map(e => e.id)

    if (siteEmpIds.length === 0) { setApplications([]); setLoading(false); return }

    let query = supabase
      .from('leave_applications')
      .select('*, employees(name, site_id)')
      .in('employee_id', siteEmpIds)
      .order('created_at', { ascending: false })
      .limit(500)

    if (activeTab !== 'all') query = query.eq('status', activeTab)

    const { data, error } = await query
    if (error) {
      toast.error(`Error loading leave applications: ${error.message}`)
    } else {
      setApplications((data as any) || [])
    }
    setLoading(false)
  }

  const submitLeave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    const { error } = await supabase.from('leave_applications').insert({
      employee_id: form.employee_id,
      from_date: form.from_date,
      to_date: form.to_date,
      reason: form.reason || null,
      status: 'pending',
    })
    
    if (error) {
      toast.error(`Error submitting leave: ${error.message}`)
    } else {
      toast.success('Leave application submitted')
      setForm({ employee_id: '', from_date: format(new Date(), 'yyyy-MM-dd'), to_date: format(new Date(), 'yyyy-MM-dd'), reason: '' })
      setShowForm(false)
      loadApplications()
    }
    setSubmitting(false)
  }

  const updateStatus = async (id: string, status: 'approved' | 'rejected') => {
    const { error: updateError } = await supabase.from('leave_applications').update({ status }).eq('id', id)
    if (updateError) {
      toast.error(`Error updating status: ${updateError.message}`)
      return
    }

    if (status === 'approved') {
      const app = applications.find(a => a.id === id)
      if (app) {
        const from = new Date(app.from_date)
        const to = new Date(app.to_date)
        const records: { employee_id: string; att_date: string; status: 'present' | 'absent' | 'half-day' | 'leave' }[] = []
        const cur = new Date(from)
        while (cur <= to) {
          records.push({
            employee_id: app.employee_id,
            att_date: format(cur, 'yyyy-MM-dd'),
            status: 'leave',
          })
          cur.setDate(cur.getDate() + 1)
        }
        if (records.length > 0) {
          const { error: upsertError } = await supabase.from('attendance').upsert(records, { onConflict: 'employee_id,att_date' })
          if (upsertError) {
            toast.error(`Error auto-marking attendance: ${upsertError.message}`)
          }
        }
      }
    }
    toast.success(`Leave application ${status}`)
    loadApplications()
  }

  const siteEmployees = employees.filter(e => e.site_id === selectedSite)
  const pending = applications.filter(a => a.status === 'pending').length

  const statusIcon = (status: string) => {
    if (status === 'approved') return <Check size={14} />
    if (status === 'rejected') return <X size={14} />
    return <Clock size={14} />
  }

  const statusBadge = (status: string) => {
    if (status === 'approved') return 'badge-green'
    if (status === 'rejected') return 'badge-red'
    return 'badge-amber'
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Leave Applications</h1>
          <p className="page-subtitle">{pending > 0 ? `${pending} pending approval` : 'All clear'}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={18} /> Apply Leave
        </button>
      </div>

      {/* Site + Tab filters */}
      <div className="card mb-4" style={{ padding: '0.875rem 1rem' }}>
        {sites.length > 1 && (
          <select className="form-input form-select mb-4" value={selectedSite}
            onChange={e => setSelectedSite(e.target.value)}>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <div style={{ display: 'flex', gap: '0.375rem', background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', padding: '0.25rem' }}>
          {(['pending', 'approved', 'rejected', 'all'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '0.4rem', border: 'none', borderRadius: '7px',
                cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: '0.75rem', fontWeight: 500,
                background: activeTab === tab ? 'var(--accent)' : 'transparent',
                color: activeTab === tab ? '#0a0b0f' : 'var(--text-muted)',
                transition: 'all 0.15s', textTransform: 'capitalize',
              }}>
              {tab}
              {tab === 'pending' && pending > 0 && (
                <span style={{ marginLeft: '0.25rem', background: 'rgba(0,0,0,0.2)', borderRadius: '999px', padding: '0 0.3rem', fontSize: '0.65rem' }}>
                  {pending}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Applications list */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '90px', borderRadius: 'var(--radius)' }} />)}
        </div>
      ) : applications.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '2rem' }}>📅</div>
          <div className="empty-title">No {activeTab === 'all' ? '' : activeTab} applications</div>
          <div className="empty-desc">Leave requests will appear here</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {applications.map(app => {
            const fromD = new Date(app.from_date)
            const toD = new Date(app.to_date)
            const days = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1
            return (
              <div key={app.id} className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '50%',
                  background: 'var(--bg-elevated)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, color: 'var(--text-secondary)', fontSize: '0.9rem', flexShrink: 0,
                }}>
                  {app.employees?.name?.[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 600 }}>{app.employees?.name}</span>
                    <span className={`badge ${statusBadge(app.status)}`}>
                      {statusIcon(app.status)} {app.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {format(fromD, 'd MMM')} → {format(toD, 'd MMM yyyy')} · {days} day{days !== 1 ? 's' : ''}
                  </div>
                  {app.reason && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem', fontStyle: 'italic' }}>
                      "{app.reason}"
                    </div>
                  )}
                </div>
                {app.status === 'pending' && (
                  <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                    <button className="btn btn-success btn-sm" onClick={() => updateStatus(app.id, 'approved')}>
                      <Check size={14} /> Approve
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => updateStatus(app.id, 'rejected')}>
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <button className="btn-fab" onClick={() => setShowForm(true)}><Plus size={24} /></button>

      {/* Leave Form Sheet */}
      {showForm && (
        <>
          <div className="sheet-overlay" onClick={() => setShowForm(false)} />
          <div className="sheet">
            <div className="sheet-handle" />
            <div className="sheet-title">Apply for Leave</div>
            <form onSubmit={submitLeave}>
              <div className="form-group">
                <label className="form-label">Employee *</label>
                <select className="form-input form-select" value={form.employee_id}
                  onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} required>
                  <option value="">Select employee</option>
                  {siteEmployees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">From Date *</label>
                  <input className="form-input" type="date" value={form.from_date}
                    onChange={e => setForm(f => ({ ...f, from_date: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">To Date *</label>
                  <input className="form-input" type="date" value={form.to_date} min={form.from_date}
                    onChange={e => setForm(f => ({ ...f, to_date: e.target.value }))} required />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Reason</label>
                <textarea className="form-input" placeholder="Reason for leave (optional)"
                  value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  rows={3} style={{ resize: 'vertical' }} />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary w-full" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                  {submitting ? <span className="spinner" /> : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
