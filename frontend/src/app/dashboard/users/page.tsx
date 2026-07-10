'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, X, Shield, User, Eye } from 'lucide-react'

const ROLES = [
  { value: 'admin', label: 'Admin', desc: 'Full access to all sites and data', icon: '🛡️' },
  { value: 'site_manager', label: 'Site Manager', desc: 'Manage trips, cash, attendance for assigned site', icon: '👷' },
  { value: 'stakeholder', label: 'Stakeholder', desc: 'Read-only revenue share dashboard', icon: '📊' },
]

import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'

export default function UsersPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<any[]>([])
  const [sites, setSites] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    email: '', password: '', role: 'site_manager',
    site_id: '', share_percent: '50',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin) {
      router.push('/dashboard')
      return
    }
    loadData()
  }, [authLoading, isAdmin])

  const loadData = async () => {
    setLoading(true)
    const [{ data: rolesData, error: rolesError }, { data: sitesData, error: sitesError }] = await Promise.all([
      supabase.from('user_roles').select('*, sites(name)').limit(500),
      supabase.from('sites').select('*').eq('active', true).order('name').limit(500),
    ])

    if (rolesError) alert(`Error loading user roles: ${rolesError.message}`)
    if (sitesError) alert(`Error loading sites list: ${sitesError.message}`)

    setSites(sitesData || [])

    // Group by user_id
    const userMap: Record<string, any> = {}
    for (const r of (rolesData || [])) {
      if (!userMap[r.user_id]) {
        userMap[r.user_id] = { 
          user_id: r.user_id, 
          role: r.role, 
          sites: [],
          blanket_role_row_id: r.site_id ? null : r.id
        }
      }
      if (r.site_id) {
        userMap[r.user_id].sites.push({ 
          id: r.site_id, 
          name: r.sites?.name,
          role_row_id: r.id
        })
      } else {
        userMap[r.user_id].blanket_role_row_id = r.id
      }
    }
    setUsers(Object.values(userMap))
    setLoading(false)
  }

  const inviteUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      // Use the server-side admin route — never expose service role key to the client
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
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

  const removeRole = async (userId: string) => {
    if (!confirm("Remove this user's access completely?")) return

    // Delete stakeholder site access first
    const { error: stakeholderError } = await supabase
      .from('stakeholder_site_access')
      .delete()
      .eq('stakeholder_user_id', userId)

    if (stakeholderError) {
      alert(`Error removing stakeholder access: ${stakeholderError.message}`)
      return
    }

    // Delete user roles next (will trigger last admin check on DB)
    const { error: roleError } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)

    if (roleError) {
      alert(`Error removing user roles: ${roleError.message}`)
    } else {
      loadData()
    }
  }

  const revokeSpecificAccess = async (roleRowId: string, userId: string, siteId: string) => {
    if (!confirm('Revoke access for this specific site/role?')) return

    // If stakeholder, delete their specific site access
    const { error: stakeholderError } = await supabase
      .from('stakeholder_site_access')
      .delete()
      .eq('stakeholder_user_id', userId)
      .eq('site_id', siteId)

    if (stakeholderError) {
      alert(`Error revoking stakeholder site access: ${stakeholderError.message}`)
      return
    }

    // Delete the specific user role row
    const { error: roleError } = await supabase
      .from('user_roles')
      .delete()
      .eq('id', roleRowId)

    if (roleError) {
      alert(`Error revoking specific role: ${roleError.message}`)
    } else {
      loadData()
    }
  }

  const revokeBlanketAccess = async (roleRowId: string, userId: string) => {
    if (!confirm('Revoke this blanket role?')) return

    // Delete all stakeholder site access
    const { error: stakeholderError } = await supabase
      .from('stakeholder_site_access')
      .delete()
      .eq('stakeholder_user_id', userId)

    if (stakeholderError) {
      alert(`Error revoking stakeholder access: ${stakeholderError.message}`)
      return
    }

    // Delete the blanket user role row
    const { error: roleError } = await supabase
      .from('user_roles')
      .delete()
      .eq('id', roleRowId)

    if (roleError) {
      alert(`Error revoking blanket role: ${roleError.message}`)
    } else {
      loadData()
    }
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {users.map(u => (
            <div key={u.user_id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%',
                background: 'var(--bg-elevated)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.25rem', flexShrink: 0,
              }}>
                {roleIcon(u.role)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                  ID: {u.user_id.substring(0, 8)}...
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className={`badge ${roleBadge(u.role)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                    {u.role.replace('_', ' ')}
                    {u.blanket_role_row_id && (
                      <button 
                        style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', marginLeft: '0.25rem' }}
                        onClick={() => revokeBlanketAccess(u.blanket_role_row_id, u.user_id)}
                        title="Revoke blanket access"
                      >
                        <X size={12} style={{ color: 'var(--danger)' }} />
                      </button>
                    )}
                  </span>
                  {u.sites.map((s: any) => (
                    <span key={s.id} className="badge badge-gray" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      {s.name}
                      <button 
                        style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onClick={() => revokeSpecificAccess(s.role_row_id, u.user_id, s.id)}
                        title={`Revoke access for ${s.name}`}
                      >
                        <X size={12} style={{ color: 'var(--danger)' }} />
                      </button>
                    </span>
                  ))}
                  {u.sites.length === 0 && u.role === 'admin' && !u.blanket_role_row_id && (
                    <span className="badge badge-amber">All Sites</span>
                  )}
                </div>
              </div>
              <button 
                className="btn btn-ghost btn-icon" 
                onClick={() => removeRole(u.user_id)}
                title="Remove all access for this user"
              >
                <X size={16} style={{ color: 'var(--text-muted)' }} />
              </button>
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
