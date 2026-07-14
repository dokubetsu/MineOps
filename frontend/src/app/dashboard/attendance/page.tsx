'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { Save, ChevronLeft, ChevronRight, Camera, Loader2, Image } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'

const STATUSES = [
  { key: 'present', label: 'P', color: 'present', full: 'Present' },
  { key: 'absent', label: 'A', color: 'absent', full: 'Absent' },
  { key: 'half-day', label: 'H', color: 'half', full: 'Half Day' },
  { key: 'leave', label: 'L', color: 'leave', full: 'Leave' },
]

export default function AttendancePage() {
  const { isAdmin, isSiteManager, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sites, setSites] = useState<any[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [roster, setRoster] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const supabase = createClient()

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin && !isSiteManager) {
      router.push('/dashboard')
      return
    }
    supabase.from('sites').select('*').eq('active', true).order('name').then(({ data }) => {
      setSites(data || [])
      if (data && data.length > 0) setSelectedSite(data[0].id)
    })
  }, [authLoading, isAdmin, isSiteManager])

  useEffect(() => {
    if (selectedSite) loadRoster()
  }, [selectedSite, selectedDate])

  const loadRoster = async () => {
    setLoading(true)
    // Get employees
    const { data: employees, error: empError } = await supabase
      .from('employees')
      .select('id, name, role, wage_type, wage_rate')
      .eq('site_id', selectedSite)
      .eq('active', true)
      .order('name')
      .limit(500)

    if (empError) {
      alert(`Error loading employees: ${empError.message}`)
      setLoading(false)
      return
    }

    // Get existing attendance
    const empIds = (employees || []).map(e => e.id)
    const { data: att, error: attError } = empIds.length > 0
      ? await supabase.from('attendance').select('*').in('employee_id', empIds).eq('att_date', selectedDate).limit(1000)
      : { data: [], error: null }

    if (attError) {
      alert(`Error loading attendance records: ${attError.message}`)
      setLoading(false)
      return
    }

    const attMap = Object.fromEntries((att || []).map(a => [a.employee_id, a]))

    // Map roster and dynamically generate a 1-hour signed URL for read access (Fix N4)
    const rosterData = await Promise.all((employees || []).map(async (emp) => {
      const dbRecord = attMap[emp.id]
      let displayPhotoUrl = null
      if (dbRecord?.photo_url) {
        let path = dbRecord.photo_url
        if (path.includes('attendance-photos/')) {
          path = path.split('attendance-photos/').pop() || path
        }
        const { data: signedData } = await supabase.storage
          .from('attendance-photos')
          .createSignedUrl(path, 3600)
        displayPhotoUrl = signedData?.signedUrl || dbRecord.photo_url
      }

      return {
        ...emp,
        att_id: dbRecord?.id || null,
        status: dbRecord?.status || 'present',
        photo_url: dbRecord?.photo_url || null,
        display_photo_url: displayPhotoUrl,
        uploading: false,
      }
    }))

    setRoster(rosterData)
    setLoading(false)
  }

  const updateStatus = (empId: string, status: string) => {
    setRoster(r => r.map(e => e.id === empId ? { ...e, status } : e))
  }

  const handlePhotoUpload = async (empId: string, file: File) => {
    setRoster(r => r.map(e => e.id === empId ? { ...e, uploading: true } : e))
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${selectedSite}/${selectedDate}/${empId}_${Date.now()}.${ext}`

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('attendance-photos')
        .upload(path, file, { upsert: true })

      if (uploadError) throw uploadError

      if (uploadData) {
        const photoUrl = path

        // Also get a signed URL for immediate preview (Fix N4)
        const { data: signedData } = await supabase.storage
          .from('attendance-photos')
          .createSignedUrl(path, 3600)

        setRoster(r => r.map(e => e.id === empId ? { 
          ...e, 
          photo_url: photoUrl, 
          display_photo_url: signedData?.signedUrl || photoUrl,
          uploading: false 
        } : e))
      }
    } catch (err: any) {
      console.error('Error uploading photo:', err)
      alert(`Failed to upload photo: ${err?.message || err}`)
      setRoster(r => r.map(e => e.id === empId ? { ...e, uploading: false } : e))
    }
  }

  const saveAll = async () => {
    setSaving(true)
    const records = roster.map(emp => ({
      employee_id: emp.id,
      att_date: selectedDate,
      status: emp.status,
      photo_url: emp.photo_url || null,
    }))
    const { error } = await supabase.from('attendance').upsert(records, { onConflict: 'employee_id,att_date' })
    if (error) {
      alert(`Error saving attendance roster: ${error.message}`)
    } else {
      setSavedIds(new Set(roster.map(e => e.id)))
    }
    setSaving(false)
  }

  const prevDate = () => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() - 1)
    setSelectedDate(format(d, 'yyyy-MM-dd'))
  }

  const nextDate = () => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + 1)
    if (d <= new Date()) setSelectedDate(format(d, 'yyyy-MM-dd'))
  }

  const counts = roster.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-subtitle">Daily Roster</p>
        </div>
        <button className="btn btn-primary" onClick={saveAll} disabled={saving}>
          {saving ? <span className="spinner" /> : <><Save size={16} /> Save All</>}
        </button>
      </div>

      {/* Date Nav */}
      <div className="card mb-4" style={{ padding: '0.75rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {sites.length > 1 && (
            <select className="form-input form-select" style={{ flex: 1, minWidth: '140px' }}
              value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={prevDate}><ChevronLeft size={18} /></button>
            <input type="date" className="form-input" style={{ flex: 1, textAlign: 'center' }}
              value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
            <button className="btn btn-ghost btn-icon btn-sm" onClick={nextDate}
              disabled={selectedDate >= format(new Date(), 'yyyy-MM-dd')}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Summary badges */}
      {roster.length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <span className="badge badge-green">Present: {counts['present'] || 0}</span>
          <span className="badge badge-red">Absent: {counts['absent'] || 0}</span>
          <span className="badge badge-amber">Half Day: {counts['half-day'] || 0}</span>
          <span className="badge badge-blue">Leave: {counts['leave'] || 0}</span>
          <span className="badge badge-gray">Total: {roster.length}</span>
        </div>
      )}

      {/* Roster */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: '68px', borderRadius: 'var(--radius)' }} />)}
        </div>
      ) : roster.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: '2rem' }}>👷</div>
          <div className="empty-title">No Employees</div>
          <div className="empty-desc">Add employees in the Employees section to mark attendance</div>
        </div>
      ) : (
        <div className="attendance-grid">
          {roster.map(emp => (
            <div key={emp.id} className={`attendance-row ${emp.status === 'absent' ? 'card-danger' : emp.status === 'leave' ? 'card-info' : ''}`}>
              <div style={{
                width: '36px', height: '36px',
                borderRadius: '50%',
                background: 'var(--bg-elevated)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.875rem', color: 'var(--text-secondary)',
                flexShrink: 0,
              }}>
                {emp.name[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="attendance-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {emp.name}
                </div>
                <div className="attendance-role">
                  {emp.role} · ₹{emp.wage_rate}/{emp.wage_type === 'daily' ? 'day' : 'mo'}
                </div>
              </div>
              
              {/* Photo Evidence upload */}
              <div style={{ display: 'flex', alignItems: 'center', marginRight: '0.5rem', flexShrink: 0 }}>
                <label style={{ cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <input
                    type="file"
                    accept="image/*"
                    capture="user"
                    style={{ display: 'none' }}
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) handlePhotoUpload(emp.id, f)
                    }}
                    disabled={emp.uploading}
                  />
                  {emp.uploading ? (
                    <Loader2 size={18} className="spinner" style={{ color: 'var(--accent)' }} />
                  ) : emp.display_photo_url ? (
                    <a href={emp.display_photo_url} target="_blank" rel="noreferrer" title="View photo evidence" onClick={e => e.stopPropagation()}>
                      <img src={emp.display_photo_url} alt="Evidence" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', border: '1.5px solid var(--success)' }} />
                    </a>
                  ) : (
                    <div className="btn-ghost btn btn-icon" style={{ padding: '0.375rem', color: 'var(--text-muted)' }} title="Capture photo evidence">
                      <Camera size={18} />
                    </div>
                  )}
                </label>
              </div>

              <div className="attendance-toggles">
                {STATUSES.map(s => (
                  <button
                    key={s.key}
                    className={`att-btn ${emp.status === s.key ? `selected-${s.color}` : ''}`}
                    onClick={() => updateStatus(emp.id, s.key)}
                    title={s.full}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sticky Save */}
      {roster.length > 0 && (
        <div style={{
          position: 'sticky',
          bottom: 'calc(4.5rem + var(--safe-bottom))',
          marginTop: '1rem',
          display: 'flex',
          justifyContent: 'center',
        }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={saveAll}
            disabled={saving}
            style={{ boxShadow: 'var(--shadow-glow)' }}
          >
            {saving ? <><span className="spinner" /> Saving...</> : <><Save size={18} /> Save Attendance ({roster.length})</>}
          </button>
        </div>
      )}
    </div>
  )
}
