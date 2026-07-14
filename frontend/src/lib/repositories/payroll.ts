import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { endOfMonth, format } from 'date-fns'

export const payrollRepository = {
  async listRuns(supabase: SupabaseClient<Database>, siteId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from('payroll_runs')
      .select('*, sites(name)')
      .eq('site_id', siteId)
      .order('period_month', { ascending: false })
      .limit(200)

    if (error) throw error
    return data || []
  },

  async listLines(supabase: SupabaseClient<Database>, runId: string): Promise<any[]> {
    const { data, error } = await supabase
      .from('payroll_lines')
      .select('*, employees(name, phone)')
      .eq('payroll_run_id', runId)
      .limit(500)

    if (error) throw error
    return data || []
  },

  async checkExistingRun(supabase: SupabaseClient<Database>, siteId: string, periodDate: string): Promise<any> {
    const { data, error } = await supabase
      .from('payroll_runs')
      .select('*')
      .eq('site_id', siteId)
      .eq('period_month', periodDate)
      .maybeSingle()

    if (error) throw error
    return data
  },

  async deleteDraftRun(supabase: SupabaseClient<Database>, runId: string): Promise<void> {
    const { error: linesError } = await supabase
      .from('payroll_lines')
      .delete()
      .eq('payroll_run_id', runId)

    if (linesError) throw linesError

    const { error: runError } = await supabase
      .from('payroll_runs')
      .delete()
      .eq('id', runId)

    if (runError) throw runError
  },

  async generate(supabase: SupabaseClient<Database>, siteId: string, periodMonth: string): Promise<{ run: any; lines: any[] }> {
    const periodDate = periodMonth + '-01'
    const periodStart = new Date(periodDate)
    const periodEnd = endOfMonth(periodStart)

    // Insert new run
    const { data: newRun, error: insertError } = await supabase
      .from('payroll_runs')
      .insert({
        site_id: siteId,
        period_month: periodDate,
        status: 'draft',
      })
      .select()
      .single()

    let activeRun = newRun
    if (insertError) {
      if (insertError.code === '23505') {
        const { data: retryRun, error: retryError } = await supabase
          .from('payroll_runs')
          .select('*')
          .eq('site_id', siteId)
          .eq('period_month', periodDate)
          .single()

        if (retryError) throw retryError
        if (retryRun?.status === 'finalized') {
          throw new Error('Payroll has already been finalized for this period by another user.')
        }

        // Clean slate
        await supabase.from('payroll_lines').delete().eq('payroll_run_id', retryRun.id)
        activeRun = retryRun
      } else {
        throw insertError
      }
    }

    if (!activeRun) throw new Error('Failed to create or resolve payroll run')

    // Fetch active employees
    const { data: employees, error: empError } = await supabase
      .from('employees')
      .select('*')
      .eq('site_id', siteId)
      .eq('active', true)
      .limit(500)

    if (empError) throw empError
    if (!employees || employees.length === 0) {
      throw new Error('No active employees found at this site for this period.')
    }

    // Fetch attendance records
    const empIds = employees.map(e => e.id)
    const { data: allAtt, error: attError } = await supabase
      .from('attendance')
      .select('employee_id, status')
      .in('employee_id', empIds)
      .gte('att_date', format(periodStart, 'yyyy-MM-dd'))
      .lte('att_date', format(periodEnd, 'yyyy-MM-dd'))
      .limit(20000)

    if (attError) throw attError

    const attMap: Record<string, string[]> = {}
    for (const att of allAtt || []) {
      if (!attMap[att.employee_id]) attMap[att.employee_id] = []
      attMap[att.employee_id].push(att.status)
    }

    const linesToInsert = []
    for (const emp of employees) {
      const statuses = attMap[emp.id] || []
      const present = statuses.filter(s => s === 'present').length
      const halfDay = statuses.filter(s => s === 'half-day').length
      const leave = statuses.filter(s => s === 'leave').length
      const absent = statuses.filter(s => s === 'absent').length
      
      const wageType = emp.wage_type || 'daily'
      let computed = 0
      if (wageType === 'monthly') {
        computed = emp.wage_rate
      } else {
        computed = (present + halfDay * 0.5) * emp.wage_rate
      }
      const finalComputed = Math.round(computed * 100) / 100

      linesToInsert.push({
        payroll_run_id: activeRun.id,
        employee_id: emp.id,
        days_present: present,
        days_leave: leave,
        days_absent: absent,
        base_rate: emp.wage_rate,
        computed_amount: finalComputed,
        adjustment: 0,
        final_amount: finalComputed,
      })
    }

    const { data: insertedLines, error: linesError } = await supabase
      .from('payroll_lines')
      .insert(linesToInsert)
      .select('*, employees(name, phone)')

    if (linesError) {
      await supabase.from('payroll_runs').delete().eq('id', activeRun.id)
      throw linesError
    }

    return {
      run: activeRun,
      lines: insertedLines || [],
    }
  },

  async finalize(supabase: SupabaseClient<Database>, runId: string): Promise<void> {
    const { error } = await supabase
      .from('payroll_runs')
      .update({ status: 'finalized' })
      .eq('id', runId)

    if (error) throw error
  }
}
