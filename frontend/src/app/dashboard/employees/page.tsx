'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { Plus, X, Edit } from 'lucide-react'

const ROLES = ['worker', 'supervisor', 'driver', 'other']

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<any[]>([])
  const [sites, setSites] = useState<any[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '', phone: '', role: 'worker', site_id: '',
    wage_type: 'daily', wage_rate: '', join_date: format(new Date(), 'yyyy-MM-dd'),
  })
  const [submitting, setSubmitting] = useState(false)
  const supabase = createClient()

  useEffect(() => { loadData() }, [])
  useEffect(() => { if (selectedSite) loadEmployees() }, [selectedSite])

  const loadData = async () => {
    const { data: sitesData } = await supabase.from('sites').select('*').eq('active', true).order('name')
    setSites(sitesData || [])
    if (sitesData && sitesData.length > 0) {
      setSelectedSite(sitesData[0].id)
      setForm(f => ({ ...f, site_id: sitesData[0].id }))
    }
  }

  const loadEmployees = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('employees')
      .select('*, sites(name)')
      .eq('site_id', selectedSite)
      .order('name')
    setEmployees(data || [])
    setLoading(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    const { error } = await supabase.from('employees').insert({
      name: form.name,
      phone: form.phone || null,
      role: form.role,
      site_id: form.site_id,
      wage_type: form.wage_type,
      wage_rate: parseFloat(form.wage_rate) || 0,
      join_date: form.join_date,
      active: true,
    })
    if (error) {
      alert(`Error saving employee: ${error.message}`)
    } else {
      setShowForm(false)
      setForm({ name: '', phone: '', role: 'worker', site_id: selectedSite, wage_type: 'daily', wage_rate: '', join_date: format(new Date(), 'yyyy-MM-dd') })
      loadEmployees()
    }
    setSubmitting(false)
  }

  const deactivate = async (id: string) => {
    if (!confirm('Remove this employee?')) return
    await supabase.from('employees').update({ active: false }).eq('id', id)
    loadEmployees()
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-subtitle">{employees.length} active</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={18} /> Add Employee
        </button>
      </div>

      {sites.length > 1 && (
        <div className="card mb-4" style={{ padding: '0.75rem 1rem' }}>
          <select className="form-input form-select" value={selectedSite}
            onChange={e => setSelectedSite(e.target.value)}>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '80px', borderRadius: 'var(--radius)' }} />)}
        </div>
      ) : employees.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '2rem' }}>👷</div>
          <div className="empty-title">No Employees</div>
          <div className="empty-desc">Add your workforce to track attendance and payroll</div>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>Add First Employee</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {employees.map(emp => (
            <div key={emp.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%',
                background: 'var(--accent-muted)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '1rem', color: 'var(--accent)', flexShrink: 0,
              }}>
                {emp.name[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{emp.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
                  {emp.role} · {emp.phone || 'No phone'}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent)', marginTop: '0.1rem' }}>
                  ₹{emp.wage_rate.toLocaleString('en-IN')}/{emp.wage_type === 'daily' ? 'day' : 'month'}
                </div>
              </div>
              <span className="badge badge-gray">{emp.role}</span>
              <button className="btn btn-ghost btn-icon" onClick={() => deactivate(emp.id)}>
                <X size={16} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="btn-fab" onClick={() => setShowForm(true)}><Plus size={24} /></button>

      {showForm && (
        <>
          <div className="sheet-overlay" onClick={() => setShowForm(false)} />
          <div className="sheet">
            <div className="sheet-handle" />
            <div className="sheet-title">Add Employee</div>
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
                  <label className="form-label">Rate (₹)</label>
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
                <button type="button" className="btn btn-secondary w-full" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                  {submitting ? <span className="spinner" /> : 'Add Employee'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
