'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, X, Shield, Pencil, Check } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'

const ROLES = [
  { value: 'admin', label: 'Admin', desc: 'Full access to all sites and data', icon: '🛡️' },
  { value: 'site_manager', label: 'Site Manager', desc: 'Manage trips, cash, attendance for assigned site', icon: '👷' },
  { value: 'stakeholder', label: 'Stakeholder', desc: 'Read-only revenue share dashboard', icon: '📊' },
]

export default function UsersPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const router = useRouter()
  const [userRoleRows, setUserRoleRows] = useState<any[]>([])
  const [authUsers, setAuthUsers] = useState<Record<string, string>>({}) // id → email
  const [sites, setSites] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingRow, setEditingRow] = useState<any | null>(null) // row being edited
  const [form, setForm] = useState({
    email: '', password: '', role: 'site_manager',
    site_id: '', share_percent: '50',
  })
  const [editForm, setEditForm] = useState({ role: '', site_id: '', share_percent: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  const getAuthToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? ''
  }

  const loadData = async () => {
    setLoading(true)
    const token = await getAuthToken()

    const [{ data: rolesData, error: rolesError }, { data: sitesData, error: sitesError }, authRes] = await Promise.all([
      supabase.from('user_roles').select('*, sites(name)').order('created_at').limit(500),
      supabase.from('sites').select('*').eq('active', true).order('name').limit(500),
      fetch('/api/admin/list-users', {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()).catch(() => ({ users: [] })),
    ])

    if (rolesError) alert(`Error loading user roles: ${rolesError.message}`)
    if (sitesError) alert(`Error loading sites: ${sitesError.message}`)

    setSites(sitesData || [])
    setUserRoleRows(rolesData || [])

    // Build id → email map
    const emailMap: Record<string, string> = {}
    for (const u of (authRes.users || [])) emailMap[u.id] = u.email
    setAuthUsers(emailMap)
    setLoading(false)
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
  const userMap: Record<string, any> = {}
  for (const r of userRoleRows) {
    if (!userMap[r.user_id]) {
      userMap[r.user_id] = {
        user_id: r.user_id,
        email: authUsers[r.user_id] || '',
        role: r.role,
        rows: [],
      }
    }
    userMap[r.user_id].rows.push(r)
    // Highest-privilege role wins for display
    const priority = (role: string) => role === 'admin' ? 1 : role === 'site_manager' ? 2 : 3
    if (priority(r.role) < priority(userMap[r.user_id].role)) {
      userMap[r.user_id].role = r.role
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
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create user')
      setShowForm(false)
      setForm({ email: '', password: '', role: 'site_manager', site_id: '', share_percent: '50' })
      loadData()
    } catch (err: any) {
      setError(err.message || 'Failed to create user')
    }
    setSubmitting(false)
  }

  const removeUser = async (userId: string) => {
    if (!confirm("Remove this user's access completely?")) return
    // Delete stakeholder site access first
    await supabase.from('stakeholder_site_access').delete().eq('stakeholder_user_id', userId)
    const { error } = await supabase.from('user_roles').delete().eq('user_id', userId)
    if (error) alert(`Error: ${error.message}`)
    else loadData()
  }

  const revokeRow = async (rowId: string, userId: string, siteId: string | null) => {
    if (!confirm('Revoke this specific role/site access?')) return
    if (siteId) {
      await supabase.from('stakeholder_site_access').delete()
        .eq('stakeholder_user_id', userId).eq('site_id', siteId)
    }
    const { error } = await supabase.from('user_roles').delete().eq('id', rowId)
    if (error) alert(`Error: ${error.message}`)
    else loadData()
  }

  const startEdit = (row: any) => {
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
        role: editForm.role as 'admin' | 'site_manager' | 'stakeholder',
        site_id: editForm.site_id || null,
      })
      .eq('id', editingRow.id)
    if (error) {
      alert(`Error updating role: ${error.message}`)
    } else {
      // If changing to/from stakeholder update site access
      if (editForm.role === 'stakeholder' && editForm.site_id) {
        await supabase.from('stakeholder_site_access').upsert({
          stakeholder_user_id: editingRow.user_id,
          site_id: editForm.site_id,
          share_percent: parseFloat(editForm.share_percent) || 50,
        }, { onConflict: 'stakeholder_user_id,site_id' })
      }
      setEditingRow(null)
      loadData()
    }
    setSubmitting(false)
  }

  const roleIcon = (role: string) => role === 'admin' ? '🛡️' : role === 'site_manager' ? '👷' : '📊'
  const roleBadge = (role: string) => role === 'admin' ? 'badge-amber' : role === 'site_manager' ? 'badge-blue' : 'badge-green'

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
          <Shield size={32} style={{ color: 'var(--text-muted)' }} />
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
                {u.rows.map((row: any) => (
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
                          onClick={() => revokeRow(row.id, u.user_id, row.site_id)} title="Revoke this role">
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
                <input className="form-input" type="password" placeholder="Min 6 characters"
                  value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  required minLength={6} />
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
