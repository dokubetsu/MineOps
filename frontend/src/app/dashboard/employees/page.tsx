'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { Plus, X } from 'lucide-react'
import { Site, Employee } from '@/lib/supabase/types'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import BottomSheet from '@/components/BottomSheet'
import ConfirmDialog from '@/components/ConfirmDialog'
import toast from 'react-hot-toast'

const ROLES = ['worker', 'supervisor', 'driver', 'other']

export default function EmployeesPage() {
  const { isAdmin, isSiteManager, loading: authLoading } = useAuth()
  const router = useRouter()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '', phone: '', role: 'worker', site_id: '',
    wage_type: 'daily', wage_rate: '', join_date: format(new Date(), 'yyyy-MM-dd'),
  })
  const [submitting, setSubmitting] = useState(false)

  // ConfirmDialog states
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin && !isSiteManager) {
      router.push('/dashboard')
      return
    }
    loadData()
  }, [authLoading, isAdmin, isSiteManager])

  useEffect(() => { if (selectedSite) loadEmployees() }, [selectedSite])

  const loadData = async () => {
    try {
      const { data: sitesData } = await supabase.from('sites').select('*').eq('active', true).order('name')
      const loadedSites = sitesData || []
      setSites(loadedSites)
      if (loadedSites.length > 0) {
        setSelectedSite(loadedSites[0].id)
        setForm(f => ({ ...f, site_id: loadedSites[0].id }))
      }
    } catch (err: any) {
      toast.error(`Error loading sites: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const loadEmployees = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('site_id', selectedSite)
        .eq('active', true)
        .order('name')
        .limit(500)

      if (error) throw error
      setEmployees(data || [])
    } catch (err: any) {
      toast.error(`Error loading roster: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    const rate = parseFloat(form.wage_rate)
    if (isNaN(rate) || rate < 0) {
      toast.error('Please enter a valid wage rate')
      setSubmitting(false)
      return
    }

    try {
      const { error } = await supabase.from('employees').insert({
        name: form.name,
        phone: form.phone || null,
        role: form.role,
        site_id: form.site_id,
        wage_type: form.wage_type as 'daily' | 'monthly',
        wage_rate: rate,
        join_date: form.join_date,
        active: true,
      })

      if (error) throw error
      toast.success('Employee registered successfully')
      setShowForm(false)
      setForm({
        name: '', phone: '', role: 'worker', site_id: selectedSite,
        wage_type: 'daily', wage_rate: '', join_date: format(new Date(), 'yyyy-MM-dd'),
      })
      loadEmployees()
    } catch (err: any) {
      toast.error(`Registration failed: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const executeDeactivate = async () => {
    if (!confirmDeactivateId) return
    try {
      const { error } = await supabase
        .from('employees')
        .update({ active: false })
        .eq('id', confirmDeactivateId)

      if (error) throw error
      toast.success('Employee record archived')
      loadEmployees()
    } catch (err: any) {
      toast.error(`Archiving failed: ${err.message}`)
    } finally {
      setConfirmDeactivateId(null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-subtitle">Site Roster Management</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={18} /> Add Employee
        </button>
      </div>

      {/* Site Filter */}
      <div className="card mb-4" style={{ padding: '0.875rem 1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {sites.length > 1 && (
            <select className="form-input form-select" style={{ width: '100%', minWidth: '160px' }}
              value={selectedSite} onChange={e => { setSelectedSite(e.target.value); setForm(f => ({ ...f, site_id: e.target.value })) }}>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '72px', borderRadius: 'var(--radius)' }} />)}
        </div>
      ) : employees.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">Roster is Empty</div>
          <div className="empty-desc">Tap "Add Employee" to register workers at this mine site</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {employees.map(emp => (
            <div key={emp.id} className="trip-card" style={{ justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{emp.name}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem', textTransform: 'capitalize' }}>
                  {emp.role} • {emp.phone || 'No phone'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent)', marginTop: '0.125rem' }}>
                  ₹{emp.wage_rate.toLocaleString('en-IN')}/{emp.wage_type === 'daily' ? 'day' : 'month'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="badge badge-gray">{emp.role}</span>
                <button className="btn btn-ghost btn-icon" onClick={() => setConfirmDeactivateId(emp.id)} title="Archive Employee">
                  <X size={16} style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="btn-fab" onClick={() => setShowForm(true)} title="Add Employee"><Plus size={24} /></button>

      {/* Shared BottomSheet for adding employees */}
      <BottomSheet isOpen={showForm} onClose={() => setShowForm(false)} title="Add Employee">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Full Name *</label>
            <input className="form-input" placeholder="Employee name" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input className="form-input" type="tel" placeholder="Phone number" value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Role</label>
              <select className="form-input form-select" value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Site</label>
              <select className="form-input form-select" value={form.site_id}
                onChange={e => setForm(f => ({ ...f, site_id: e.target.value }))}>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Wage Type</label>
              <select className="form-input form-select" value={form.wage_type}
                onChange={e => setForm(f => ({ ...f, wage_type: e.target.value }))}>
                <option value="daily">Daily</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Rate (₹) *</label>
              <input className="form-input" type="number" inputMode="numeric" placeholder="500" value={form.wage_rate}
                onChange={e => setForm(f => ({ ...f, wage_rate: e.target.value }))} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Join Date</label>
            <input className="form-input" type="date" value={form.join_date}
              onChange={e => setForm(f => ({ ...f, join_date: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary w-full" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
              {submitting ? <span className="spinner" /> : '+ Save Employee'}
            </button>
          </div>
        </form>
      </BottomSheet>

      {/* Shared ConfirmDialog for deactivation */}
      <ConfirmDialog 
        isOpen={confirmDeactivateId !== null}
        title="Archive Employee"
        message="Are you sure you want to archive this employee? They will be marked as inactive and removed from active roster views."
        onConfirm={executeDeactivate}
        onCancel={() => setConfirmDeactivateId(null)}
      />
    </div>
  )
}
