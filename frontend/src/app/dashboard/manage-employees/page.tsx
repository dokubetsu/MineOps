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
import { toErrorMessage } from '@/lib/errors'

const ROLES = ['worker', 'supervisor', 'driver', 'other']

export default function EmployeesPage() {
  const { isAdmin, isSiteManager, loading: authLoading } = useAuth()
  const router = useRouter()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [usersList, setUsersList] = useState<Array<{ id: string; email: string }>>([])
  const [usersMap, setUsersMap] = useState<Record<string, string>>({})
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '', phone: '', role: 'worker', site_id: '',
    wage_type: 'daily', wage_rate: '', join_date: format(new Date(), 'yyyy-MM-dd'),
    user_id: '',
  })
  const [submitting, setSubmitting] = useState(false)

  // Admin delete & edit states
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editingEmp, setEditingEmp] = useState<any | null>(null)
  const [showEditForm, setShowEditForm] = useState(false)
  const [editForm, setEditForm] = useState({
    name: '',
    phone: '',
    role: 'worker',
    site_id: '',
    wage_type: 'daily',
    wage_rate: '',
    leave_balance: '15',
    user_id: '',
  })
  const [editSubmitting, setEditSubmitting] = useState(false)

  // ConfirmDialog states
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null)
  const [includeArchived, setIncludeArchived] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin && !isSiteManager) {
      router.push('/dashboard')
      return
    }
    loadData()
  }, [authLoading, isAdmin, isSiteManager])

  useEffect(() => { if (selectedSite) loadEmployees() }, [selectedSite, includeArchived])

  const loadData = async () => {
    try {
      const { data: sitesData } = await supabase.from('sites').select('*').eq('active', true).order('name')
      const loadedSites = sitesData || []
      setSites(loadedSites)
      if (loadedSites.length > 0) {
        setSelectedSite(loadedSites[0].id)
        setForm(f => ({ ...f, site_id: loadedSites[0].id }))
      }

      // Load users to link accounts
      const { data: { session } } = await supabase.auth.getSession()
      let token = session?.access_token
      if (!token) {
        const { data: { session: refreshed } } = await supabase.auth.refreshSession()
        token = refreshed?.access_token
      }
      if (token) {
        const res = await fetch('/api/admin/list-users', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          const json = await res.json()
          setUsersList(json.users || [])
          const mapping: Record<string, string> = {}
          for (const u of (json.users || [])) {
            mapping[u.id] = u.email
          }
          setUsersMap(mapping)
        }
      }
    } catch (err: unknown) {
      toast.error(`Error loading sites: ${toErrorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const loadEmployees = async () => {
    setLoading(true)
    try {
      let query = supabase
        .from('employees')
        .select('*')
        .eq('site_id', selectedSite)
        .order('name')
        .limit(500)

      if (!includeArchived) {
        query = query.eq('active', true)
      }

      const { data, error } = await query

      if (error) throw error
      setEmployees(data || [])
    } catch (err: unknown) {
      toast.error(`Error loading roster: ${toErrorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    const rate = parseFloat(form.wage_rate)
    if (isNaN(rate) || rate <= 0) {
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
        user_id: form.user_id || null,
      })

      if (error) throw error
      toast.success('Employee registered successfully')
      setShowForm(false)
      const newSiteId = form.site_id
      setForm({
        name: '', phone: '', role: 'worker', site_id: newSiteId,
        wage_type: 'daily', wage_rate: '', join_date: format(new Date(), 'yyyy-MM-dd'),
        user_id: '',
      })
      if (newSiteId !== selectedSite) {
        setSelectedSite(newSiteId) // This will trigger loadEmployees via useEffect
      } else {
        loadEmployees()
      }
    } catch (err: unknown) {
      toast.error(`Registration failed: ${toErrorMessage(err)}`)
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
    } catch (err: unknown) {
      toast.error(`Archive failed: ${toErrorMessage(err)}`)
    } finally {
      setConfirmDeactivateId(null)
    }
  }

  const executeReactivate = async (id: string) => {
    try {
      const { error } = await supabase
        .from('employees')
        .update({ active: true })
        .eq('id', id)

      if (error) throw error
      toast.success('Employee record reactivated')
      loadEmployees()
    } catch (err: unknown) {
      toast.error(`Reactivation failed: ${toErrorMessage(err)}`)
    }
  }

  const executePermanentDelete = async () => {
    if (!confirmDeleteId) return
    try {
      const { error } = await supabase
        .from('employees')
        .delete()
        .eq('id', confirmDeleteId)

      if (error) throw error
      toast.success('Employee permanently deleted')
      loadEmployees()
    } catch (err: unknown) {
      toast.error(`Deletion failed: ${toErrorMessage(err)}`)
    } finally {
      setConfirmDeleteId(null)
    }
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingEmp) return
    const rate = parseFloat(editForm.wage_rate)
    const leaves = parseInt(editForm.leave_balance)
    if (isNaN(rate) || rate <= 0) {
      toast.error('Please enter a valid wage rate')
      return
    }
    if (isNaN(leaves) || leaves < 0) {
      toast.error('Please enter a valid leave balance')
      return
    }
    setEditSubmitting(true)
    try {
      const { error } = await supabase
        .from('employees')
        .update({
          name: editForm.name,
          phone: editForm.phone || null,
          role: editForm.role,
          site_id: editForm.site_id || null,
          wage_type: editForm.wage_type as 'daily' | 'monthly',
          wage_rate: rate,
          leave_balance: leaves,
          user_id: editForm.user_id || null,
        })
         .eq('id', editingEmp.id)

      if (error) throw error
      toast.success('Employee record updated')
      setShowEditForm(false)
      setEditingEmp(null)
      loadEmployees()
    } catch (err: unknown) {
      toast.error(`Update failed: ${toErrorMessage(err)}`)
    } finally {
      setEditSubmitting(false)
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
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {sites.length > 1 && (
              <select className="form-input form-select" style={{ width: '100%', minWidth: '160px' }}
                value={selectedSite} onChange={e => { setSelectedSite(e.target.value); setForm(f => ({ ...f, site_id: e.target.value })) }}>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input 
              type="checkbox" 
              checked={includeArchived} 
              onChange={e => setIncludeArchived(e.target.checked)} 
              style={{ cursor: 'pointer' }}
            />
            Show Archived
          </label>
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
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.125rem' }}>
                  Leave Balance: <strong>{emp.leave_balance ?? 15}</strong> days
                </div>
                {emp.user_id && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '0.125rem' }}>
                    Linked login: <strong>{usersMap[emp.user_id] || 'Loading...'}</strong>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="badge badge-gray">{emp.role}</span>
                {isAdmin && (
                  <>
                    <button 
                      className="btn btn-ghost btn-icon btn-sm" 
                      onClick={() => {
                        setEditingEmp(emp)
                        setEditForm({
                          name: emp.name,
                          phone: emp.phone || '',
                          role: emp.role,
                          site_id: emp.site_id || '',
                          wage_type: emp.wage_type,
                          wage_rate: String(emp.wage_rate),
                          leave_balance: String(emp.leave_balance ?? 15),
                          user_id: emp.user_id || '',
                        })
                        setShowEditForm(true)
                      }} 
                      title="Edit Employee"
                      style={{ minHeight: 'unset', padding: '0.25rem' }}
                    >
                      ✏️
                    </button>
                    <button 
                      className="btn btn-ghost btn-icon btn-sm" 
                      onClick={() => setConfirmDeleteId(emp.id)} 
                      title="Permanently Delete Employee"
                      style={{ minHeight: 'unset', padding: '0.25rem' }}
                    >
                      🗑️
                    </button>
                  </>
                )}
                {emp.active ? (
                  <button className="btn btn-ghost btn-icon" onClick={() => setConfirmDeactivateId(emp.id)} title="Archive Employee">
                    <X size={16} style={{ color: 'var(--text-muted)' }} />
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => executeReactivate(emp.id)} style={{ color: 'var(--success)', border: '1px solid var(--success)', padding: '0.125rem 0.5rem', minHeight: 'unset' }}>
                    Reactivate
                  </button>
                )}
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
          <div className="form-group">
            <label className="form-label">Link User Account (Optional)</label>
            <select className="form-input form-select" value={form.user_id}
              onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}>
              <option value="">Unlinked / Select Account</option>
              {usersList.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
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

      {/* ConfirmDialog for permanent deletion */}
      <ConfirmDialog 
        isOpen={confirmDeleteId !== null}
        title="Permanently Delete Employee"
        message="Are you sure you want to PERMANENTLY delete this employee? All related attendance, leave, and payroll data will be deleted."
        onConfirm={executePermanentDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {/* Edit Employee / Leave Balance BottomSheet */}
      <BottomSheet isOpen={showEditForm} onClose={() => setShowEditForm(false)} title="Edit Employee">
        <form onSubmit={handleEditSubmit}>
          <div className="form-group">
            <label className="form-label">Full Name *</label>
            <input className="form-input" placeholder="Employee name" value={editForm.name}
              onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">Phone</label>
            <input className="form-input" type="tel" placeholder="Phone number" value={editForm.phone}
              onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Role</label>
              <select className="form-input form-select" value={editForm.role}
                onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Site</label>
              <select className="form-input form-select" value={editForm.site_id}
                onChange={e => setEditForm(f => ({ ...f, site_id: e.target.value }))}>
                <option value="">Unassigned</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Wage Type</label>
              <select className="form-input form-select" value={editForm.wage_type}
                onChange={e => setEditForm(f => ({ ...f, wage_type: e.target.value }))}>
                <option value="daily">Daily</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Rate (₹) *</label>
              <input className="form-input" type="number" placeholder="500" value={editForm.wage_rate}
                onChange={e => setEditForm(f => ({ ...f, wage_rate: e.target.value }))} required />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Leave Balance (Entitled Days) *</label>
            <input className="form-input" type="number" placeholder="15" value={editForm.leave_balance}
              onChange={e => setEditForm(f => ({ ...f, leave_balance: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label className="form-label">Link User Account (Optional)</label>
            <select className="form-input form-select" value={editForm.user_id}
              onChange={e => setEditForm(f => ({ ...f, user_id: e.target.value }))}>
              <option value="">Unlinked / Select Account</option>
              {usersList.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary w-full" onClick={() => setShowEditForm(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary w-full" disabled={editSubmitting}>
              {editSubmitting ? <span className="spinner" /> : 'Save Changes'}
            </button>
          </div>
        </form>
      </BottomSheet>
    </div>
  )
}
