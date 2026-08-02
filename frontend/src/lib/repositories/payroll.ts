import { SupabaseClient } from '@supabase/supabase-js'
import { Database } from '../supabase/database.types'
import { computePayrollWage, eligiblePayrollDays, payrollPeriodBounds } from '../calculations'

type PayrollRunRow = Database['public']['Tables']['payroll_runs']['Row']
type PayrollLineRow = Database['public']['Tables']['payroll_lines']['Row']

export type PayrollRunWithSite = PayrollRunRow & {
  sites?: { name: string } | null
}

export type PayrollLineWithEmployee = PayrollLineRow & {
  employees?: { name: string; phone: string | null } | null
}

export const payrollRepository = {
  async listRuns(supabase: SupabaseClient<Database>, siteId: string): Promise<PayrollRunWithSite[]> {
    const { data, error } = await supabase
      .from('payroll_runs')
      .select('*, sites(name)')
      .eq('site_id', siteId)
      .order('period_month', { ascending: false })
      .limit(200)

    if (error) throw error
    return (data as PayrollRunWithSite[]) || []
  },

  async listLines(supabase: SupabaseClient<Database>, runId: string): Promise<PayrollLineWithEmployee[]> {
    const { data, error } = await supabase
      .from('payroll_lines')
      .select('*, employees(name, phone)')
      .eq('payroll_run_id', runId)
      .limit(500)

    if (error) throw error
    return (data as PayrollLineWithEmployee[]) || []
  },

  async checkExistingRun(
    supabase: SupabaseClient<Database>,
    siteId: string,
    periodDate: string
  ): Promise<PayrollRunRow | null> {
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
    const { data: run, error: checkError } = await supabase
      .from('payroll_runs')
      .select('status')
      .eq('id', runId)
      .maybeSingle()

    if (checkError) throw checkError
    if (!run) throw new Error('Payroll run not found')
    if (run.status !== 'draft') {
      throw new Error('Cannot delete a finalized payroll run')
    }

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

  async generate(
    supabase: SupabaseClient<Database>,
    siteId: string,
    periodMonth: string
  ): Promise<{ run: PayrollRunRow; lines: PayrollLineWithEmployee[] }> {
    // Local calendar bounds — never `new Date('yyyy-MM-dd')` (UTC shift risk)
    const { periodDate, periodDays, startIso, endIso } = payrollPeriodBounds(periodMonth)

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

    let activeRun: PayrollRunRow | null = newRun
    const isNewRun = !insertError
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

        // Clean slate - atomically check status and delete lines using PG lock
        const { error: regenError } = await supabase.rpc('regenerate_payroll_run', { p_run_id: retryRun.id })
        if (regenError) {
          const msg = regenError.message || ''
          if (msg.includes('finalized')) {
            throw new Error('Payroll has already been finalized for this period by another user.')
          }
          if (/forbidden|outside your|insufficient_privilege/i.test(msg)) {
            throw new Error('You do not have permission to regenerate this payroll run.')
          }
          throw regenError
        }
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

    // Fetch attendance records (inclusive local calendar range)
    const empIds = employees.map(e => e.id)
    const { data: allAtt, error: attError } = await supabase
      .from('attendance')
      .select('employee_id, status, att_date')
      .in('employee_id', empIds)
      .gte('att_date', startIso)
      .lte('att_date', endIso)
      .limit(20000)

    if (attError) throw attError

    const attMap: Record<string, { status: string; att_date: string }[]> = {}
    for (const att of allAtt || []) {
      if (!attMap[att.employee_id]) attMap[att.employee_id] = []
      attMap[att.employee_id].push({ status: att.status, att_date: String(att.att_date).slice(0, 10) })
    }
    const linesToInsert = []
    for (const emp of employees) {
      const eligibleDays = eligiblePayrollDays(emp.join_date, startIso, endIso)
      if (eligibleDays <= 0) continue

      const joinIso = emp.join_date ? String(emp.join_date).slice(0, 10) : null
      const statuses = (attMap[emp.id] || [])
        .filter((a) => !joinIso || a.att_date >= joinIso)
        .map((a) => a.status)
      const present = statuses.filter(s => s === 'present').length
      const halfDay = statuses.filter(s => s === 'half-day').length
      const leave = statuses.filter(s => s === 'leave').length
      const absent = statuses.filter(s => s === 'absent').length

      const wageType = emp.wage_type || 'daily'
      const finalComputed = computePayrollWage(
        { wage_type: wageType, wage_rate: emp.wage_rate },
        { present, halfDay, leave, absent },
        periodDays,
        eligibleDays
      )

      linesToInsert.push({
        payroll_run_id: activeRun.id,
        employee_id: emp.id,
        days_present: present,
        days_half_day: halfDay,
        days_leave: leave,
        days_absent: absent,
        base_rate: emp.wage_rate,
        computed_amount: finalComputed,
        adjustment: 0,
        final_amount: finalComputed,
      })
    }

    if (linesToInsert.length === 0) {
      if (isNewRun) {
        await supabase.from('payroll_runs').delete().eq('id', activeRun.id)
      }
      throw new Error('No employees were eligible for this payroll period (check join dates).')
    }

    const { data: insertedLines, error: linesError } = await supabase
      .from('payroll_lines')
      .upsert(linesToInsert, { onConflict: 'payroll_run_id,employee_id' })
      .select('*, employees(name, phone)')

    if (linesError) {
      if (isNewRun) {
        await supabase.from('payroll_runs').delete().eq('id', activeRun.id)
      }
      throw linesError
    }

    return {
      run: activeRun,
      lines: (insertedLines as PayrollLineWithEmployee[]) || [],
    }
  },

  async finalize(supabase: SupabaseClient<Database>, runId: string): Promise<void> {
    // Atomic draft → finalized with row lock + role checks inside the RPC
    const { error } = await supabase.rpc('finalize_payroll_run', { p_run_id: runId })
    if (error) {
      const msg = error.message || ''
      if (/no lines|no payroll lines/i.test(msg)) {
        throw new Error('Cannot finalize payroll with no lines. Generate payroll first.')
      }
      throw error
    }
  },

  /**
   * Adjust a draft payroll line. final_amount = computed_amount + adjustment.
   * Finalized runs are blocked by DB trigger check_payroll_run_not_finalized.
   */
  async updateLineAdjustment(
    supabase: SupabaseClient<Database>,
    lineId: string,
    adjustment: number,
    runStatus?: string | null
  ): Promise<PayrollLineWithEmployee> {
    const adj = Number(adjustment)
    if (Number.isNaN(adj)) {
      throw new Error('Adjustment must be a number')
    }
    if (runStatus === 'finalized') {
      throw new Error('Cannot adjust a finalized payroll run')
    }

    const { data: line, error: loadError } = await supabase
      .from('payroll_lines')
      .select('id, payroll_run_id, computed_amount')
      .eq('id', lineId)
      .maybeSingle()

    if (loadError) throw loadError
    if (!line) throw new Error('Payroll line not found')

    const computed = Number(line.computed_amount) || 0
    const finalAmount = Math.round((computed + adj + 1e-9) * 100) / 100

    const { data: updated, error: updateError } = await supabase
      .from('payroll_lines')
      .update({
        adjustment: adj,
        final_amount: finalAmount,
      })
      .eq('id', lineId)
      .select('*, employees(name, phone)')
      .single()

    if (updateError) throw updateError
    return updated as PayrollLineWithEmployee
  },
}
