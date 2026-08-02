import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { Employee } from '../supabase/types'
import { signStoragePaths, normalizeStoragePath } from '../image-utils'

export type AttendanceStatus = 'present' | 'absent' | 'half-day' | 'leave'

/** Roster row — status is null until explicitly marked (never invent "present"). */
export interface RosterEmployee extends Employee {
  att_id: string | null
  status: AttendanceStatus | null
  photo_url: string | null
  display_photo_url: string | null
  uploading: boolean
}

export interface AttendanceSaveRecord {
  employee_id: string
  att_date: string
  status: AttendanceStatus | null
  photo_url: string | null
}

export interface AttendanceSaveResult {
  upserted: number
  cleared: number
}

/** Pure split for tests and save path — marked upsert vs null clear. */
export function partitionAttendanceSave(records: AttendanceSaveRecord[]): {
  toUpsert: Array<AttendanceSaveRecord & { status: AttendanceStatus }>
  toClear: AttendanceSaveRecord[]
} {
  const toUpsert: Array<AttendanceSaveRecord & { status: AttendanceStatus }> = []
  const toClear: AttendanceSaveRecord[] = []
  for (const r of records) {
    if (
      r.status === 'present' ||
      r.status === 'absent' ||
      r.status === 'half-day' ||
      r.status === 'leave'
    ) {
      toUpsert.push(r as AttendanceSaveRecord & { status: AttendanceStatus })
    } else {
      toClear.push(r)
    }
  }
  return { toUpsert, toClear }
}

function normalizeStatus(status: string | null | undefined): AttendanceStatus | null {
  if (status === 'present' || status === 'absent' || status === 'half-day' || status === 'leave') {
    return status
  }
  return null
}

export const attendanceRepository = {
  /**
   * True when the site has a finalized payroll run covering the calendar month of `date` (yyyy-MM-dd).
   * Attendance edits are blocked by DB trigger in that case (Phase 1).
   */
  async isMonthFinalized(
    supabase: SupabaseClient<Database>,
    siteId: string,
    date: string
  ): Promise<boolean> {
    if (!siteId || !date) return false
    const ym = date.slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(ym)) return false
    // payroll_runs.period_month is the first day of the month (date)
    const periodMonth = `${ym}-01`

    const { data, error } = await supabase
      .from('payroll_runs')
      .select('id, period_month')
      .eq('site_id', siteId)
      .eq('status', 'finalized')
      .limit(50)

    if (error) throw error
    return (data || []).some((r) => String(r.period_month || '').slice(0, 7) === ym || r.period_month === periodMonth)
  },

  async listRoster(
    supabase: SupabaseClient<Database>,
    siteId: string,
    date: string
  ): Promise<RosterEmployee[]> {
    if (!siteId) return []

    const { data: employees, error: empError } = await supabase
      .from('employees')
      .select(
        'id, name, role, wage_type, wage_rate, site_id, phone, active, join_date, created_at, updated_at, leave_balance, user_id, organization_id'
      )
      .eq('active', true)
      .eq('site_id', siteId)
      .order('name')
      .limit(500)

    if (empError) throw empError

    const empIds = (employees || []).map((e) => e.id)
    const { data: att, error: attError } =
      empIds.length > 0
        ? await supabase
            .from('attendance')
            .select('*')
            .in('employee_id', empIds)
            .eq('att_date', date)
            .limit(1000)
        : { data: [] as Database['public']['Tables']['attendance']['Row'][], error: null }

    if (attError) throw attError

    const attMap = Object.fromEntries((att || []).map((a) => [a.employee_id, a]))

    const photoPaths: { empId: string; path: string }[] = []
    for (const emp of employees || []) {
      const dbRecord = attMap[emp.id]
      if (dbRecord?.photo_url) {
        photoPaths.push({
          empId: emp.id,
          path: normalizeStoragePath(dbRecord.photo_url, 'attendance-photos'),
        })
      }
    }
    const signedMap = await signStoragePaths(
      supabase,
      'attendance-photos',
      photoPaths.map((p) => p.path)
    )

    const rosterData = (employees || []).map((emp) => {
      const dbRecord = attMap[emp.id]
      const normalized = dbRecord?.photo_url
        ? normalizeStoragePath(dbRecord.photo_url, 'attendance-photos')
        : null
      const displayPhotoUrl = normalized ? signedMap.get(normalized) ?? null : null

      return {
        ...emp,
        att_id: dbRecord?.id || null,
        status: normalizeStatus(dbRecord?.status),
        photo_url: dbRecord?.photo_url || null,
        display_photo_url: displayPhotoUrl,
        uploading: false,
      } as RosterEmployee
    })

    return rosterData
  },

  /**
   * Persist roster for a site/date.
   * - Marked rows (P/A/H/L) are upserted.
   * - Unmarked rows (status null) DELETE any existing attendance for that
   *   employee+date so unmark after save actually clears the DB (and leave
   *   balance restore triggers fire on real DELETE).
   */
  async saveRoster(
    supabase: SupabaseClient<Database>,
    records: AttendanceSaveRecord[],
    siteId: string
  ): Promise<AttendanceSaveResult> {
    if (!siteId) throw new Error('Site is required to save attendance')
    if (records.length === 0) {
      return { upserted: 0, cleared: 0 }
    }

    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('id, organization_id')
      .eq('id', siteId)
      .maybeSingle()

    if (siteError) throw siteError
    if (!site?.organization_id) {
      throw new Error('Site is missing organization_id — cannot save attendance')
    }

    const { toUpsert, toClear } = partitionAttendanceSave(records)

    if (toUpsert.length === 0 && toClear.length === 0) {
      throw new Error(
        'No attendance marks to save. Mark each employee Present / Absent / Half / Leave first.'
      )
    }

    const allEmpIds = [...new Set(records.map((r) => r.employee_id))]
    const { data: valid, error: validError } = await supabase
      .from('employees')
      .select('id, organization_id, site_id')
      .in('id', allEmpIds)
      .eq('site_id', siteId)

    if (validError) throw validError

    const validById = new Map((valid || []).map((e) => [e.id, e]))
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const mapDbError = (error: { message?: string; code?: string }): never => {
      const msg = error.message || 'Unknown database error'
      if (msg.includes('row-level security') || msg.includes('RLS') || error.code === '42501') {
        throw new Error(
          `Permission denied saving attendance (RLS). Ensure your role is admin/site_manager for this site and organization_id is set. Details: ${msg}`
        )
      }
      if (msg.includes('organization_id') || error.code === '23502') {
        throw new Error(
          `Attendance save failed: organization_id required. Re-run migrations 031+ or ensure employees/sites have organization_id. Details: ${msg}`
        )
      }
      if (/insufficient leave balance/i.test(msg)) {
        throw new Error(
          `Cannot mark Leave: insufficient leave balance. Use a leave application or mark Absent. Details: ${msg}`
        )
      }
      if (/payroll is already finalized/i.test(msg)) {
        throw new Error(
          'Cannot change attendance for this date: payroll is already finalized for that month. Open Payroll to view the run — finalized months are read-only (not unlockable).'
        )
      }
      throw error
    }

    // 1) Clear unmarked — DELETE so leave_balance restore (F4) runs
    let cleared = 0
    const clearEmpIds = toClear
      .map((r) => r.employee_id)
      .filter((id) => validById.has(id))
    const clearDate = toClear[0]?.att_date ?? toUpsert[0]?.att_date

    if (clearEmpIds.length > 0 && clearDate) {
      const { data: deleted, error: delError } = await supabase
        .from('attendance')
        .delete()
        .in('employee_id', clearEmpIds)
        .eq('att_date', clearDate)
        .select('id')

      if (delError) mapDbError(delError)
      cleared = deleted?.length ?? 0
    }

    // 2) Upsert marked
    const safeRecords = toUpsert
      .filter((r) => validById.has(r.employee_id))
      .map((r) => {
        const emp = validById.get(r.employee_id)!
        return {
          employee_id: r.employee_id,
          att_date: r.att_date,
          status: r.status,
          photo_url: r.photo_url,
          organization_id: emp.organization_id || site.organization_id,
          marked_by: user?.id ?? null,
        }
      })

    if (safeRecords.length === 0 && cleared === 0) {
      throw new Error(
        toUpsert.length === 0 && toClear.length > 0
          ? 'No existing attendance rows to clear for unmarked employees'
          : 'No valid employees at this site to save attendance for'
      )
    }

    if (safeRecords.length > 0) {
      const { error } = await supabase.from('attendance').upsert(safeRecords, {
        onConflict: 'employee_id,att_date',
        ignoreDuplicates: false,
      })
      if (error) mapDbError(error)
    }

    return { upserted: safeRecords.length, cleared }
  },
}
