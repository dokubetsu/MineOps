import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { leaveDaysBetween } from '../calculations'

export type LeaveStatus = 'pending' | 'approved' | 'rejected'

export interface LeaveApplicationRow {
  id: string
  employee_id: string
  from_date: string
  to_date: string
  reason: string | null
  status: LeaveStatus
  created_at: string | null
  updated_at: string | null
  employees?: {
    name: string
    site_id: string | null
  } | null
}

export interface LeaveEmployeeOption {
  id: string
  name: string
  site_id: string | null
}

export class LeaveError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'validation'
      | 'forbidden'
      | 'balance'
      | 'payroll_locked'
      | 'not_pending'
      | 'overwrite'
      | 'unknown'
  ) {
    super(message)
    this.name = 'LeaveError'
  }
}

function mapApproveError(msg: string): LeaveError {
  if (/insufficient leave balance/i.test(msg)) {
    return new LeaveError(msg, 'balance')
  }
  if (/payroll is already finalized/i.test(msg)) {
    return new LeaveError(msg, 'payroll_locked')
  }
  if (/overwrite|force approve/i.test(msg)) {
    return new LeaveError(msg, 'overwrite')
  }
  if (/forbidden|insufficient_privilege|outside your/i.test(msg)) {
    return new LeaveError(
      'You do not have permission to approve this leave application',
      'forbidden'
    )
  }
  if (/not found or not pending/i.test(msg)) {
    return new LeaveError(
      'Leave is no longer pending (already approved/rejected or removed)',
      'not_pending'
    )
  }
  return new LeaveError(msg, 'unknown')
}

export const leaveRepository = {
  async listEmployees(
    supabase: SupabaseClient<Database>
  ): Promise<LeaveEmployeeOption[]> {
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, site_id')
      .eq('active', true)
      .order('name')
      .limit(500)

    if (error) throw error
    return (data || []) as LeaveEmployeeOption[]
  },

  async listApplications(
    supabase: SupabaseClient<Database>,
    employeeIds: string[],
    status: LeaveStatus | 'all'
  ): Promise<LeaveApplicationRow[]> {
    if (employeeIds.length === 0) return []

    let query = supabase
      .from('leave_applications')
      .select('*, employees(name, site_id)')
      .in('employee_id', employeeIds)
      .order('created_at', { ascending: false })
      .limit(500)

    if (status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, error } = await query
    if (error) throw error
    return (data as LeaveApplicationRow[]) || []
  },

  validateRange(fromDate: string, toDate: string): number {
    const days = leaveDaysBetween(fromDate, toDate)
    if (days < 1) {
      throw new LeaveError('From Date must be less than or equal to To Date', 'validation')
    }
    if (days > 30) {
      throw new LeaveError('Leave duration cannot exceed 30 days per application', 'validation')
    }
    return days
  },

  async submit(
    supabase: SupabaseClient<Database>,
    payload: {
      employee_id: string
      from_date: string
      to_date: string
      reason: string | null
    }
  ): Promise<void> {
    this.validateRange(payload.from_date, payload.to_date)

    const { error } = await supabase.from('leave_applications').insert({
      employee_id: payload.employee_id,
      from_date: payload.from_date,
      to_date: payload.to_date,
      reason: payload.reason,
      status: 'pending',
    })

    if (error) throw error
  },

  /**
   * Approve leave. If existing non-leave attendance would be overwritten,
   * RPC raises overwrite error unless force=true (user confirmed).
   */
  async approve(
    supabase: SupabaseClient<Database>,
    applicationId: string,
    force = false
  ): Promise<void> {
    const { error } = await supabase.rpc('approve_leave_application', {
      p_application_id: applicationId,
      p_force: force,
    })
    if (!error) return
    throw mapApproveError(error.message || 'Unknown error')
  },

  /** Reverse an approved leave: restore balance, clear leave attendance, status → pending */
  async unapprove(supabase: SupabaseClient<Database>, applicationId: string): Promise<void> {
    const { error } = await supabase.rpc('unapprove_leave_application', {
      p_application_id: applicationId,
    })
    if (!error) return

    const msg = error.message || 'Unknown error'
    if (/payroll is already finalized/i.test(msg)) {
      throw new LeaveError(msg, 'payroll_locked')
    }
    if (/forbidden|insufficient_privilege|outside your/i.test(msg)) {
      throw new LeaveError('You do not have permission to reverse this leave', 'forbidden')
    }
    if (/not found or not approved/i.test(msg)) {
      throw new LeaveError('Leave is not in approved state', 'not_pending')
    }
    throw new LeaveError(msg, 'unknown')
  },

  async reject(supabase: SupabaseClient<Database>, applicationId: string): Promise<void> {
    const { error } = await supabase
      .from('leave_applications')
      .update({ status: 'rejected' })
      .eq('id', applicationId)
      .eq('status', 'pending')

    if (error) throw error
  },
}
