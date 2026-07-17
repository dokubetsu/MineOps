'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, startOfMonth } from 'date-fns'
import { Play, CheckCircle, DollarSign, Trash2, ArrowLeft } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site, PayrollRun, PayrollLine } from '@/lib/supabase/types'
import { payrollRepository } from '@/lib/repositories/payroll'
import ConfirmDialog from '@/components/ConfirmDialog'
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

  // ConfirmDialog states
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmFinalizeId, setConfirmFinalizeId] = useState<string | null>(null)
  const [confirmGenerate, setConfirmGenerate] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin && !isSiteManager) {
      router.push('/dashboard')
      return
    }
    loadSites()
  }, [authLoading, isAdmin, isSiteManager])

  useEffect(() => {
    if (selectedSite) loadRuns()
  }, [selectedSite])

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

  const loadRuns = async () => {
    setLoading(true)
    try {
      const data = await payrollRepository.listRuns(supabase, selectedSite)
      setRuns(data)
    } catch (error: any) {
      toast.error(`Error loading payroll runs: ${error.message}`)
      setRuns([])
    } finally {
      setLoading(false)
    }
  }

  const selectRun = async (run: ExtendedPayrollRun) => {
    setSelectedRun(run)
    setLoading(true)
    try {
      const data = await payrollRepository.listLines(supabase, run.id)
      setLines(data)
    } catch (error: any) {
      toast.error(`Error loading payroll breakdown: ${error.message}`)
      setLines([])
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateClick = async () => {
    const periodDate = period + '-01'
    const existing = await payrollRepository.checkExistingRun(supabase, selectedSite, periodDate)
    if (existing) {
      if (existing.status === 'finalized') {
        toast.error('Payroll has already been finalized for this period and cannot be re-generated.')
        return
      }
      setConfirmGenerate(true)
    } else {
      executeGenerate()
    }
  }

  const executeGenerate = async () => {
    setConfirmGenerate(false)
    setGenerating(true)
    try {
      const result = await payrollRepository.generate(supabase, selectedSite, period)
      toast.success('Payroll run generated successfully!')
      loadRuns()
      selectRun(result.run)
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate payroll run')
    } finally {
      setGenerating(false)
    }
  }

  const executeFinalize = async () => {
    if (!confirmFinalizeId) return
    try {
      await payrollRepository.finalize(supabase, confirmFinalizeId)
      toast.success('Payroll finalized successfully')
      loadRuns()
      if (selectedRun && selectedRun.id === confirmFinalizeId) {
        setSelectedRun(prev => prev ? { ...prev, status: 'finalized' } : null)
      }
    } catch (err: any) {
      toast.error(`Error finalizing payroll: ${err.message}`)
    } finally {
      setConfirmFinalizeId(null)
    }
  }

  const executeDelete = async () => {
    if (!confirmDeleteId) return
    try {
      await payrollRepository.deleteDraftRun(supabase, confirmDeleteId)
      toast.success('Draft payroll run deleted')
      setSelectedRun(null)
      setLines([])
      loadRuns()
    } catch (err: any) {
      toast.error(`Error deleting payroll: ${err.message}`)
    } finally {
      setConfirmDeleteId(null)
    }
  }

  const totalAmount = lines.reduce((sum, line) => sum + (line.final_amount || 0), 0)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll</h1>
          <p className="page-subtitle">Site Wages & Salaries</p>
        </div>
      </div>

      {selectedRun ? (
        // Detail View
        <div>
          <button className="btn btn-secondary mb-4" onClick={() => setSelectedRun(null)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <ArrowLeft size={16} /> Back to Runs
          </button>

          <div className="card mb-4">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <span className="badge badge-amber" style={{ textTransform: 'uppercase', fontSize: '0.75rem' }}>
                  {selectedRun.status}
                </span>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.375rem' }}>
                  {format(new Date(selectedRun.period_month), 'MMMM yyyy')} Run
                </h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Total wage liability: <strong>₹{totalAmount.toLocaleString('en-IN')}</strong>
                </span>
              </div>

              {selectedRun.status === 'draft' && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-danger btn-icon" onClick={() => setConfirmDeleteId(selectedRun.id)} title="Delete Draft">
                    <Trash2 size={16} />
                  </button>
                  <button className="btn btn-primary" onClick={() => setConfirmFinalizeId(selectedRun.id)}>
                    <CheckCircle size={16} /> Finalize Wages
                  </button>
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '64px', borderRadius: 'var(--radius)' }} />)}
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {lines.map(line => (
                <div
                  key={line.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.875rem 1.25rem',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                      {line.employees?.name || 'Unknown Employee'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                      Present: {line.days_present}d • Leave: {line.days_leave}d • Absent: {line.days_absent}d (Rate: ₹{line.base_rate}/day)
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    ₹{(line.final_amount ?? 0).toLocaleString('en-IN')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        // List View
        <div>
          {/* Action Card */}
          <div className="card mb-4">
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>Generate Period Wages</h3>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {sites.length > 1 && (
                <select className="form-input form-select" style={{ flex: 1, minWidth: '150px' }}
                  value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
                  {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              <input
                type="month"
                className="form-input"
                style={{ flex: 1, minWidth: '150px' }}
                value={period}
                onChange={e => setPeriod(e.target.value)}
              />
              <button className="btn btn-primary" onClick={handleGenerateClick} disabled={generating || !selectedSite} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                {generating ? <span className="spinner" /> : <><Play size={16} /> Generate</>}
              </button>
            </div>
          </div>

          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>Payroll Runs History</h3>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '72px', borderRadius: 'var(--radius)' }} />)}
            </div>
          ) : runs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon"><DollarSign size={28} /></div>
              <div className="empty-title">No Payroll Runs</div>
              <div className="empty-desc">Wages have not been compiled for this site yet. Select a month and click "Generate".</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {runs.map(run => (
                <div
                  key={run.id}
                  className="trip-card"
                  onClick={() => selectRun(run)}
                  style={{ justifyContent: 'space-between', cursor: 'pointer' }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      {format(new Date(run.period_month), 'MMMM yyyy')} Payroll
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Site: {run.sites?.name || '—'}
                    </span>
                  </div>
                  <span className={`trip-type-badge ${run.status === 'finalized' ? 'owned' : 'rented'}`}>
                    {run.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Confirm deletion */}
      <ConfirmDialog
        isOpen={confirmDeleteId !== null}
        title="Delete Draft Run"
        message="Are you sure you want to discard this draft payroll run? All computed lines will be permanently removed."
        onConfirm={executeDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {/* Confirm Finalize */}
      <ConfirmDialog
        isOpen={confirmFinalizeId !== null}
        title="Finalize Payroll Run"
        message="Are you sure you want to finalize this payroll run? This status prevents future edits and records liability balances."
        onConfirm={executeFinalize}
        onCancel={() => setConfirmFinalizeId(null)}
      />

      {/* Confirm Generate Overwrite */}
      <ConfirmDialog
        isOpen={confirmGenerate}
        title="Re-generate Draft Run"
        message="A draft payroll run already exists for this period. Generating it again will overwrite the existing computed wages. Proceed?"
        onConfirm={executeGenerate}
        onCancel={() => setConfirmGenerate(false)}
      />
    </div>
  )
}
