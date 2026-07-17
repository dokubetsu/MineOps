import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { Employee } from '../supabase/types'

export type AttendanceStatus = 'present' | 'absent' | 'half-day' | 'leave'

/** Roster row — status is null until explicitly marked (never invent "present"). */
export interface RosterEmployee extends Employee {
  att_id: string | null
  status: AttendanceStatus | null
  photo_url: string | null
  display_photo_url: string | null
  uploading: boolean
}

function normalizeStatus(status: string | null | undefined): AttendanceStatus | null {
  if (status === 'present' || status === 'absent' || status === 'half-day' || status === 'leave') {
    return status
  }
  return null
}

export const attendanceRepository = {
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

    const rosterData = await Promise.all(
      (employees || []).map(async (emp) => {
        const dbRecord = attMap[emp.id]
        let displayPhotoUrl: string | null = null
        if (dbRecord?.photo_url) {
          let path = dbRecord.photo_url
          if (path.includes('attendance-photos/')) {
            path = path.split('attendance-photos/').pop() || path
          }
          const { data: signedData } = await supabase.storage
            .from('attendance-photos')
            .createSignedUrl(path, 3600)
          displayPhotoUrl = signedData?.signedUrl || null
        }

        return {
          ...emp,
          att_id: dbRecord?.id || null,
          status: normalizeStatus(dbRecord?.status),
          photo_url: dbRecord?.photo_url || null,
          display_photo_url: displayPhotoUrl,
          uploading: false,
        } as RosterEmployee
      })
    )

    return rosterData
  },

  async saveRoster(
    supabase: SupabaseClient<Database>,
    records: Array<{
      employee_id: string
      att_date: string
      status: AttendanceStatus | null
      photo_url: string | null
    }>,
    siteId: string
  ): Promise<void> {
    if (!siteId) throw new Error('Site is required to save attendance')
    if (records.length === 0) return

    // Resolve organization_id from the site — required NOT NULL + RLS WITH CHECK
    const { data: site, error: siteError } = await supabase
      .from('sites')
      .select('id, organization_id')
      .eq('id', siteId)
      .maybeSingle()

    if (siteError) throw siteError
    if (!site?.organization_id) {
      throw new Error('Site is missing organization_id — cannot save attendance')
    }

    // Never persist invent-present rows — only explicitly marked statuses
    const markedRecords = records.filter(
      (r): r is typeof r & { status: AttendanceStatus } =>
        r.status === 'present' ||
        r.status === 'absent' ||
        r.status === 'half-day' ||
        r.status === 'leave'
    )
    if (markedRecords.length === 0) {
      throw new Error(
        'No attendance marks to save. Mark each employee Present / Absent / Half / Leave first.'
      )
    }

    const empIds = markedRecords.map((r) => r.employee_id)
    const { data: valid, error: validError } = await supabase
      .from('employees')
      .select('id, organization_id, site_id')
      .in('id', empIds)
      .eq('site_id', siteId)

    if (validError) throw validError

    const validById = new Map((valid || []).map((e) => [e.id, e]))
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const safeRecords = markedRecords
      .filter((r) => validById.has(r.employee_id))
      .map((r) => {
        const emp = validById.get(r.employee_id)!
        return {
          employee_id: r.employee_id,
          att_date: r.att_date,
          status: r.status,
          photo_url: r.photo_url,
          // Explicit org stamp so RLS WITH CHECK (organization_id = get_user_organization_id())
          // succeeds even if the BEFORE INSERT trigger is missing on a partial migrate.
          organization_id: emp.organization_id || site.organization_id,
          marked_by: user?.id ?? null,
        }
      })

    if (safeRecords.length === 0) {
      throw new Error('No valid employees at this site to save attendance for')
    }

    // Upsert on unique (employee_id, att_date). Prefer explicit columns only.
    const { error } = await supabase.from('attendance').upsert(safeRecords, {
      onConflict: 'employee_id,att_date',
      ignoreDuplicates: false,
    })

    if (error) {
      // Surface common production failures clearly
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
      throw error
    }
  },
}
