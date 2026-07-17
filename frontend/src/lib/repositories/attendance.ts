import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { Employee, Attendance } from '../supabase/types'

export interface RosterEmployee extends Employee {
  att_id: string | null
  status: 'present' | 'absent' | 'half-day' | 'leave'
  photo_url: string | null
  display_photo_url: string | null
  uploading: boolean
}

export const attendanceRepository = {
  async listRoster(
    supabase: SupabaseClient<Database>,
    siteId: string,
    date: string
  ): Promise<RosterEmployee[]> {
    // Get employees
    const { data: employees, error: empError } = await supabase

      .from('employees')
      .select('id, name, role, wage_type, wage_rate, site_id, phone, active, join_date, created_at, updated_at, leave_balance, user_id')
      .eq('active', true)
      .order('name')
      .limit(500)

    if (empError) throw empError

    // Get existing attendance
    const empIds = (employees || []).map(e => e.id)
    const { data: att, error: attError } = empIds.length > 0
      ? await supabase
          .from('attendance')
          .select('*')
          .in('employee_id', empIds)
          .eq('att_date', date)
          .limit(1000)
      : { data: [], error: null }

    if (attError) throw attError

    const attMap = Object.fromEntries((att || []).map(a => [a.employee_id, a]))

    // Map roster and dynamically generate signed URL
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
        status: (dbRecord?.status as any) || 'present',
        photo_url: dbRecord?.photo_url || null,
        display_photo_url: displayPhotoUrl,
        uploading: false,
      }
    }))

    return rosterData
  },

  async saveRoster(
    supabase: SupabaseClient<Database>,
    records: Array<{
      employee_id: string
      att_date: string
      status: 'present' | 'absent' | 'half-day' | 'leave'
      photo_url: string | null
    }>
  ): Promise<void> {
    const { error } = await supabase
      .from('attendance')
      .upsert(records, { onConflict: 'employee_id,att_date' })

    if (error) throw error
  }
}
