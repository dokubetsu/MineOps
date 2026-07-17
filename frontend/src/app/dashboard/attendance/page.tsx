'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, addDays } from 'date-fns'
import { Save, ChevronLeft, ChevronRight, Camera, Loader2, Lock } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site } from '@/lib/supabase/types'
import { attendanceRepository, RosterEmployee } from '@/lib/repositories/attendance'
import { sitesRepository } from '@/lib/repositories/sites'
import { getOfflineCache, setOfflineCache } from '@/lib/offline-cache'
import PageHeader from '@/components/PageHeader'
import toast from 'react-hot-toast'
import { toErrorMessage } from '@/lib/errors'

const STATUSES = [
  { key: 'present' as const, label: 'P', color: 'present', full: 'Present' },
  { key: 'absent' as const, label: 'A', color: 'absent', full: 'Absent' },
  { key: 'half-day' as const, label: 'H', color: 'half', full: 'Half Day' },
  { key: 'leave' as const, label: 'L', color: 'leave', full: 'Leave' },
]

function statusLabel(status: string | null | undefined): string {
  const s = STATUSES.find((x) => x.key === status)
  return s?.full ?? 'Unmarked'
}

export default function AttendancePage() {
  const { isAdmin, isSiteManager, loading: authLoading, user, organizationId } = useAuth()
  const router = useRouter()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [roster, setRoster] = useState<RosterEmployee[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [payrollLocked, setPayrollLocked] = useState(false)
  const isDirtyRef = useRef(false)
  /** Bumped on every local mark/unmark so in-flight save/reload cannot clobber newer edits. */
  const editEpochRef = useRef(0)
  const supabase = createClient()

  const loadSites = async () => {
    try {
      const loadedSites = await sitesRepository.listActive(supabase)
      setSites(loadedSites)
      if (loadedSites.length > 0) {
        setSelectedSite(loadedSites[0].id)
      }
    } catch (err: unknown) {
      toast.error(`Error loading sites: ${toErrorMessage(err)}`)
    }
  }

  /**
   * Load muster for site/date.
   * Never clobber in-progress local edits: if the user marked/unmarked while a
   * fetch was in flight (common after Save → loadRoster), keep their draft and
   * leave Save enabled. Realtime uses the same rule via isDirtyRef.
   */
  const loadRoster = async (_opts?: { force?: boolean }) => {
    if (!selectedSite) return
    setLoading(true)
    try {
      const [data, locked] = await Promise.all([
        attendanceRepository.listRoster(supabase, selectedSite, selectedDate),
        attendanceRepository.isMonthFinalized(supabase, selectedSite, selectedDate),
      ])
      // User edited while we were fetching — do not wipe their draft roster
      // (common: Save → reload races with unmark click before second Save).
      if (isDirtyRef.current) {
        setPayrollLocked(locked)
        return
      }
      setRoster(data)
      setPayrollLocked(locked)
      setIsDirty(false)
      isDirtyRef.current = false
      const cacheable = data.map(({ display_photo_url: _u, uploading: _up, ...rest }) => rest)
      setOfflineCache(user?.id, organizationId, `roster_${selectedSite}_${selectedDate}`, cacheable)
    } catch (error: unknown) {
      const message = toErrorMessage(error)
      if (isDirtyRef.current) {
        // Keep draft on transient load errors while editing
        return
      }
      const cached = getOfflineCache<RosterEmployee[]>(
        user?.id,
        organizationId,
        `roster_${selectedSite}_${selectedDate}`
      )
      if (cached) {
        setRoster(cached)
        setIsDirty(false)
        isDirtyRef.current = false
        setPayrollLocked(false)
        toast('Serving cached muster roll (offline mode)', { icon: '📶' })
      } else {
        toast.error(`Error loading attendance roster: ${message}`)
        setRoster([])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin && !isSiteManager) {
      router.push('/dashboard')
      return
    }
    void loadSites()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount/auth gate
  }, [authLoading, isAdmin, isSiteManager])

  useEffect(() => {
    if (!selectedSite) return
    // Site/date change discards in-progress marks for the previous context
    isDirtyRef.current = false
    setIsDirty(false)
    void loadRoster({ force: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            void loadRoster()
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite, selectedDate])

  const handleStatusChange = (
    employeeId: string,
    status: 'present' | 'absent' | 'half-day' | 'leave'
  ) => {
    if (payrollLocked) {
      toast.error('This month is payroll-finalized — attendance is read-only')
      return
    }
    // Sync refs immediately so in-flight save/load cannot clobber this edit
    editEpochRef.current += 1
    isDirtyRef.current = true
    setIsDirty(true)
    setRoster((prev) =>
      prev.map((emp) => {
        if (emp.id !== employeeId) return emp
        if (emp.status === status) return { ...emp, status: null }
        return { ...emp, status }
      })
    )
  }

  const handlePhotoUpload = async (employeeId: string, file: File) => {
    if (payrollLocked) {
      toast.error('This month is payroll-finalized — photos cannot be changed')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size exceeds the 5MB limit')
      return
    }

    setRoster((prev) =>
      prev.map((emp) => (emp.id === employeeId ? { ...emp, uploading: true } : emp))
    )

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

        setRoster((prev) =>
          prev.map((emp) =>
            emp.id === employeeId
              ? {
                  ...emp,
                  photo_url: path,
                  display_photo_url: signedData?.signedUrl || path,
                  uploading: false,
                }
              : emp
          )
        )

        setIsDirty(true)
        toast.success('Photo uploaded')
      }
    } catch (err: unknown) {
      toast.error(`Photo upload failed: ${toErrorMessage(err)}`)
      setRoster((prev) =>
        prev.map((emp) => (emp.id === employeeId ? { ...emp, uploading: false } : emp))
      )
    }
  }

  const saveAttendance = async () => {
    if (payrollLocked) {
      toast.error(
        'Cannot save: payroll is finalized for this month. Attendance is read-only for finalized periods.'
      )
      return
    }
    if (!selectedSite) {
      toast.error('Select a site before saving attendance')
      return
    }
    if (roster.length === 0) {
      toast.error('No employees on the roster to save')
      return
    }
    const unmarked = roster.filter((e) => !e.status).length
    const marked = roster.length - unmarked
    if (unmarked > 0 && marked > 0) {
      toast(
        `${unmarked} unmarked employee(s) will clear any saved mark for this date`,
        { icon: '⚠️' }
      )
    }
    setSaving(true)
    const epochAtSave = editEpochRef.current
    try {
      const records = roster.map((emp) => ({
        employee_id: emp.id,
        att_date: selectedDate,
        status: emp.status,
        photo_url: emp.photo_url,
      }))

      const result = await attendanceRepository.saveRoster(supabase, records, selectedSite)
      const parts: string[] = []
      if (result.upserted > 0) parts.push(`${result.upserted} mark(s) saved`)
      if (result.cleared > 0) parts.push(`${result.cleared} cleared`)
      toast.success(parts.length ? parts.join(', ') : 'Attendance updated')

      // If the user marked/unmarked while save was in flight, keep their draft
      // and leave Save enabled for the next persist.
      if (editEpochRef.current !== epochAtSave) {
        return
      }
      isDirtyRef.current = false
      setIsDirty(false)
      await loadRoster({ force: true })
    } catch (error: unknown) {
      const message = toErrorMessage(error)
      console.error('Attendance save failed:', message)
      toast.error(`Error saving attendance: ${message}`)
      // Re-check lock state if DB rejected due to finalize
      if (/finalized/i.test(message)) {
        setPayrollLocked(true)
        isDirtyRef.current = false
        setIsDirty(false)
        await loadRoster({ force: true })
      }
    } finally {
      setSaving(false)
    }
  }

  const adjustDate = (days: number) => {
    const cur = new Date(selectedDate)
    const next = addDays(cur, days)
    setSelectedDate(format(next, 'yyyy-MM-dd'))
  }

  const markAllPresent = () => {
    if (payrollLocked) {
      toast.error('This month is payroll-finalized — attendance is read-only')
      return
    }
    editEpochRef.current += 1
    isDirtyRef.current = true
    setIsDirty(true)
    setRoster((prev) => prev.map((emp) => ({ ...emp, status: 'present' as const })))
    toast.success("All marked Present (don't forget to click Save)")
  }

  const markedCount = roster.filter((e) => e.status).length
  const periodLabel = selectedDate.slice(0, 7)

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Daily Muster Roll"
        actions={
          <>
            <button
              className="btn btn-secondary"
              onClick={markAllPresent}
              disabled={roster.length === 0 || payrollLocked}
            >
              Mark All Present
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="attendance-save"
              onClick={saveAttendance}
              disabled={saving || roster.length === 0 || payrollLocked || !isDirty}
            >
              {saving ? (
                <>
                  <Loader2 className="spinner" size={16} /> Saving
                </>
              ) : (
                <>
                  <Save size={16} /> Save
                </>
              )}
            </button>
          </>
        }
      />

      {/* Date Navigation */}
      <div className="card mb-4" style={{ padding: '0.875rem 1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {sites.length > 1 && (
            <select
              className="form-input form-select"
              style={{ flex: 1, minWidth: '140px' }}
              value={selectedSite}
              onChange={(e) => setSelectedSite(e.target.value)}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              flex: 1,
              minWidth: '220px',
            }}
          >
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={() => adjustDate(-1)}
              title="Previous Day"
            >
              <ChevronLeft size={16} />
            </button>
            <input
              type="date"
              className="form-input"
              style={{ textAlign: 'center' }}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              onClick={() => adjustDate(1)}
              title="Next Day"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        {!loading && roster.length > 0 && (
          <div
            style={{
              marginTop: '0.65rem',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
            }}
          >
            {markedCount} of {roster.length} marked
            {isDirty ? ' · unsaved changes' : ''}
          </div>
        )}
      </div>

      {payrollLocked && (
        <div
          className="card mb-4"
          role="status"
          style={{
            padding: '0.875rem 1rem',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'flex-start',
            background: 'rgba(245,158,11,0.12)',
            border: '1px solid rgba(245,158,11,0.35)',
          }}
        >
          <Lock size={18} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: '0.85rem', lineHeight: 1.45, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-main)' }}>
              Payroll finalized for {periodLabel}
            </strong>
            <div style={{ marginTop: '0.25rem' }}>
              Attendance for this month is <strong>read-only</strong>. Existing marks are shown
              below but cannot be changed. There is no unlock for finalized payroll — correct
              attendance before finalizing next time, or reverse payroll policy with your admin
              process if your team supports draft re-open.
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: '72px', borderRadius: 'var(--radius)' }} />
          ))}
        </div>
      ) : roster.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Employees Found</div>
          <div className="empty-desc">Please register employees under this mine site first.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {roster.map((emp) => {
            const selected = STATUSES.find((s) => s.key === emp.status)
            return (
              <div
                key={emp.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '0.875rem 1.25rem',
                  borderBottom: '1px solid var(--border-subtle)',
                  gap: '0.75rem',
                  opacity: payrollLocked ? 0.95 : 1,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                    <label
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: payrollLocked ? 'default' : 'pointer',
                        overflow: 'hidden',
                        flexShrink: 0,
                        position: 'relative',
                      }}
                    >
                      {emp.uploading ? (
                        <Loader2 className="spinner" size={14} />
                      ) : emp.display_photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={emp.display_photo_url}
                          alt={emp.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          loading="lazy"
                        />
                      ) : (
                        <Camera size={16} style={{ color: 'var(--text-muted)' }} />
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: 'none' }}
                        disabled={emp.uploading || payrollLocked}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) void handlePhotoUpload(emp.id, file)
                        }}
                      />
                    </label>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{emp.name}</div>
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)',
                          textTransform: 'capitalize',
                        }}
                      >
                        {emp.role} • {emp.wage_type === 'monthly' ? 'Monthly' : `₹${emp.wage_rate}/day`}
                      </div>
                      <div
                        style={{
                          marginTop: '0.2rem',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: emp.status ? 'var(--text-main)' : 'var(--text-muted)',
                        }}
                      >
                        Status:{' '}
                        <span
                          style={{
                            color: selected
                              ? selected.color === 'present'
                                ? 'var(--success)'
                                : selected.color === 'absent'
                                  ? 'var(--danger)'
                                  : selected.color === 'leave'
                                    ? 'var(--info)'
                                    : 'var(--accent)'
                              : 'var(--text-muted)',
                          }}
                        >
                          {statusLabel(emp.status)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* CSS uses selected-present | selected-absent | selected-half | selected-leave */}
                  <div className="att-btn-group attendance-toggles" role="group" aria-label={`Mark ${emp.name}`}>
                    {STATUSES.map((st) => {
                      const isOn = emp.status === st.key
                      return (
                        <button
                          key={st.key}
                          type="button"
                          className={`att-btn ${isOn ? `selected-${st.color}` : ''}`}
                          onClick={() => handleStatusChange(emp.id, st.key)}
                          title={st.full}
                          aria-pressed={isOn}
                          disabled={payrollLocked}
                        >
                          {st.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
