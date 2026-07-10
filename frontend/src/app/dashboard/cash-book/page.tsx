'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { Plus, Lock, Unlock, X, ChevronLeft, ChevronRight } from 'lucide-react'

const CATEGORIES_OUT = [
  'Fuel', 'Maintenance', 'Tiffen', 'Meals', 'Night Meals',
  'Water Tank', 'Phone Bill', 'Books/Misc', 'Wages', 'Salary',
  'Permit Cash', 'Work Bill', 'Other'
]
const CATEGORIES_IN = ['DSR', 'VTS', 'Trip Cash', 'Permit Cash', 'Work Bill', 'Other']

import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'

export default function CashBookPage() {
  const { isAdmin, isSiteManager, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sites, setSites] = useState<any[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [cashBook, setCashBook] = useState<any>(null)
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [entryType, setEntryType] = useState<'in' | 'out'>('out')
  const [form, setForm] = useState({ category: '', amount: '', note: '' })
  const [submitting, setSubmitting] = useState(false)
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

  useEffect(() => {
    if (selectedSite) loadCashBook()
  }, [selectedSite, selectedDate])

  const loadCashBook = async () => {
    setLoading(true)
    // Get or create cash book
    let { data: cb } = await supabase
      .from('cash_books')
      .select('*')
      .eq('site_id', selectedSite)
      .eq('book_date', selectedDate)
      .single()

    if (!cb) {
      // Get previous closing balance
      const { data: prev } = await supabase
        .from('cash_books')
        .select('closing_balance')
        .eq('site_id', selectedSite)
        .lt('book_date', selectedDate)
        .order('book_date', { ascending: false })
        .limit(1)
        .single()

      const openingBalance = prev?.closing_balance || 0

      const { data: newCb } = await supabase.from('cash_books').insert({
        site_id: selectedSite,
        book_date: selectedDate,
        opening_balance: openingBalance,
        closing_balance: openingBalance,
        status: 'draft',
      }).select().single()

      cb = newCb
    }

    setCashBook(cb)

    if (cb) {
      const { data: e } = await supabase
        .from('cash_entries')
        .select('*')
        .eq('cash_book_id', cb.id)
        .neq('active', false)
        .order('created_at')
      setEntries(e || [])
    }
    setLoading(false)
  }

  const addEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cashBook || !form.category || !form.amount) return
    if (cashBook.status === 'locked') {
      alert('This cash book is locked and cannot be modified.')
      return
    }
    setSubmitting(true)
    await supabase.from('cash_entries').insert({
      cash_book_id: cashBook.id,
      entry_type: entryType,
      category: form.category,
      amount: parseFloat(form.amount),
      note: form.note || null,
      active: true,
    })
    setForm({ category: '', amount: '', note: '' })
    setShowForm(false)
    setSubmitting(false)
    loadCashBook()
  }

  const deleteEntry = async (id: string) => {
    if (!cashBook) return
    if (cashBook.status === 'locked') {
      alert('This cash book is locked and entries cannot be deleted.')
      return
    }
    if (!confirm('Delete this entry?')) return
    await supabase.from('cash_entries').update({ active: false }).eq('id', id)
    loadCashBook()
  }

  const lockCashBook = async () => {
    const newStatus = cashBook.status === 'locked' ? 'draft' : 'locked'
    await supabase.from('cash_books').update({ status: newStatus }).eq('id', cashBook.id)
    loadCashBook()
  }

  const totalIn = entries.filter(e => e.entry_type === 'in').reduce((s, e) => s + e.amount, 0)
  const totalOut = entries.filter(e => e.entry_type === 'out').reduce((s, e) => s + e.amount, 0)

  const prevDate = () => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() - 1)
    setSelectedDate(format(d, 'yyyy-MM-dd'))
  }

  const nextDate = () => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + 1)
    if (d <= new Date()) setSelectedDate(format(d, 'yyyy-MM-dd'))
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Book</h1>
          <p className="page-subtitle">Daily Cash Register</p>
        </div>
        {cashBook && (
          <button
            className={`btn ${cashBook.status === 'locked' ? 'btn-secondary' : 'btn-success'}`}
            onClick={lockCashBook}
          >
            {cashBook.status === 'locked' ? <><Unlock size={16} /> Unlock</> : <><Lock size={16} /> Lock Day</>}
          </button>
        )}
      </div>

      {/* Date Nav */}
      <div className="card mb-4" style={{ padding: '0.75rem 1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {sites.length > 1 && (
            <select className="form-input form-select" style={{ flex: 1, minWidth: '140px' }}
              value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={prevDate}><ChevronLeft size={18} /></button>
            <input
              type="date"
              className="form-input"
              style={{ flex: 1, textAlign: 'center' }}
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
            />
            <button className="btn btn-ghost btn-icon btn-sm" onClick={nextDate}
              disabled={selectedDate >= format(new Date(), 'yyyy-MM-dd')}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Balance Bar */}
      {cashBook && (
        <div className="balance-bar mb-4">
          <div className="balance-bar-item">
            <span className="label">Opening</span>
            <span className="value">₹{(cashBook.opening_balance || 0).toLocaleString('en-IN')}</span>
          </div>
          <div className="balance-bar-item">
            <span className="label">In / Out</span>
            <span className="value" style={{ fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--success)' }}>+{totalIn.toLocaleString('en-IN')}</span>
              {' / '}
              <span style={{ color: 'var(--danger)' }}>-{totalOut.toLocaleString('en-IN')}</span>
            </span>
          </div>
          <div className="balance-bar-item">
            <span className="label">Closing</span>
            <span className="value" style={{ color: 'var(--accent)' }}>
              ₹{(cashBook.closing_balance || 0).toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {cashBook?.status !== 'locked' && (
        <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '1rem' }}>
          <button
            className="btn btn-success w-full"
            onClick={() => { setEntryType('in'); setShowForm(true) }}
          >
            <Plus size={18} /> Cash In
          </button>
          <button
            className="btn btn-danger w-full"
            onClick={() => { setEntryType('out'); setShowForm(true) }}
          >
            <Plus size={18} /> Cash Out
          </button>
        </div>
      )}

      {/* Entries */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '1rem' }}>
            {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height: '52px', marginBottom: '0.5rem', borderRadius: 'var(--radius)' }} />)}
          </div>
        ) : entries.length === 0 ? (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <div style={{ fontSize: '2rem' }}>💰</div>
            <div className="empty-title">No entries yet</div>
            <div className="empty-desc">Tap Cash In or Cash Out to start recording</div>
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 80px 40px',
              gap: '0.5rem',
              padding: '0.625rem 1rem',
              background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border)',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
            }}>
              <span>Category</span>
              <span>Note</span>
              <span style={{ textAlign: 'right' }}>Amount</span>
              <span />
            </div>
            {entries.map(entry => (
              <div key={entry.id} className="cash-row" style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 80px 40px',
                gap: '0.5rem',
                alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={`cash-dot ${entry.entry_type}`} />
                  <span className="cash-category">{entry.category}</span>
                </div>
                <span className="cash-note" style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  {entry.note || '—'}
                </span>
                <span className={`cash-amount ${entry.entry_type}`} style={{ textAlign: 'right' }}>
                  {entry.entry_type === 'in' ? '+' : '-'}₹{entry.amount.toLocaleString('en-IN')}
                </span>
                {cashBook?.status !== 'locked' && (
                  <button className="btn btn-ghost btn-icon" style={{ padding: '0.25rem', color: 'var(--text-muted)' }}
                    onClick={() => deleteEntry(entry.id)}>
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
            {/* Total row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 80px 40px',
              gap: '0.5rem',
              padding: '0.875rem 1rem',
              background: 'var(--bg-elevated)',
              borderTop: '1px solid var(--border)',
            }}>
              <span style={{ fontWeight: 700, color: 'var(--text-secondary)', fontSize: '0.8rem', textTransform: 'uppercase' }}>TOTAL OUT</span>
              <span />
              <span style={{ fontWeight: 700, color: 'var(--danger)', textAlign: 'right', fontFamily: 'var(--font-display)' }}>
                ₹{totalOut.toLocaleString('en-IN')}
              </span>
              <span />
            </div>
          </div>
        )}
      </div>

      {/* FAB */}
      {cashBook?.status !== 'locked' && (
        <button className="btn-fab" onClick={() => { setEntryType('out'); setShowForm(true) }}>
          <Plus size={24} />
        </button>
      )}

      {/* Entry Form Sheet */}
      {showForm && (
        <>
          <div className="sheet-overlay" onClick={() => setShowForm(false)} />
          <div className="sheet">
            <div className="sheet-handle" />
            <div className="sheet-title">
              <span style={{ color: entryType === 'in' ? 'var(--success)' : 'var(--danger)' }}>
                {entryType === 'in' ? '↑ Cash In' : '↓ Cash Out'}
              </span>
            </div>

            <form onSubmit={addEntry}>
              {/* Type toggle */}
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <button type="button"
                  className={`btn w-full ${entryType === 'in' ? 'btn-success' : 'btn-secondary'}`}
                  onClick={() => setEntryType('in')}>
                  Cash In
                </button>
                <button type="button"
                  className={`btn w-full ${entryType === 'out' ? 'btn-danger' : 'btn-secondary'}`}
                  onClick={() => setEntryType('out')}>
                  Cash Out
                </button>
              </div>

              {/* Category quick select */}
              <div className="form-group">
                <label className="form-label">Category *</label>
                <div className="category-grid">
                  {(entryType === 'in' ? CATEGORIES_IN : CATEGORIES_OUT).map(cat => (
                    <button
                      key={cat}
                      type="button"
                      className={`category-chip ${entryType === 'in' ? 'in-type' : ''} ${form.category === cat ? 'selected' : ''}`}
                      onClick={() => setForm(f => ({ ...f, category: cat }))}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <input
                  className="form-input"
                  placeholder="Or type custom category..."
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Amount (₹) *</label>
                <input
                  className="form-input"
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  required
                  min="1"
                  step="1"
                  style={{ fontSize: '1.25rem', fontFamily: 'var(--font-display)', fontWeight: 700 }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Note</label>
                <input
                  className="form-input"
                  placeholder="e.g. MN Kandiga water tank, 3 days..."
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary w-full" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
                  {submitting ? <span className="spinner" /> : 'Save Entry'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
