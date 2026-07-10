'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { Plus, Search, Truck, X, Camera, Image } from 'lucide-react'

const VEHICLE_TYPES = ['12WH', '10WH', '6WH', 'Other']
const OWNERSHIP_TYPES = ['rented', 'owned']

import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'

export default function TripsPage() {
  const { isAdmin, isSiteManager, loading: authLoading } = useAuth()
  const router = useRouter()
  const [trips, setTrips] = useState<any[]>([])
  const [sites, setSites] = useState<any[]>([])
  const [vehicles, setVehicles] = useState<any[]>([])
  const [contractors, setContractors] = useState<any[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [filteredVehicles, setFilteredVehicles] = useState<any[]>([])
  const [form, setForm] = useState({
    vehicle_id: '', plate_number: '', contractor_id: '',
    ownership: 'rented', vehicle_type: '12WH', dd_number: '',
    permit_number: '', load_info: '', notes: '',
  })
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin && !isSiteManager) {
      router.push('/dashboard')
      return
    }
    loadInitialData()
  }, [authLoading, isAdmin, isSiteManager])
  useEffect(() => { if (selectedSite) loadTrips() }, [selectedSite, selectedDate])
  useEffect(() => {
    if (vehicleSearch.length > 0) {
      const filtered = vehicles.filter(v =>
        v.plate_number.toLowerCase().includes(vehicleSearch.toLowerCase())
      )
      setFilteredVehicles(filtered)
    } else {
      setFilteredVehicles([])
    }
  }, [vehicleSearch, vehicles])

  const loadInitialData = async () => {
    const [{ data: sitesData }, { data: vehiclesData }, { data: contractorsData }] = await Promise.all([
      supabase.from('sites').select('*').eq('active', true).order('name'),
      supabase.from('vehicles').select('*, transport_contractors(name)').eq('active', true).order('plate_number'),
      supabase.from('transport_contractors').select('*').eq('active', true).order('name'),
    ])
    setSites(sitesData || [])
    setVehicles(vehiclesData || [])
    setContractors(contractorsData || [])
    if (sitesData && sitesData.length > 0) setSelectedSite(sitesData[0].id)
    setLoading(false)
  }

  const loadTrips = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('trips')
      .select('*, vehicles(plate_number, vehicle_type), transport_contractors(name), drivers(name)')
      .eq('site_id', selectedSite)
      .eq('trip_date', selectedDate)
      .order('created_at', { ascending: false })
    setTrips(data || [])
    setLoading(false)
  }

  const selectVehicle = (vehicle: any) => {
    setForm(f => ({
      ...f,
      vehicle_id: vehicle.id,
      plate_number: vehicle.plate_number,
      contractor_id: vehicle.default_contractor_id || '',
      ownership: vehicle.ownership || 'rented',
      vehicle_type: vehicle.vehicle_type || '12WH',
    }))
    setVehicleSearch(vehicle.plate_number)
    setFilteredVehicles([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    let vehicleId = form.vehicle_id

    // Create vehicle on-the-fly if new plate
    if (!vehicleId && vehicleSearch) {
      const { data: newVehicle } = await supabase.from('vehicles').upsert({
        plate_number: vehicleSearch.toUpperCase(),
        vehicle_type: form.vehicle_type,
        ownership: form.ownership,
        default_contractor_id: form.contractor_id || null,
        active: true,
      }, { onConflict: 'plate_number' }).select().single()
      vehicleId = newVehicle?.id
    }

    // Upload photo if captured
    let photoUrl: string | null = null
    if (photoFile) {
      const ext = photoFile.name.split('.').pop() || 'jpg'
      const path = `${selectedSite}/${selectedDate}/${Date.now()}.${ext}`
      const { data: uploadData } = await supabase.storage
        .from('trip-photos')
        .upload(path, photoFile, { upsert: true })
      if (uploadData) {
        const { data: urlData } = supabase.storage.from('trip-photos').getPublicUrl(path)
        photoUrl = urlData.publicUrl
      }
    }

    await supabase.from('trips').insert({
      site_id: selectedSite,
      vehicle_id: vehicleId || null,
      contractor_id: form.contractor_id || null,
      trip_date: selectedDate,
      entry_time: new Date().toISOString(),
      ownership_snapshot: form.ownership,
      dd_number: form.dd_number || null,
      permit_number: form.permit_number || null,
      load_info: form.load_info || null,
      notes: form.notes || null,
      photo_url: photoUrl,
    })

    setShowForm(false)
    setForm({ vehicle_id: '', plate_number: '', contractor_id: '', ownership: 'rented', vehicle_type: '12WH', dd_number: '', permit_number: '', load_info: '', notes: '' })
    setVehicleSearch('')
    setPhotoFile(null)
    setPhotoPreview(null)
    setSubmitting(false)
    loadTrips()
  }

  const deleteTrip = async (id: string) => {
    if (!confirm('Delete this trip?')) return
    await supabase.from('trips').delete().eq('id', id)
    loadTrips()
  }

  // Group trips by contractor
  const byContractor = trips.reduce((acc, t) => {
    const name = t.transport_contractors?.name || 'Unknown'
    if (!acc[name]) acc[name] = []
    acc[name].push(t)
    return acc
  }, {} as Record<string, any[]>)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Trips</h1>
          <p className="page-subtitle">Vehicle Movement Log</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={18} /> Log Trip
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-4" style={{ padding: '0.875rem 1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {sites.length > 1 && (
            <select className="form-input form-select" style={{ flex: 1, minWidth: '140px' }}
              value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <input
            type="date"
            className="form-input"
            style={{ flex: 1, minWidth: '140px' }}
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
          />
          <div style={{
            padding: '0.375rem 0.875rem',
            background: 'var(--accent-muted)',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius)',
            color: 'var(--accent)',
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            fontSize: '1.1rem',
          }}>
            {trips.length}
          </div>
        </div>
      </div>

      {/* Contractor Summary */}
      {Object.keys(byContractor).length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {(Object.entries(byContractor) as [string, any[]][]).map(([name, trps]) => (
            <div key={name} className="badge badge-amber" style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}>
              {name}: <strong style={{ marginLeft: '0.25rem' }}>{trps.length}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Trips List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '72px', borderRadius: 'var(--radius)' }} />)}
        </div>
      ) : trips.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Truck size={28} /></div>
          <div className="empty-title">No trips today</div>
          <div className="empty-desc">Tap "Log Trip" to record the first vehicle movement</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {trips.map(trip => (
            <div key={trip.id} className="trip-card" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                <div style={{
                  width: '40px', height: '40px',
                  background: 'var(--accent-muted)',
                  borderRadius: 'var(--radius)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.25rem', flexShrink: 0,
                }}>🚛</div>
                <div>
                  <div className="trip-vehicle">{trip.vehicles?.plate_number || 'Unknown'}</div>
                  <div className="trip-contractor">{trip.transport_contractors?.name || '—'}</div>
                  {trip.dd_number && <div className="trip-time">DD: {trip.dd_number}</div>}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className={`trip-type-badge ${trip.ownership_snapshot}`}>
                  {trip.vehicles?.vehicle_type || '?'}
                </span>
                <button
                  className="btn btn-danger btn-icon btn-sm"
                  onClick={() => deleteTrip(trip.id)}
                  title="Delete trip"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FAB */}
      <button className="btn-fab" onClick={() => setShowForm(true)} title="Log Trip">
        <Plus size={24} />
      </button>

      {/* Trip Form Sheet */}
      {showForm && (
        <>
          <div className="sheet-overlay" onClick={() => setShowForm(false)} />
          <div className="sheet">
            <div className="sheet-handle" />
            <div className="sheet-title">Log Trip</div>

            <form onSubmit={handleSubmit}>
              {/* Vehicle Search */}
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="form-label">Vehicle Plate Number *</label>
                <div style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="form-input"
                    style={{ paddingLeft: '2.5rem', textTransform: 'uppercase' }}
                    placeholder="Search or enter new plate..."
                    value={vehicleSearch}
                    onChange={e => { setVehicleSearch(e.target.value.toUpperCase()); setForm(f => ({ ...f, vehicle_id: '' })) }}
                    required
                    autoComplete="off"
                  />
                </div>
                {filteredVehicles.length > 0 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    zIndex: 10,
                    maxHeight: '200px',
                    overflowY: 'auto',
                    boxShadow: 'var(--shadow-elevated)',
                  }}>
                    {filteredVehicles.map(v => (
                      <div
                        key={v.id}
                        onClick={() => selectVehicle(v)}
                        style={{
                          padding: '0.75rem 1rem',
                          cursor: 'pointer',
                          borderBottom: '1px solid var(--border-subtle)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 600, fontFamily: 'var(--font-display)' }}>{v.plate_number}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{v.vehicle_type}</span>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>{v.transport_contractors?.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Type</label>
                  <select className="form-input form-select" value={form.vehicle_type}
                    onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}>
                    {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Ownership</label>
                  <select className="form-input form-select" value={form.ownership}
                    onChange={e => setForm(f => ({ ...f, ownership: e.target.value }))}>
                    {OWNERSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Transport Contractor</label>
                <select className="form-input form-select" value={form.contractor_id}
                  onChange={e => setForm(f => ({ ...f, contractor_id: e.target.value }))}>
                  <option value="">Select contractor</option>
                  {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">DD Number</label>
                  <input className="form-input" value={form.dd_number}
                    onChange={e => setForm(f => ({ ...f, dd_number: e.target.value }))}
                    placeholder="Optional" />
                </div>
                <div className="form-group">
                  <label className="form-label">Permit No.</label>
                  <input className="form-input" value={form.permit_number}
                    onChange={e => setForm(f => ({ ...f, permit_number: e.target.value }))}
                    placeholder="Optional" />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Load Info</label>
                <input className="form-input" value={form.load_info}
                  onChange={e => setForm(f => ({ ...f, load_info: e.target.value }))}
                  placeholder="e.g. 6 loads, 12 tonnes..." />
              </div>

              {/* Photo capture */}
              <div className="form-group">
                <label className="form-label">Photo Evidence (optional)</label>
                <div style={{ display: 'flex', gap: '0.625rem' }}>
                  <label style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: '0.5rem', padding: '0.75rem',
                    background: 'var(--bg-elevated)', border: '1.5px dashed var(--border)',
                    borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.875rem',
                    color: 'var(--text-muted)', transition: 'all 0.15s',
                  }}>
                    <Camera size={18} /> Capture
                    <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) { setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)) }
                      }} />
                  </label>
                  <label style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: '0.5rem', padding: '0.75rem',
                    background: 'var(--bg-elevated)', border: '1.5px dashed var(--border)',
                    borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.875rem',
                    color: 'var(--text-muted)', transition: 'all 0.15s',
                  }}>
                    <Image size={18} /> Gallery
                    <input type="file" accept="image/*" style={{ display: 'none' }}
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) { setPhotoFile(f); setPhotoPreview(URL.createObjectURL(f)) }
                      }} />
                  </label>
                </div>
                {photoPreview && (
                  <div style={{ position: 'relative', marginTop: '0.625rem' }}>
                    <img src={photoPreview} alt="Preview"
                      style={{ width: '100%', maxHeight: '160px', objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }} />
                    <button type="button" onClick={() => { setPhotoFile(null); setPhotoPreview(null) }}
                      style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}>
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary w-full" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                  {submitting ? <span className="spinner" /> : '+ Log Trip'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
