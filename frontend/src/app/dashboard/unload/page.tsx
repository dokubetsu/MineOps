'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { canDocumentUnload, quantityUnitLabel } from '@/lib/trip-ops-policy'
import { toErrorMessage } from '@/lib/errors'
import PageHeader from '@/components/PageHeader'
import toast from 'react-hot-toast'

type UnloadTrip = {
  id: string
  trip_date: string
  drop_location: string | null
  cubic_capacity: number | null
  unloaded_at: string | null
  unload_notes: string | null
  unload_quantity: number | null
  vehicles?: { plate_number?: string | null } | null
}

export default function UnloadPage() {
  const supabase = createClient()
  const { userRole, tripOps, siteIds, assignedSites, loading: authLoading } = useAuth()
  const [trips, setTrips] = useState<UnloadTrip[]>([])
  const [loading, setLoading] = useState(true)
  const [active, setActive] = useState<UnloadTrip | null>(null)
  const [notes, setNotes] = useState('')
  const [qty, setQty] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAllDone, setShowAllDone] = useState(false)

  const allowed = canDocumentUnload(userRole?.role)
  const unit = quantityUnitLabel(tripOps)
  const isClerk = userRole?.role === 'unload_clerk'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let q = supabase
        .from('trips')
        .select('id, trip_date, drop_location, cubic_capacity, unloaded_at, unload_notes, unload_quantity, site_id, vehicles(plate_number)')
        .eq('active', true)
        .order('trip_date', { ascending: false })
        .limit(100)
      if (isClerk && siteIds.length > 0) {
        q = q.in('site_id', siteIds)
      }
      const { data, error } = await q
      if (error) throw error
      setTrips((data as UnloadTrip[]) || [])
    } catch (err) {
      toast.error(toErrorMessage(err, 'Failed to load trips'))
    } finally {
      setLoading(false)
    }
  }, [supabase, isClerk, siteIds])

  useEffect(() => {
    if (authLoading) return
    if (!allowed) return
    void load()
  }, [authLoading, allowed, load])

  const openDoc = (t: UnloadTrip) => {
    setActive(t)
    setNotes(t.unload_notes || '')
    setQty(t.unload_quantity != null ? String(t.unload_quantity) : '')
  }

  const save = async () => {
    if (!active) return
    setSaving(true)
    try {
      const q = qty.trim() === '' ? null : Number(qty)
      if (q != null && (!Number.isFinite(q) || q < 0)) {
        throw new Error('Unload quantity must be a non-negative number')
      }
      const { error } = await supabase.rpc('document_trip_unload', {
        p_trip_id: active.id,
        p_unload_notes: notes.trim() || null,
        p_unload_quantity: q,
      })
      if (error) throw error
      toast.success('Unload documented')
      setActive(null)
      await load()
    } catch (err) {
      toast.error(toErrorMessage(err, 'Failed to save unload'))
    } finally {
      setSaving(false)
    }
  }

  if (authLoading) {
    return (
      <div className="page">
        <PageHeader title="Unload" />
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="page">
        <PageHeader title="Unload" />
        <p style={{ color: 'var(--text-muted)' }}>
          Only unload clerks and admins can document destination unloading.
        </p>
      </div>
    )
  }

  const pending = trips.filter((t) => !t.unloaded_at)
  const done = trips.filter((t) => !!t.unloaded_at)

  return (
    <div className="page">
      <PageHeader
        title="Unload"
        subtitle={
          assignedSites.length
            ? `Loading sites: ${assignedSites.map((s) => s.name).join(', ')} — document unload at any destination`
            : 'Document destination unloading (no payment)'
        }
      />

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Loading trips…</p>
      ) : (
        <>
          <h2 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Awaiting unload</h2>
          {pending.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>No pending trips.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
              {pending.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="card"
                  style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}
                  onClick={() => openDoc(t)}
                >
                  <div style={{ fontWeight: 600 }}>
                    {t.vehicles?.plate_number || 'Vehicle'} · {t.trip_date}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Drop: {t.drop_location || '—'} · Qty: {t.cubic_capacity ?? '—'} {unit}
                  </div>
                </button>
              ))}
            </div>
          )}

          <h2 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Documented</h2>
          {done.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>None yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {(showAllDone ? done : done.slice(0, 30)).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="card"
                  style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)', opacity: 0.9 }}
                  onClick={() => openDoc(t)}
                >
                  <div style={{ fontWeight: 600 }}>
                    {t.vehicles?.plate_number || 'Vehicle'} · {t.trip_date}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Unloaded {t.unloaded_at ? new Date(t.unloaded_at).toLocaleString() : ''}
                    {t.unload_quantity != null ? ` · ${t.unload_quantity} ${unit}` : ''}
                  </div>
                </button>
              ))}
              {done.length > 30 && !showAllDone && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ alignSelf: 'center', marginTop: '0.5rem' }}
                  onClick={() => setShowAllDone(true)}
                >
                  Show all {done.length} documented unloads
                </button>
              )}
            </div>
          )}
        </>
      )}

      {active && (
        <>
          <div className="sheet-overlay" onClick={() => setActive(null)} />
          <div className="sheet">
            <div className="sheet-handle" />
            <div className="sheet-title">Document unload</div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              {active.vehicles?.plate_number || 'Trip'} · {active.trip_date}
            </p>
            <div className="form-group">
              <label className="form-label">Unload quantity ({unit})</label>
              <input
                className="form-input"
                type="number"
                step="0.01"
                min="0"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder={active.cubic_capacity != null ? String(active.cubic_capacity) : ''}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea
                className="form-input"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Condition, shortages, receiver name…"
              />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="button" className="btn btn-secondary w-full" onClick={() => setActive(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary w-full" disabled={saving} onClick={() => void save()}>
                {saving ? <span className="spinner" /> : 'Save unload'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
