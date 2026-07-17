'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FEATURE_CATALOG, FEATURE_KEYS, type FeatureKey } from '@/lib/features'
import { ArrowLeft, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'

export default function PlatformOrgDetailPage() {
  const params = useParams()
  const orgId = params.orgId as string
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [org, setOrg] = useState<{ id: string; name: string; active: boolean } | null>(null)
  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(
    () => Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Record<FeatureKey, boolean>
  )
  const [admins, setAdmins] = useState<Array<{ user_id: string; email: string; created_at: string | null }>>([])
  const [savingFeatures, setSavingFeatures] = useState(false)
  const [showAddAdmin, setShowAddAdmin] = useState(false)
  const [adminForm, setAdminForm] = useState({ email: '', password: '' })
  const [addingAdmin, setAddingAdmin] = useState(false)

  const getToken = async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not signed in')
      const res = await fetch(`/api/platform/orgs/${orgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setOrg(json.organization)
      setFeatures(json.features)
      setAdmins(json.admins || [])
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Load failed')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  const saveFeatures = async () => {
    setSavingFeatures(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not signed in')
      const res = await fetch(`/api/platform/orgs/${orgId}/features`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ features }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      setFeatures(json.features)
      toast.success('Features updated')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingFeatures(false)
    }
  }

  const toggleActive = async () => {
    if (!org) return
    try {
      const token = await getToken()
      if (!token) throw new Error('Not signed in')
      const res = await fetch(`/api/platform/orgs/${orgId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ active: !org.active }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Update failed')
      setOrg(json.organization)
      toast.success(json.organization.active ? 'Organization activated' : 'Organization deactivated')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const addAdmin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddingAdmin(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not signed in')
      const res = await fetch(`/api/platform/orgs/${orgId}/admins`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(adminForm),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create admin')
      toast.success('Admin created — share credentials securely')
      setShowAddAdmin(false)
      setAdminForm({ email: '', password: '' })
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setAddingAdmin(false)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!org) {
    return (
      <div>
        <Link href="/platform" className="btn btn-secondary mb-4">
          <ArrowLeft size={16} /> Back
        </Link>
        <div className="empty-title">Organization not found</div>
      </div>
    )
  }

  return (
    <div>
      <Link href="/platform" className="btn btn-secondary mb-4" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <ArrowLeft size={16} /> All organizations
      </Link>

      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="page-title">{org.name}</h1>
          <p className="page-subtitle">Platform management for this tenant</p>
        </div>
        <button type="button" className={`btn ${org.active ? 'btn-danger' : 'btn-primary'}`} onClick={toggleActive}>
          {org.active ? 'Deactivate org' : 'Activate org'}
        </button>
      </div>

      {/* Admins */}
      <div className="card mb-4" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Tenant admins</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddAdmin((v) => !v)}>
            <UserPlus size={14} /> Add admin
          </button>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          You set email + temporary password here. Share out of band; they manage site managers and employees inside the tenant.
        </p>
        {showAddAdmin && (
          <form onSubmit={addAdmin} className="card" style={{ padding: '1rem', marginBottom: '1rem', background: 'var(--bg-elevated)' }}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                required
                value={adminForm.email}
                onChange={(e) => setAdminForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Temporary password</label>
              <input
                className="form-input"
                type="password"
                required
                minLength={10}
                value={adminForm.password}
                onChange={(e) => setAdminForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="Min 10 chars, letter + number"
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={addingAdmin}>
              {addingAdmin ? 'Creating…' : 'Create admin'}
            </button>
          </form>
        )}
        {admins.length === 0 ? (
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No admins found</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {admins.map((a) => (
              <li
                key={a.user_id}
                style={{
                  padding: '0.625rem 0',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: '0.875rem',
                }}
              >
                <strong>{a.email || a.user_id}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                  admin
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Features */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>Modules</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Enable or disable product areas for this organization only.
        </p>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {FEATURE_CATALOG.map((f) => (
            <label
              key={f.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'var(--bg-elevated)',
                cursor: 'pointer',
              }}
            >
              <span>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{f.label}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{f.description}</div>
              </span>
              <input
                type="checkbox"
                checked={!!features[f.key]}
                onChange={(e) => setFeatures((prev) => ({ ...prev, [f.key]: e.target.checked }))}
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary mt-4"
          style={{ marginTop: '1rem' }}
          onClick={saveFeatures}
          disabled={savingFeatures}
        >
          {savingFeatures ? 'Saving…' : 'Save feature flags'}
        </button>
      </div>
    </div>
  )
}
