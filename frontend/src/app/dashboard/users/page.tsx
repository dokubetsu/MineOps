'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, X, Pencil, Check } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site, UserRole } from '@/lib/supabase/types'
import toast from 'react-hot-toast'

const ROLES = [
  { value: 'admin', label: 'Admin', desc: 'Full access to all sites and data', icon: '🛡️' },
  { value: 'site_manager', label: 'Site Manager', desc: 'Manage trips, cash, attendance for assigned site', icon: '👷' },
  { value: 'stakeholder', label: 'Stakeholder', desc: 'Read-only revenue share dashboard', icon: '📊' },
  { value: 'site_employee', label: 'Site Employee', desc: 'Log trips, expenses, and track attendance', icon: '🚛' },
] as const

interface ExtendedUserRole extends UserRole {
  sites?: {
    name: string
  } | null
}

interface GroupedUser {
  user_id: string
  email: string
  role: 'admin' | 'site_manager' | 'stakeholder' | 'employee' | 'site_employee'
  rows: ExtendedUserRole[]
}

interface ListUsersResponse {
  users: Array<{ id: string; email: string }>
}

export default function UsersPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const router = useRouter()
  const [userRoleRows, setUserRoleRows] = useState<ExtendedUserRole[]>([])
  const [authUsers, setAuthUsers] = useState<Record<string, string>>({}) // id → email
  const [sites, setSites] = useState<Site[]>([])
  const [employees, setEmployees] = useState<
    Array<{ id: string; name: string; site_id: string | null; phone: string | null }>
  >([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingRow, setEditingRow] = useState<ExtendedUserRole | null>(null) // row being edited
  const [form, setForm] = useState({
    email: '', password: '', role: 'site_manager',
    site_id: '', share_percent: '50',
    employee_link_mode: 'create', // 'link' | 'create'
    employee_id: '',
    employee_name: '',
    employee_phone: '',
    employee_wage_type: 'monthly',
    employee_wage_rate: '0',
  })
  const [editForm, setEditForm] = useState({ role: '', site_id: '', share_percent: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  const getAuthToken = async () => {
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error || !session) {
      const { data: { session: refreshedSession }, error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError || !refreshedSession) {
        throw new Error('Authentication session expired. Please log in again.')
      }
      return refreshedSession.access_token
    }
    return session.access_token
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const token = await getAuthToken()

      const [{ data: rolesData, error: rolesError }, { data: sitesData, error: sitesError }, { data: employeesData, error: employeesError }] = await Promise.all([
        supabase.from('user_roles').select('*, sites(name)').order('created_at').limit(500),
        supabase.from('sites').select('*').eq('active', true).order('name').limit(500),
        supabase.from('employees').select('id, name, site_id, phone').eq('active', true).is('user_id', null).limit(1000)
      ])

      if (rolesError) throw new Error(`User roles: ${rolesError.message}`)
      if (sitesError) throw new Error(`Sites: ${sitesError.message}`)
      if (employeesError) throw new Error(`Employees: ${employeesError.message}`)

      setSites(sitesData || [])
      setEmployees(employeesData || [])
      setUserRoleRows((rolesData as ExtendedUserRole[]) || [])

      const res = await fetch('/api/admin/list-users', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(`Admin API: ${json.error || 'Failed to list auth users'}`)
      }

      // Build id → email map
      const emailMap: Record<string, string> = {}
      for (const u of (json.users || [])) {
        emailMap[u.id] = u.email
      }
      setAuthUsers(emailMap)
    } catch (err: any) {
      toast.error(`Error loading users data: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin) {
      router.push('/dashboard')
      return
    }
    loadData()
  }, [authLoading, isAdmin])

  // Group role rows by user_id for display
  const userMap: Record<string, GroupedUser> = {}
  for (const r of userRoleRows) {
    if (!userMap[r.user_id]) {
      userMap[r.user_id] = {
        user_id: r.user_id,
        email: authUsers[r.user_id] || 'unregistered@mineops.com',
        role: r.role as 'admin' | 'site_manager' | 'stakeholder' | 'employee' | 'site_employee',
        rows: [],
      }
    }
    userMap[r.user_id].rows.push(r)
    // Highest-privilege role wins for display
    const priority = (role: string) => role === 'admin' ? 1 : role === 'site_manager' ? 2 : (role === 'employee' || role === 'site_employee') ? 3 : 4
    if (priority(r.role) < priority(userMap[r.user_id].role)) {
      userMap[r.user_id].role = r.role as any
    }
  }
  const users = Object.values(userMap)

  const inviteUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const token = await getAuthToken()
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          role: form.role,
          site_id: form.site_id || null,
          share_percent: form.share_percent,
          employee_link_mode: (form.role === 'site_employee' || form.role === 'employee') ? form.employee_link_mode : 'none',
          employee_id: form.employee_id || null,
          employee_name: form.employee_name || null,
          employee_phone: form.employee_phone || null,
          employee_wage_type: form.employee_wage_type || null,
          employee_wage_rate: form.employee_wage_rate || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create user')
      toast.success('User created successfully')
      setShowForm(false)
      setForm({
        email: '', password: '', role: 'site_manager', site_id: '', share_percent: '50',
        employee_link_mode: 'create', employee_id: '', employee_name: '', employee_phone: '',
        employee_wage_type: 'monthly', employee_wage_rate: '0'
      })
      loadData()
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to create user'
      setError(errMsg)
    }
    setSubmitting(false)
  }

  const removeUser = async (userId: string) => {
    if (!confirm("Remove this user's access completely?")) return
    // Delete stakeholder site access first
    await supabase.from('stakeholder_site_access').delete().eq('stakeholder_user_id', userId)
    const { error } = await supabase.from('user_roles').delete().eq('user_id', userId)
    if (error) {
      toast.error(`Error: ${error.message}`)
    } else {
      toast.success('User access revoked')
      loadData()
    }
  }

  const revokeRow = async (rowId: string, userId: string, role: string, siteId: string | null) => {
    if (!confirm('Revoke this specific role/site access?')) return
    if (role === 'stakeholder' && siteId) {
      await supabase.from('stakeholder_site_access').delete()
        .eq('stakeholder_user_id', userId).eq('site_id', siteId)
    }
    const { error } = await supabase.from('user_roles').delete().eq('id', rowId)
    if (error) {
      toast.error(`Error: ${error.message}`)
    } else {
      toast.success('Role revoked successfully')
      loadData()
    }
  }

  const startEdit = (row: ExtendedUserRole) => {
    setEditingRow(row)
    setEditForm({
      role: row.role,
      site_id: row.site_id || '',
      share_percent: '50',
    })
  }

  const saveEdit = async () => {
    if (!editingRow) return
    setSubmitting(true)
    const { error } = await supabase
      .from('user_roles')
      .update({
        role: editForm.role as 'admin' | 'site_manager' | 'stakeholder' | 'employee' | 'site_employee',
        site_id: editForm.role === 'admin' ? null : (editForm.site_id || null),
      })
      .eq('id', editingRow.id)
    if (error) {
      toast.error(`Error updating role: ${error.message}`)
    } else {
      // If this row was a stakeholder grant on a site, and it's no longer a
      // stakeholder grant on that same site (role changed, or site changed),
      // remove the now-stale stakeholder_site_access row first.
      const wasStakeholderSite = editingRow.role === 'stakeholder' && editingRow.site_id
      const stillSameStakeholderSite = editForm.role === 'stakeholder' && editForm.site_id === editingRow.site_id
      if (wasStakeholderSite && !stillSameStakeholderSite) {
        await supabase.from('stakeholder_site_access').delete()
          .eq('stakeholder_user_id', editingRow.user_id).eq('site_id', editingRow.site_id as string)
      }
      // If changing to/from stakeholder update site access
      if (editForm.role === 'stakeholder' && editForm.site_id) {
        await supabase.from('stakeholder_site_access').upsert({
          stakeholder_user_id: editingRow.user_id,
          site_id: editForm.site_id,
          share_percent: parseFloat(editForm.share_percent) || 50,
        }, { onConflict: 'stakeholder_user_id,site_id' })
      }
      toast.success('Role updated successfully')
      setEditingRow(null)
      loadData()
    }
    setSubmitting(false)
  }

  const roleIcon = (role: string) => role === 'admin' ? '🛡️' : role === 'site_manager' ? '👷' : (role === 'employee' || role === 'site_employee') ? '🚛' : '📊'
  const roleBadge = (role: string) => role === 'admin' ? 'badge-amber' : role === 'site_manager' ? 'badge-blue' : (role === 'employee' || role === 'site_employee') ? 'badge-purple' : 'badge-green'

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">User Access</h1>
          <p className="page-subtitle">Roles & Permissions</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={18} /> Add User
        </button>
      </div>

      {/* Role legend */}
      <div style={{ display: 'grid', gap: '0.625rem', marginBottom: '1.25rem' }} className="grid-3">
        {ROLES.map(r => (
          <div key={r.value} className="card" style={{ padding: '0.875rem' }}>
            <div style={{ fontSize: '1.25rem', marginBottom: '0.375rem' }}>{r.icon}</div>
            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{r.label}</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem', lineHeight: 1.4 }}>{r.desc}</div>
          </div>
        ))}
      </div>

      {/* Users list */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: '80px', borderRadius: 'var(--radius)' }} />)}
        </div>
      ) : users.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Plus size={28} /></div>
          <div className="empty-title">No users configured</div>
          <div className="empty-desc">Add users to grant them access to MineOps</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {users.map(u => (
            <div key={u.user_id} className="card" style={{ padding: '1rem' }}>
              {/* User header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', marginBottom: u.rows.length > 0 ? '0.75rem' : 0 }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  background: 'var(--bg-elevated)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.1rem', flexShrink: 0,
                }}>
                  {roleIcon(u.role)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email || <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-display)', fontSize: '0.75rem' }}>ID: {u.user_id.substring(0, 12)}…</span>}
                  </div>
                  <span className={`badge ${roleBadge(u.role)}`} style={{ marginTop: '0.2rem', display: 'inline-block' }}>
                    {u.role.replace('_', ' ')}
                  </span>
                </div>
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={() => removeUser(u.user_id)}
                  title="Remove all access"
                  style={{ color: 'var(--danger)', flexShrink: 0 }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Role rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                {u.rows.map((row) => (
                  <div key={row.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.5rem 0.625rem',
                    background: 'var(--bg-elevated)', borderRadius: '6px',
                    border: '1px solid var(--border)',
                  }}>
                    {editingRow?.id === row.id ? (
                      // ── Edit mode ──
                      <>
                        <select className="form-input form-select" style={{ flex: 1, fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                          value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
                          {ROLES.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
                        </select>
                        {editForm.role !== 'admin' && (
                          <select className="form-input form-select" style={{ flex: 1, fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                            value={editForm.site_id} onChange={e => setEditForm(f => ({ ...f, site_id: e.target.value }))}>
                            <option value="">No site</option>
                            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        )}
                        {editForm.role === 'stakeholder' && editForm.site_id && (
                          <input type="number" className="form-input" style={{ width: '80px', fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                            placeholder="Share %" min="0" max="100" value={editForm.share_percent}
                            onChange={e => setEditForm(f => ({ ...f, share_percent: e.target.value }))} />
                        )}
                        <button className="btn btn-success btn-sm btn-icon" onClick={saveEdit} disabled={submitting} title="Save">
                          <Check size={14} />
                        </button>
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setEditingRow(null)} title="Cancel">
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      // ── View mode ──
                      <>
                        <span style={{ fontSize: '0.8rem', flex: 1, color: 'var(--text-secondary)' }}>
                          <span className={`badge ${roleBadge(row.role)}`} style={{ marginRight: '0.4rem' }}>
                            {row.role.replace('_', ' ')}
                          </span>
                          {row.site_id ? (
                            <span style={{ color: 'var(--text-muted)' }}>@ {row.sites?.name || row.site_id.substring(0, 8)}</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>All sites</span>
                          )}
                        </span>
                        <button className="btn btn-ghost btn-icon" style={{ padding: '0.2rem' }}
                          onClick={() => startEdit(row)} title="Edit this role">
                          <Pencil size={13} style={{ color: 'var(--text-muted)' }} />
                        </button>
                        <button className="btn btn-ghost btn-icon" style={{ padding: '0.2rem' }}
                          onClick={() => revokeRow(row.id, u.user_id, row.role, row.site_id)} title="Revoke this role">
                          <X size={13} style={{ color: 'var(--danger)' }} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="btn-fab" onClick={() => setShowForm(true)}><Plus size={24} /></button>

      {/* Add User Sheet */}
      {showForm && (
        <>
          <div className="sheet-overlay" onClick={() => setShowForm(false)} />
          <div className="sheet">
            <div className="sheet-handle" />
            <div className="sheet-title">Add User</div>
            <form onSubmit={inviteUser}>
              <div className="form-group">
                <label className="form-label">Email *</label>
                <input className="form-input" type="email" placeholder="user@example.com"
                  value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Password *</label>
                <input className="form-input" type="password" placeholder="Min 10 chars, letter + number"
                  value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required minLength={10} />
              </div>
              <div className="form-group">
                <label className="form-label">Role *</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {ROLES.map(r => (
                    <label key={r.value} style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.75rem', borderRadius: 'var(--radius)',
                      border: `1.5px solid ${form.role === r.value ? 'var(--accent)' : 'var(--border)'}`,
                      background: form.role === r.value ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}>
                      <input type="radio" name="role" value={r.value} checked={form.role === r.value}
                        onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                        style={{ display: 'none' }} />
                      <span style={{ fontSize: '1.25rem' }}>{r.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{r.label}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {form.role !== 'admin' && (
                <div className="form-group">
                  <label className="form-label">Assign Site *</label>
                  <select className="form-input form-select" value={form.site_id}
                    onChange={e => setForm(f => ({ ...f, site_id: e.target.value }))} required>
                    <option value="">Select site</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}

              {(form.role === 'site_employee' || form.role === 'employee') && form.site_id && (
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem', fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>Employee Profile Assignment</div>
                  
                  <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input type="radio" checked={form.employee_link_mode === 'create'} onChange={() => setForm(f => ({ ...f, employee_link_mode: 'create' }))} />
                      Create New Profile
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <input type="radio" checked={form.employee_link_mode === 'link'} onChange={() => setForm(f => ({ ...f, employee_link_mode: 'link' }))} />
                      Link Existing Profile
                    </label>
                  </div>

                  {form.employee_link_mode === 'link' ? (
                    <div className="form-group">
                      <label className="form-label">Select Employee Profile *</label>
                      <select className="form-input form-select" value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} required>
                        <option value="">Choose employee...</option>
                        {employees.filter(emp => emp.site_id === form.site_id).map(emp => (
                          <option key={emp.id} value={emp.id}>{emp.name} ({emp.phone || 'No phone'})</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <>
                      <div className="form-group">
                        <label className="form-label">Employee Name *</label>
                        <input className="form-input" type="text" placeholder="Full Name" value={form.employee_name} onChange={e => setForm(f => ({ ...f, employee_name: e.target.value }))} required />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Employee Phone</label>
                        <input className="form-input" type="text" placeholder="Phone Number" value={form.employee_phone} onChange={e => setForm(f => ({ ...f, employee_phone: e.target.value }))} />
                      </div>
                      <div style={{ display: 'flex', gap: '1rem' }}>
                        <div className="form-group" style={{ flex: 1 }}>
                          <label className="form-label">Wage Type</label>
                          <select className="form-input form-select" value={form.employee_wage_type} onChange={e => setForm(f => ({ ...f, employee_wage_type: e.target.value }))}>
                            <option value="daily">Daily</option>
                            <option value="monthly">Monthly</option>
                          </select>
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                          <label className="form-label">Wage Rate (₹)</label>
                          <input className="form-input" type="number" value={form.employee_wage_rate} onChange={e => setForm(f => ({ ...f, employee_wage_rate: e.target.value }))} />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              {form.role === 'stakeholder' && form.site_id && (
                <div className="form-group">
                  <label className="form-label">Revenue Share %</label>
                  <input className="form-input" type="number" min="0" max="100" step="0.5"
                    value={form.share_percent} onChange={e => setForm(f => ({ ...f, share_percent: e.target.value }))} />
                </div>
              )}
              {error && (
                <div style={{ background: 'var(--danger-muted)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius)', padding: '0.75rem', fontSize: '0.875rem', color: 'var(--danger)', marginBottom: '1rem' }}>
                  ⚠️ {error}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary w-full" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                  {submitting ? <span className="spinner" /> : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
