'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, addDays } from 'date-fns'
import { Save, ChevronLeft, ChevronRight, Camera, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site } from '@/lib/supabase/types'
import { attendanceRepository, RosterEmployee } from '@/lib/repositories/attendance'
import toast from 'react-hot-toast'

const STATUSES = [
  { key: 'present', label: 'P', color: 'present', full: 'Present' },
  { key: 'absent', label: 'A', color: 'absent', full: 'Absent' },
  { key: 'half-day', label: 'H', color: 'half', full: 'Half Day' },
  { key: 'leave', label: 'L', color: 'leave', full: 'Leave' },
] as const

export default function AttendancePage() {
  const { isAdmin, isSiteManager, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [roster, setRoster] = useState<RosterEmployee[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const isDirtyRef = useRef(false)

  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  const supabase = createClient()

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin && !isSiteManager) {
      router.push('/dashboard')
      return
    }
    loadSites()
  }, [authLoading, isAdmin, isSiteManager])

  useEffect(() => {
    if (selectedSite) loadRoster()
  }, [selectedSite, selectedDate])

  useEffect(() => {
    if (!selectedSite) return
    const channel = supabase
      .channel(`attendance-realtime-${selectedSite}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'attendance',
        },
        () => {
          if (!isDirtyRef.current) {
            loadRoster()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedSite, selectedDate])

  const loadSites = async () => {
    try {
      const { data } = await supabase.from('sites').select('*').eq('active', true).order('name')
      const loadedSites = data || []
      setSites(loadedSites)
      if (loadedSites.length > 0) {
        setSelectedSite(loadedSites[0].id)
      }
    } catch (err: any) {
      toast.error(`Error loading sites: ${err.message}`)
    }
  }

  const loadRoster = async () => {
    setLoading(true)
    try {
      const data = await attendanceRepository.listRoster(supabase, selectedSite, selectedDate)
      setRoster(data)
      setIsDirty(false)
      const cacheKey = `cached_roster_${selectedSite}_${selectedDate}`
      localStorage.setItem(cacheKey, JSON.stringify(data))
    } catch (error: any) {
      const cacheKey = `cached_roster_${selectedSite}_${selectedDate}`
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        setRoster(JSON.parse(cached))
        setIsDirty(false)
        toast('Serving cached muster roll (offline mode)', { icon: '📶' })
      } else {
        toast.error(`Error loading attendance roster: ${error.message}`)
        setRoster([])
      }
    } finally {
      setLoading(false)
    }
  }

  const handleStatusChange = (employeeId: string, status: 'present' | 'absent' | 'half-day' | 'leave') => {
    setRoster(prev => prev.map(emp => emp.id === employeeId ? { ...emp, status } : emp))
    setIsDirty(true)
  }

  const handlePhotoUpload = async (employeeId: string, file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size exceeds the 5MB limit')
      return
    }

    setRoster(prev => prev.map(emp => emp.id === employeeId ? { ...emp, uploading: true } : emp))

    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const fileUuid = crypto.randomUUID()
      const path = `${selectedSite}/${selectedDate}/${fileUuid}.${ext}`

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('attendance-photos')
        .upload(path, file, { upsert: true })

      if (uploadError) throw uploadError

      if (uploadData) {
        const { data: signedData } = await supabase.storage
          .from('attendance-photos')
          .createSignedUrl(path, 3600)

        setRoster(prev => prev.map(emp => emp.id === employeeId ? {
          ...emp,
          photo_url: path,
          display_photo_url: signedData?.signedUrl || path,
          uploading: false,
        } : emp))

        setIsDirty(true)
        toast.success('Photo uploaded')
      }
    } catch (err: any) {
      toast.error(`Photo upload failed: ${err.message}`)
      setRoster(prev => prev.map(emp => emp.id === employeeId ? { ...emp, uploading: false } : emp))
    }
  }

  const saveAttendance = async () => {
    setSaving(true)
    try {
      const records = roster.map(emp => ({
        employee_id: emp.id,
        att_date: selectedDate,
        status: emp.status,
        photo_url: emp.photo_url,
      }))

      await attendanceRepository.saveRoster(supabase, records, selectedSite)
      toast.success('Attendance records saved successfully')
      setIsDirty(false)
      loadRoster()
    } catch (error: any) {
      toast.error(`Error saving attendance: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const adjustDate = (days: number) => {
    const cur = new Date(selectedDate)
    const next = addDays(cur, days)
    setSelectedDate(format(next, 'yyyy-MM-dd'))
  }

  // Quick action: Bulk "Mark all present"
  const markAllPresent = () => {
    setRoster(prev => prev.map(emp => ({ ...emp, status: 'present' })))
    setIsDirty(true)
    toast.success('All marked Present (don\'t forget to click Save)')
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Attendance</h1>
          <p className="page-subtitle">Daily Muster Roll</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={markAllPresent} disabled={roster.length === 0}>
            Mark All Present
          </button>
          <button className="btn btn-primary" onClick={saveAttendance} disabled={saving || roster.length === 0}>
            {saving ? <><Loader2 className="spinner" size={16} /> Saving</> : <><Save size={16} /> Save</>}
          </button>
        </div>
      </div>

      {/* Date Navigation */}
      <div className="card mb-4" style={{ padding: '0.875rem 1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {sites.length > 1 && (
            <select className="form-input form-select" style={{ flex: 1, minWidth: '140px' }}
              value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flex: 1, minWidth: '220px' }}>
            <button className="btn btn-secondary btn-icon" onClick={() => adjustDate(-1)} title="Previous Day">
              <ChevronLeft size={16} />
            </button>
            <input
              type="date"
              className="form-input"
              style={{ textAlign: 'center' }}
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
            />
            <button className="btn btn-secondary btn-icon" onClick={() => adjustDate(1)} title="Next Day">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '72px', borderRadius: 'var(--radius)' }} />)}
        </div>
      ) : roster.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Employees Found</div>
          <div className="empty-desc">Please register employees under this mine site first.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {roster.map(emp => (
            <div
              key={emp.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: '0.875rem 1.25rem',
                borderBottom: '1px solid var(--border-subtle)',
                gap: '0.75rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {/* Photo Thumbnail / File input */}
                  <label style={{
                    width: '40px', height: '40px',
                    borderRadius: '50%',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', overflow: 'hidden', flexShrink: 0,
                    position: 'relative',
                  }}>
                    {emp.uploading ? (
                      <Loader2 className="spinner" size={14} />
                    ) : emp.display_photo_url ? (
                      <img src={emp.display_photo_url} alt={emp.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                    ) : (
                      <Camera size={16} style={{ color: 'var(--text-muted)' }} />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      style={{ display: 'none' }}
                      disabled={emp.uploading}
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handlePhotoUpload(emp.id, file)
                      }}
                    />
                  </label>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{emp.name}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                      {emp.role} • {emp.wage_type === 'monthly' ? 'Monthly' : `₹${emp.wage_rate}/day`}
                    </div>
                  </div>
                </div>

                <div className="att-btn-group">
                  {STATUSES.map(st => (
                    <button
                      key={st.key}
                      className={`att-btn ${st.color} ${emp.status === st.key ? 'active' : ''}`}
                      onClick={() => handleStatusChange(emp.id, st.key)}
                      title={st.full}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
