'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { Play, CheckCircle, DollarSign } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site, PayrollRun, PayrollLine } from '@/lib/supabase/types'
import toast from 'react-hot-toast'

interface ExtendedPayrollRun extends PayrollRun {
  sites?: {
    name: string
  } | null
}

interface ExtendedPayrollLine extends PayrollLine {
  employees?: {
    name: string
    phone: string | null
  } | null
}

export default function PayrollPage() {
  const { isAdmin, isSiteManager, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [runs, setRuns] = useState<ExtendedPayrollRun[]>([])
  const [selectedRun, setSelectedRun] = useState<ExtendedPayrollRun | null>(null)
  const [lines, setLines] = useState<ExtendedPayrollLine[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [period, setPeriod] = useState(format(startOfMonth(new Date()), 'yyyy-MM'))
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

  useEffect(() => { if (selectedSite) loadRuns() }, [selectedSite])

  const loadRuns = async () => {
    const { data, error } = await supabase
      .from('payroll_runs')
      .select('*, sites(name)')
      .eq('site_id', selectedSite)
      .order('period_month', { ascending: false })
      .limit(200)
    if (error) {
      toast.error(`Error loading payroll runs: ${error.message}`)
    } else {
      setRuns((data as any) || [])
    }
  }

  const loadLines = async (run: ExtendedPayrollRun) => {
    setLoading(true)
    setSelectedRun(run)
    const { data, error } = await supabase
      .from('payroll_lines')
      .select('*, employees(name, phone)')
      .eq('payroll_run_id', run.id)
      .limit(500)
    if (error) {
      toast.error(`Error loading payroll lines: ${error.message}`)
    } else {
      setLines((data as any) || [])
    }
    setLoading(false)
  }

  const generatePayroll = async () => {
    setGenerating(true)
    const periodDate = period + '-01'

    const { data: existingRun, error: checkError } = await supabase
      .from('payroll_runs')
      .select('*')
      .eq('site_id', selectedSite)
      .eq('period_month', periodDate)
      .maybeSingle()

    if (checkError) {
      toast.error(`Error checking existing payroll: ${checkError.message}`)
      setGenerating(false)
      return
    }

    if (existingRun) {
      if (existingRun.status === 'finalized') {
        toast.error('Payroll has already been finalized for this period and cannot be re-generated.')
        setGenerating(false)
        return
      }
      
      if (confirm('A draft payroll run already exists for this period. Overwrite?')) {
        const { error: delLinesError } = await supabase.from('payroll_lines').delete().eq('payroll_run_id', existingRun.id)
        if (delLinesError) {
          toast.error(`Error clearing previous payroll lines: ${delLinesError.message}`)
          setGenerating(false)
          return
        }
        const { error: delRunError } = await supabase.from('payroll_runs').delete().eq('id', existingRun.id)
        if (delRunError) {
          toast.error(`Error clearing previous payroll run: ${delRunError.message}`)
          setGenerating(false)
          return
        }
      } else {
        setGenerating(false)
        return
      }
    }

    const { data: newRun, error: insertError } = await supabase.from('payroll_runs').insert({
      site_id: selectedSite,
      period_month: periodDate,
      status: 'draft',
    }).select().single()

    let activeRun = newRun
    if (insertError) {
      if (insertError.code === '23505') {
        const { data: retryRun, error: retryError } = await supabase
          .from('payroll_runs')
          .select('*')
          .eq('site_id', selectedSite)
          .eq('period_month', periodDate)
          .single()

        if (retryError) {
          toast.error(`Failed to resolve concurrent payroll run: ${retryError.message}`)
          setGenerating(false)
          return
        }

        if (retryRun?.status === 'finalized') {
          toast.error('Payroll has already been finalized for this period by another user.')
          setGenerating(false)
          return
        }

        await supabase.from('payroll_lines').delete().eq('payroll_run_id', retryRun.id)
        activeRun = retryRun
      } else {
        toast.error(`Failed to create payroll run: ${insertError.message}`)
        setGenerating(false)
        return
      }
    }

    if (activeRun) {
      const periodStart = new Date(periodDate)
      const periodEnd = endOfMonth(periodStart)
      
      const { data: employees, error: empError } = await supabase.from('employees').select('*')
        .eq('site_id', selectedSite).eq('active', true).limit(500)

      if (empError) {
        toast.error(`Error loading employees: ${empError.message}`)
        setGenerating(false)
        return
      }

      if (!employees || employees.length === 0) {
        toast.error('No active employees found at this site for this period.')
        setGenerating(false)
        return
      }

      const empIds = employees.map(e => e.id)
      const { data: allAtt, error: attError } = await supabase.from('attendance').select('employee_id, status')
        .in('employee_id', empIds)
        .gte('att_date', format(periodStart, 'yyyy-MM-dd'))
        .lte('att_date', format(periodEnd, 'yyyy-MM-dd'))
        .limit(20000)

      if (attError) {
        toast.error(`Error loading attendance records: ${attError.message}`)
        setGenerating(false)
        return
      }

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

      const { error: linesError } = await supabase.from('payroll_lines').insert(linesToInsert)
      if (linesError) {
        await supabase.from('payroll_runs').delete().eq('id', activeRun.id)
        toast.error(`Failed to save payroll lines: ${linesError.message}`)
      } else {
        toast.success('Payroll run generated successfully')
        loadRuns()
        loadLines(activeRun)
      }
    }
    setGenerating(false)
  }

  const finalizeRun = async (runId: string) => {
    const { error } = await supabase.from('payroll_runs').update({ status: 'finalized' }).eq('id', runId)
    if (error) {
      toast.error(`Error finalizing payroll run: ${error.message}`)
    } else {
      toast.success('Payroll run finalized')
      loadRuns()
      if (selectedRun?.id === runId) setSelectedRun(r => r ? { ...r, status: 'finalized' } : r)
    }
  }

  const totalPayroll = lines.reduce((s, l) => s + (l.final_amount !== undefined && l.final_amount !== null ? l.final_amount : (l.computed_amount + l.adjustment)), 0)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll</h1>
          <p className="page-subtitle">Monthly Salary Computation</p>
        </div>
      </div>

      {/* Generate controls */}
      <div className="card mb-4">
        <h3 style={{ fontSize: '0.875rem', marginBottom: '0.875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Generate Payroll
        </h3>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {sites.length > 1 && (
            <div style={{ flex: 1, minWidth: '140px' }}>
              <label className="form-label">Site</label>
              <select className="form-input form-select" value={selectedSite}
                onChange={e => setSelectedSite(e.target.value)}>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ flex: 1, minWidth: '140px' }}>
            <label className="form-label">Period</label>
            <input type="month" className="form-input" value={period}
              onChange={e => setPeriod(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={generatePayroll} disabled={generating}>
            {generating ? <span className="spinner" /> : <><Play size={16} /> Generate</>}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '1rem' }}>
        {/* Run List */}
        <div>
          <h3 style={{ fontSize: '0.875rem', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
            Payroll Runs
          </h3>
          {runs.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <DollarSign size={32} style={{ color: 'var(--text-muted)' }} />
              <div className="empty-title">No payroll runs yet</div>
              <div className="empty-desc">Generate your first payroll above</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {runs.map(run => (
                <div
                  key={run.id}
                  className="card"
                  style={{
                    cursor: 'pointer',
                    border: selectedRun?.id === run.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                    display: 'flex', alignItems: 'center', gap: '1rem',
                  }}
                  onClick={() => loadLines(run)}
                >
                  <div style={{
                    width: '44px', height: '44px',
                    background: run.status === 'finalized' ? 'var(--success-muted)' : 'var(--accent-muted)',
                    borderRadius: 'var(--radius)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: run.status === 'finalized' ? 'var(--success)' : 'var(--accent)',
                  }}>
                    {run.status === 'finalized' ? <CheckCircle size={22} /> : <DollarSign size={22} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontFamily: 'var(--font-display)' }}>
                      {format(new Date(run.period_month), 'MMMM yyyy')}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {run.sites?.name}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span className={`badge ${run.status === 'finalized' ? 'badge-green' : 'badge-amber'}`}>
                      {run.status}
                    </span>
                    {run.status !== 'finalized' && (
                      <button
                        className="btn btn-success btn-sm"
                        onClick={e => { e.stopPropagation(); finalizeRun(run.id) }}
                      >
                        Finalize
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Run Detail */}
        {selectedRun && (
          <div>
            <h3 style={{ fontSize: '0.875rem', marginBottom: '0.75rem', color: 'var(--text-muted)' }}>
              {format(new Date(selectedRun.period_month), 'MMMM yyyy')} — ₹{totalPayroll.toLocaleString('en-IN')} Total
            </h3>
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>P</th>
                    <th>L</th>
                    <th>A</th>
                    <th>Rate</th>
                    <th>Computed</th>
                    <th>Adj</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Loading...</td></tr>
                  ) : lines.map(line => (
                    <tr key={line.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{line.employees?.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{line.employees?.phone}</div>
                      </td>
                      <td><span className="badge badge-green">{line.days_present}</span></td>
                      <td><span className="badge badge-blue">{line.days_leave}</span></td>
                      <td><span className="badge badge-red">{line.days_absent}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>₹{line.base_rate}</td>
                      <td>₹{line.computed_amount.toLocaleString('en-IN')}</td>
                      <td style={{ color: line.adjustment >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {line.adjustment !== 0 ? `${line.adjustment > 0 ? '+' : ''}₹${line.adjustment}` : '—'}
                      </td>
                      <td>
                        <strong style={{ fontFamily: 'var(--font-display)' }}>
                          ₹{(line.final_amount !== undefined && line.final_amount !== null ? line.final_amount : (line.computed_amount + line.adjustment)).toLocaleString('en-IN')}
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--bg-elevated)' }}>
                    <td colSpan={7} style={{ fontWeight: 700, padding: '0.875rem 1rem' }}>Total Payroll</td>
                    <td style={{ fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--accent)', fontSize: '1.05rem' }}>
                      ₹{totalPayroll.toLocaleString('en-IN')}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
