'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { Plus, Check, X, Clock } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site } from '@/lib/supabase/types'
import {
  leaveRepository,
  LeaveError,
  type LeaveApplicationRow,
  type LeaveEmployeeOption,
} from '@/lib/repositories/leave'
import { sitesRepository } from '@/lib/repositories/sites'
import toast from 'react-hot-toast'

type LeaveApplication = LeaveApplicationRow
type LeaveEmployee = LeaveEmployeeOption

export default function LeavePage() {
  const { isAdmin, isSiteManager, loading: authLoading, assignedSites } = useAuth()
  const router = useRouter()
  const [applications, setApplications] = useState<LeaveApplication[]>([])
  const [employees, setEmployees] = useState<LeaveEmployee[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
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
    void loadInitialData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, isAdmin, isSiteManager])

  useEffect(() => {
    if (selectedSite) {
      void loadApplications(selectedSite)
    } else if (!loading && sites.length === 0) {
      // No sites available
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite, activeTab])

  useEffect(() => {
    const onFlushed = () => {
      if (selectedSite) void loadApplications(selectedSite)
    }
    window.addEventListener('khani:outbox-flushed', onFlushed)
    return () => window.removeEventListener('khani:outbox-flushed', onFlushed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite, activeTab])

  useEffect(() => {
    if (!selectedSite) return
    const channel = supabase
      .channel(`leave-realtime-${selectedSite}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leave_applications',
        },
        () => {
          void loadApplications(selectedSite)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite, activeTab])

  const loadInitialData = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [rawSitesData, empsData] = await Promise.all([
        sitesRepository.listActive(supabase),
        leaveRepository.listEmployees(supabase),
      ])

      let sitesData = rawSitesData
      if (sitesData.length === 0 && assignedSites && assignedSites.length > 0) {
        sitesData = assignedSites as unknown as Site[]
      }

      setSites(sitesData)
      setEmployees(empsData)

      if (sitesData.length > 0) {
        const nextSite = selectedSite && sitesData.some(s => s.id === selectedSite) ? selectedSite : sitesData[0].id
        setSelectedSite(nextSite)
        await loadApplications(nextSite, empsData)
      } else {
        setSelectedSite('')
        setApplications([])
        setLoading(false)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Error loading leave data: ${message}`)
      setLoadError(message)
      setLoading(false)
    }
  }

  const loadApplications = async (siteToLoad?: string, empsToUse?: LeaveEmployee[]) => {
    const site = siteToLoad || selectedSite
    if (!site) {
      setLoading(false)
      return
    }

    setLoading(true)
    setLoadError(null)

    try {
      const currentEmps = empsToUse || employees
      let siteEmpIds = currentEmps.filter((e) => e.site_id === site).map((e) => e.id)

      if (siteEmpIds.length === 0) {
        const siteEmps = await leaveRepository.listEmployees(supabase, site)
        if (siteEmps.length > 0) {
          setEmployees(prev => {
            const map = new Map(prev.map(e => [e.id, e]))
            siteEmps.forEach(e => map.set(e.id, e))
            return Array.from(map.values())
          })
          siteEmpIds = siteEmps.map(e => e.id)
        }
      }

      if (siteEmpIds.length === 0) {
        setApplications([])
        setLoading(false)
        return
      }

      const data = await leaveRepository.listApplications(supabase, siteEmpIds, activeTab)
      setApplications(data)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      toast.error(`Error loading leave applications: ${message}`)
      setLoadError(message)
    } finally {
      setLoading(false)
    }
  }

  const submitLeave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      await leaveRepository.submit(supabase, {
        employee_id: form.employee_id,
        from_date: form.from_date,
        to_date: form.to_date,
        reason: form.reason || null,
      })
      toast.success('Leave application submitted')
      setForm({
        employee_id: '',
        from_date: format(new Date(), 'yyyy-MM-dd'),
        to_date: format(new Date(), 'yyyy-MM-dd'),
        reason: '',
      })
      setShowForm(false)
      void loadApplications()
    } catch (err: unknown) {
      if (err instanceof LeaveError) {
        toast.error(err.message)
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error'
        toast.error(`Error submitting leave: ${message}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const updateStatus = async (id: string, status: 'approved' | 'rejected', force = false) => {
    try {
      if (status === 'approved') {
        try {
          await leaveRepository.approve(supabase, id, force)
        } catch (err) {
          if (err instanceof LeaveError && err.code === 'overwrite' && !force) {
            if (
              confirm(
                `${err.message}\n\nForce approve will overwrite existing Present/Absent/Half-day marks with Leave. Continue?`
              )
            ) {
              await leaveRepository.approve(supabase, id, true)
            } else {
              return
            }
          } else {
            throw err
          }
        }
      } else {
        await leaveRepository.reject(supabase, id)
      }
      toast.success(`Leave application ${status}`)
      void loadApplications()
    } catch (err: unknown) {
      if (err instanceof LeaveError) {
        toast.error(err.message)
      } else {
        const message = err instanceof Error ? err.message : 'Unknown error'
        toast.error(`Error updating status: ${message}`)
      }
    }
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
      ) : sites.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Active Sites Found</div>
          <div className="empty-desc" style={{ marginBottom: '1rem' }}>
            {isAdmin
              ? 'Please create and activate at least one site in Master Data before managing leave.'
              : 'No active mining site is currently assigned to your account. Please contact an organization administrator.'}
          </div>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => router.push('/dashboard/settings')}>
              Go to Master Data
            </button>
          )}
        </div>
      ) : loadError ? (
        <div className="empty-state">
          <div className="empty-title">Leave Applications Not Loaded</div>
          <div className="empty-desc" style={{ marginBottom: '1rem' }}>
            {loadError}
          </div>
          <button className="btn btn-secondary" onClick={() => loadApplications()}>
            Retry Loading
          </button>
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
                      &ldquo;{app.reason}&rdquo;
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
                {app.status === 'approved' && (
                  <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      title="Reverse approval: restore leave balance and clear leave attendance"
                      onClick={async () => {
                        if (
                          !confirm(
                            'Reverse this leave approval? Leave balance will be restored and leave attendance for those days will be removed. Application returns to pending.'
                          )
                        ) {
                          return
                        }
                        try {
                          await leaveRepository.unapprove(supabase, app.id)
                          toast.success('Leave approval reversed')
                          void loadApplications()
                        } catch (err: unknown) {
                          if (err instanceof LeaveError) toast.error(err.message)
                          else toast.error(err instanceof Error ? err.message : 'Failed to reverse')
                        }
                      }}
                    >
                      Undo
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
