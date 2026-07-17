'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site, TransportContractor, Vehicle } from '@/lib/supabase/types'
import toast from 'react-hot-toast'
import { toErrorMessage } from '@/lib/errors'

interface ExtendedVehicle extends Vehicle {
  transport_contractors?: {
    name: string
  } | null
}

export default function SettingsPage() {
  const { isAdmin, organizationId, organizationName, loading: authLoading } = useAuth()
  const [orgName, setOrgName] = useState('')
  const [savingOrg, setSavingOrg] = useState(false)

  useEffect(() => {
    if (organizationName) {
      setOrgName(organizationName)
    }
  }, [organizationName])
  const router = useRouter()
  const [sites, setSites] = useState<Site[]>([])
  const [contractors, setContractors] = useState<TransportContractor[]>([])
  const [vehicles, setVehicles] = useState<ExtendedVehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'sites' | 'contractors' | 'vehicles' | 'organization'>('sites')

  // Forms
  const [siteName, setSiteName] = useState('')
  const [siteLocation, setSiteLocation] = useState('')
  const [contractorName, setContractorName] = useState('')
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [vehicleType, setVehicleType] = useState('12WH')
  const [vehicleOwnership, setVehicleOwnership] = useState('rented')
  const [vehicleContractor, setVehicleContractor] = useState('')

  const supabase = createClient()

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin) {
      router.push('/dashboard')
      return
    }
    loadAll()
  }, [authLoading, isAdmin])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [{ data: s, error: sErr }, { data: c, error: cErr }, { data: v, error: vErr }] = await Promise.all([
        supabase.from('sites').select('*').order('name').limit(200),
        supabase.from('transport_contractors').select('*').order('name').limit(200),
        supabase.from('vehicles').select('*, transport_contractors(name)').order('plate_number').limit(1000),
      ])
      if (sErr) throw sErr
      if (cErr) throw cErr
      if (vErr) throw vErr
      setSites(s || [])
      setContractors(c || [])
      setVehicles((v as any) || [])
    } catch (err: unknown) {
      toast.error(`Error loading configurations: ${toErrorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const addSite = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('sites').insert({ name: siteName, location: siteLocation, active: true, organization_id: organizationId! })
    if (error) {
      toast.error(`Error adding site: ${toErrorMessage(error)}`)
    } else {
      toast.success('Site added successfully')
      setSiteName(''); setSiteLocation('')
      loadAll()
    }
  }

  const addContractor = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.from('transport_contractors').insert({ name: contractorName, active: true, organization_id: organizationId! })
    if (error) {
      toast.error(`Error adding contractor: ${toErrorMessage(error)}`)
    } else {
      toast.success('Contractor added successfully')
      setContractorName('')
      loadAll()
    }
  }

  const addVehicle = async (e: React.FormEvent) => {
    e.preventDefault()
    const upperPlate = vehiclePlate.toUpperCase()
    
    // Check if vehicle plate already exists first to show a friendly error
    const { data: existing } = await supabase.from('vehicles')
      .select('id')
      .eq('plate_number', upperPlate)
      .maybeSingle()

    if (existing) {
      toast.error(`Vehicle with plate ${upperPlate} already exists.`)
      return
    }

    const { error } = await supabase.from('vehicles').insert({
      plate_number: upperPlate,
      vehicle_type: vehicleType as '12WH' | '10WH' | '6WH' | 'Other',
      ownership: vehicleOwnership as 'rented' | 'owned',
      default_contractor_id: vehicleContractor || null,
      active: true,
      organization_id: organizationId!,
    })

    if (error) {
      toast.error(toErrorMessage(error))
    } else {
      toast.success('Vehicle registered successfully')
      setVehiclePlate(''); setVehicleContractor('')
      loadAll()
    }
  }

  const updateOrganization = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgName.trim()) {
      toast.error('Organization name cannot be empty')
      return
    }
    setSavingOrg(true)
    const { error } = await supabase
      .from('organizations')
      .update({ name: orgName })
      .eq('id', organizationId!)
    
    if (error) {
      toast.error(`Error updating organization: ${toErrorMessage(error)}`)
    } else {
      toast.success('Organization updated successfully')
      router.refresh()
    }
    setSavingOrg(false)
  }

  const toggleActive = async (table: 'sites' | 'transport_contractors' | 'vehicles', id: string, current: boolean) => {
    let errorMsg = ''
    if (table === 'sites') {
      if (current) { // deactivating
        const activeSites = sites.filter(s => s.active)
        if (activeSites.length <= 1) {
          toast.error('Cannot deactivate the last active site')
          return
        }
      }
      const { error } = await supabase.from('sites').update({ active: !current }).eq('id', id)
      if (error) errorMsg = toErrorMessage(error)
    } else if (table === 'transport_contractors') {
      const { error } = await supabase.from('transport_contractors').update({ active: !current }).eq('id', id)
      if (error) errorMsg = toErrorMessage(error)
    } else if (table === 'vehicles') {
      const { error } = await supabase.from('vehicles').update({ active: !current }).eq('id', id)
      if (error) errorMsg = toErrorMessage(error)
    }

    if (errorMsg) {
      toast.error(`Error: ${errorMsg}`)
    } else {
      toast.success('Status updated')
      loadAll()
    }
  }

  const tabs = [
    { key: 'sites', label: 'Sites', count: sites.length },
    { key: 'contractors', label: 'Contractors', count: contractors.length },
    { key: 'vehicles', label: 'Vehicles', count: vehicles.length },
  ]
  if (isAdmin) {
    tabs.push({ key: 'organization', label: 'Organization', count: 1 })
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Master Data Configuration</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '1.25rem', background: 'var(--bg-card)', borderRadius: 'var(--radius)', padding: '0.25rem', border: '1px solid var(--border)' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            style={{
              flex: 1,
              padding: '0.5rem',
              border: 'none',
              borderRadius: '7px',
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.8rem',
              fontWeight: 500,
              background: activeTab === tab.key ? 'var(--accent)' : 'transparent',
              color: activeTab === tab.key ? '#0a0b0f' : 'var(--text-muted)',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.375rem',
            }}
          >
            {tab.label}
            <span style={{
              background: activeTab === tab.key ? 'rgba(0,0,0,0.2)' : 'var(--bg-elevated)',
              borderRadius: '999px',
              padding: '0 0.4rem',
              fontSize: '0.65rem',
              fontWeight: 700,
              color: activeTab === tab.key ? 'rgba(0,0,0,0.6)' : 'var(--text-muted)',
            }}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '80px', borderRadius: 'var(--radius)' }} />)}
        </div>
      ) : (
        <>
          {/* Sites */}
          {activeTab === 'sites' && (
            <div>
              <form onSubmit={addSite} className="card mb-4">
                <h3 style={{ marginBottom: '0.875rem', fontSize: '0.875rem' }}>Add Site / Mine</h3>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Site Name *</label>
                    <input className="form-input" placeholder="e.g. Madha Mines" value={siteName}
                      onChange={e => setSiteName(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Location</label>
                    <input className="form-input" placeholder="Location/area" value={siteLocation}
                      onChange={e => setSiteLocation(e.target.value)} />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary"><Plus size={16} /> Add Site</button>
              </form>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {sites.map(site => (
                  <div key={site.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                    <div style={{ fontSize: '1.5rem' }}>⛏️</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{site.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{site.location || 'No location'}</div>
                    </div>
                    <button
                      className={`btn btn-sm ${site.active ? 'btn-success' : 'btn-danger'}`}
                      onClick={() => toggleActive('sites', site.id, !!site.active)}
                    >
                      {site.active ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contractors */}
          {activeTab === 'contractors' && (
            <div>
              <form onSubmit={addContractor} className="card mb-4">
                <h3 style={{ marginBottom: '0.875rem', fontSize: '0.875rem' }}>Add Transport Contractor</h3>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <input className="form-input" placeholder="e.g. KVS, Ruban, Talapathi..." value={contractorName}
                    onChange={e => setContractorName(e.target.value)} required style={{ flex: 1 }} />
                  <button type="submit" className="btn btn-primary"><Plus size={16} /> Add</button>
                </div>
              </form>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {contractors.map(c => (
                  <div key={c.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                    <div style={{ fontSize: '1.5rem' }}>🚛</div>
                    <div style={{ flex: 1, fontWeight: 600 }}>{c.name}</div>
                    <button
                      className={`btn btn-sm ${c.active ? 'btn-success' : 'btn-danger'}`}
                      onClick={() => toggleActive('transport_contractors', c.id, !!c.active)}
                    >
                      {c.active ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vehicles */}
          {activeTab === 'vehicles' && (
            <div>
              <form onSubmit={addVehicle} className="card mb-4">
                <h3 style={{ marginBottom: '0.875rem', fontSize: '0.875rem' }}>Register Vehicle</h3>
                <div className="form-group">
                  <label className="form-label">Plate Number *</label>
                  <input className="form-input" placeholder="TN 01 AB 1234" value={vehiclePlate}
                    style={{ textTransform: 'uppercase' }}
                    onChange={e => setVehiclePlate(e.target.value.toUpperCase())} required />
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Type</label>
                    <select className="form-input form-select" value={vehicleType} onChange={e => setVehicleType(e.target.value)}>
                      {['12WH', '10WH', '6WH', 'Other'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Ownership</label>
                    <select className="form-input form-select" value={vehicleOwnership} onChange={e => setVehicleOwnership(e.target.value)}>
                      <option value="rented">Rented</option>
                      <option value="owned">Owned</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Default Contractor</label>
                  <select className="form-input form-select" value={vehicleContractor} onChange={e => setVehicleContractor(e.target.value)}>
                    <option value="">None</option>
                    {contractors.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary"><Plus size={16} /> Register Vehicle</button>
              </form>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {vehicles.map(v => (
                  <div key={v.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                    <div style={{ fontSize: '1.5rem' }}>🚛</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>{v.plate_number}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {v.vehicle_type} · {v.ownership} · {v.transport_contractors?.name || 'No contractor'}
                      </div>
                    </div>
                    <button
                      className={`btn btn-sm ${v.active ? 'btn-success' : 'btn-danger'}`}
                      onClick={() => toggleActive('vehicles', v.id, !!v.active)}
                    >
                      {v.active ? 'Active' : 'Off'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'organization' && (
            <div>
              <form onSubmit={updateOrganization} className="card mb-4" style={{ maxWidth: '500px' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem', fontFamily: 'var(--font-display)' }}>Organization Details</h3>
                <div className="form-group">
                  <label className="form-label">Company / Mining Name</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder="Enter company name"
                    value={orgName}
                    onChange={e => setOrgName(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary" disabled={savingOrg}>
                  {savingOrg ? 'Saving...' : 'Save Changes'}
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  )
}
