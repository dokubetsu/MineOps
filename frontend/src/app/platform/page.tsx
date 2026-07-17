'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { FEATURE_CATALOG, FEATURE_KEYS, type FeatureKey } from '@/lib/features'
import { Plus, Building2, ToggleLeft } from 'lucide-react'
import toast from 'react-hot-toast'

interface OrgRow {
  id: string
  name: string
  active: boolean
  created_at: string | null
  admin_count: number
  features_enabled: number
  features_total: number
  features: Record<string, boolean>
}

export default function PlatformOrgsPage() {
  const supabase = createClient()
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    companyName: '',
    adminEmail: '',
    adminPassword: '',
  })
  const [featureDraft, setFeatureDraft] = useState<Record<FeatureKey, boolean>>(() =>
    Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Record<FeatureKey, boolean>
  )

  const getToken = async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token
  }

  const loadOrgs = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not signed in')
      const res = await fetch('/api/platform/orgs', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load organizations')
      setOrgs(json.organizations || [])
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load orgs')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void loadOrgs()
  }, [loadOrgs])

  const createOrg = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not signed in')
      const res = await fetch('/api/platform/orgs', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          companyName: form.companyName,
          adminEmail: form.adminEmail,
          adminPassword: form.adminPassword,
          features: featureDraft,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Create failed')
      toast.success('Organization and admin created')
      setShowCreate(false)
      setForm({ companyName: '', adminEmail: '', adminPassword: '' })
      setFeatureDraft(
        Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as Record<FeatureKey, boolean>
      )
      await loadOrgs()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">Organizations</h1>
          <p className="page-subtitle">
            Create mining companies, set their first admin password, and control modules
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setShowCreate((v) => !v)}>
          <Plus size={16} /> New organization
        </button>
      </div>

      {showCreate && (
        <div className="card mb-4" style={{ padding: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
            Provision organization + first admin
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            You set the admin email and temporary password. Share credentials out of band;
            the org admin can change the password after login (Supabase password recovery or you reset it).
          </p>
          <form onSubmit={createOrg}>
            <div className="form-group">
              <label className="form-label">Company name</label>
              <input
                className="form-input"
                required
                minLength={2}
                value={form.companyName}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                placeholder="e.g. Madha Mines"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Admin email</label>
              <input
                className="form-input"
                type="email"
                required
                value={form.adminEmail}
                onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))}
                placeholder="admin@madha.com"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Temporary admin password</label>
              <input
                className="form-input"
                type="password"
                required
                minLength={10}
                value={form.adminPassword}
                onChange={(e) => setForm((f) => ({ ...f, adminPassword: e.target.value }))}
                placeholder="Min 10 chars, letter + number"
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div className="form-label" style={{ marginBottom: '0.5rem' }}>Modules enabled</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.5rem' }}>
                {FEATURE_CATALOG.map((f) => (
                  <label
                    key={f.key}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                      padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                      fontSize: '0.8rem', cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={featureDraft[f.key]}
                      onChange={(e) =>
                        setFeatureDraft((d) => ({ ...d, [f.key]: e.target.checked }))
                      }
                    />
                    <span>
                      <strong>{f.label}</strong>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{f.description}</div>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create organization'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
          <div className="spinner" />
        </div>
      ) : orgs.length === 0 ? (
        <div className="empty-state card">
          <Building2 size={32} style={{ opacity: 0.5 }} />
          <div className="empty-title">No organizations yet</div>
          <div className="empty-desc">Create the first mining company and its admin account.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {orgs.map((org) => (
            <Link
              key={org.id}
              href={`/platform/orgs/${org.id}`}
              className="card"
              style={{
                padding: '1rem 1.25rem',
                textDecoration: 'none',
                color: 'inherit',
                display: 'block',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{org.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    {org.admin_count} admin{org.admin_count === 1 ? '' : 's'} ·{' '}
                    {org.features_enabled}/{org.features_total} modules on
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={`badge ${org.active ? 'badge-green' : 'badge-red'}`}>
                    {org.active ? 'active' : 'inactive'}
                  </span>
                  <ToggleLeft size={16} style={{ color: 'var(--text-muted)' }} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
