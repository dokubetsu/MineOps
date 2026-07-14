'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { Plus, Lock, Unlock, X, ChevronLeft, ChevronRight, Camera, Image as ImageIcon, Receipt } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site, CashBook, CashEntry } from '@/lib/supabase/types'
import toast from 'react-hot-toast'

const CATEGORIES_OUT = [
  'Fuel', 'Maintenance', 'Tiffen', 'Meals', 'Night Meals',
  'Water Tank', 'Phone Bill', 'Books/Misc', 'Wages', 'Salary',
  'Permit Cash', 'Work Bill', 'Other'
]
const CATEGORIES_IN = ['DSR', 'VTS', 'Trip Cash', 'Permit Cash', 'Work Bill', 'Other']

export default function CashBookPage() {
  const { isAdmin, isSiteManager, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [cashBook, setCashBook] = useState<CashBook | null>(null)
  const [entries, setEntries] = useState<CashEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [entryType, setEntryType] = useState<'in' | 'out'>('out')
  const [form, setForm] = useState({ category: '', amount: '', note: '' })
  const [submitting, setSubmitting] = useState(false)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({})
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
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
    const { data: cb, error: loadError } = await supabase
      .from('cash_books')
      .select('*')
      .eq('site_id', selectedSite)
      .eq('book_date', selectedDate)
      .maybeSingle()

    if (loadError) {
      toast.error(`Error loading cash book: ${loadError.message}`)
      setLoading(false)
      return
    }

    let activeCb = cb

    if (!activeCb) {
      const { data: prev, error: prevError } = await supabase
        .from('cash_books')
        .select('closing_balance')
        .eq('site_id', selectedSite)
        .lt('book_date', selectedDate)
        .order('book_date', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (prevError) {
        toast.error(`Error loading previous closing balance: ${prevError.message}`)
        setLoading(false)
        return
      }

      const openingBalance = prev?.closing_balance || 0

      const { data: newCb, error: insertError } = await supabase.from('cash_books').insert({
        site_id: selectedSite,
        book_date: selectedDate,
        opening_balance: openingBalance,
        closing_balance: openingBalance,
        status: 'draft',
      }).select().single()

      if (insertError) {
        if (insertError.code === '23505') {
          const { data: retryCb, error: retryError } = await supabase
            .from('cash_books')
            .select('*')
            .eq('site_id', selectedSite)
            .eq('book_date', selectedDate)
            .single()
          if (retryError) {
            toast.error(`Failed to resolve concurrent cash book: ${retryError.message}`)
            setLoading(false)
            return
          }
          activeCb = retryCb
        } else {
          toast.error(`Error creating cash book: ${insertError.message}`)
          setLoading(false)
          return
        }
      } else {
        activeCb = newCb
      }
    }

    setCashBook(activeCb)

    if (activeCb) {
      const { data: e, error: entriesError } = await supabase
        .from('cash_entries')
        .select('*')
        .eq('cash_book_id', activeCb.id)
        .neq('active', false)
        .order('created_at')
        .limit(500)
      
      if (entriesError) {
        toast.error(`Error loading cash entries: ${entriesError.message}`)
      } else {
        const loadedEntries = e || []
        setEntries(loadedEntries)
        loadReceiptUrls(loadedEntries)
      }
    }
    setLoading(false)
  }

  const loadReceiptUrls = async (loadedEntries: CashEntry[]) => {
    const entriesWithReceipts = loadedEntries.filter(e => e.receipt_url)
    if (entriesWithReceipts.length === 0) return

    const urlMap: Record<string, string> = {}
    await Promise.all(
      entriesWithReceipts.map(async (entry) => {
        if (entry.receipt_url) {
          const { data } = await supabase.storage
            .from('cash-receipts')
            .createSignedUrl(entry.receipt_url, 3600)
          if (data?.signedUrl) urlMap[entry.id] = data.signedUrl
        }
      })
    )
    setReceiptUrls(urlMap)
  }

  const handleReceiptSelect = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size exceeds the 5MB limit')
      return
    }
    setReceiptFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setReceiptPreview(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const clearReceipt = () => {
    setReceiptFile(null)
    setReceiptPreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  const uploadReceipt = async (cashBookId: string): Promise<string | null> => {
    if (!receiptFile) return null
    const ext = receiptFile.name.split('.').pop() || 'jpg'
    // Use crypto.randomUUID() to prevent collisions/overwrites
    const fileUuid = crypto.randomUUID()
    const path = `${cashBookId}/${fileUuid}.${ext}`
    const { error } = await supabase.storage
      .from('cash-receipts')
      .upload(path, receiptFile, { upsert: false })
    if (error) {
      toast.error(`Error uploading receipt: ${error.message}`)
      return null
    }
    return path
  }

  const addEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cashBook || !form.category || !form.amount) return
    if (cashBook.status === 'locked') {
      toast.error('This cash book is locked and cannot be modified.')
      return
    }
    setSubmitting(true)

    const receiptPath = await uploadReceipt(cashBook.id)

    const { error } = await supabase.from('cash_entries').insert({
      cash_book_id: cashBook.id,
      entry_type: entryType,
      category: form.category,
      amount: parseFloat(form.amount),
      note: form.note || null,
      active: true,
      receipt_url: receiptPath,
    } as any)
    
    if (error) {
      toast.error(`Error saving cash entry: ${error.message}`)
    } else {
      toast.success('Cash entry added successfully')
      setForm({ category: '', amount: '', note: '' })
      clearReceipt()
      setShowForm(false)
      loadCashBook()
    }
    setSubmitting(false)
  }

  const deleteEntry = async (id: string) => {
    if (!cashBook) return
    if (cashBook.status === 'locked') {
      toast.error('This cash book is locked and entries cannot be deleted.')
      return
    }
    if (!confirm('Delete this entry?')) return
    const { error } = await supabase.from('cash_entries').update({ active: false }).eq('id', id)
    if (error) {
      toast.error(`Error deleting cash entry: ${error.message}`)
    } else {
      toast.success('Cash entry deleted')
      loadCashBook()
    }
  }

  const lockCashBook = async () => {
    if (!cashBook) return
    const newStatus = cashBook.status === 'locked' ? 'draft' : 'locked'
    const { error } = await supabase.from('cash_books').update({ status: newStatus }).eq('id', cashBook.id)
    if (error) {
      toast.error(`Error updating cash book lock status: ${error.message}`)
    } else {
      toast.success(`Day ${newStatus === 'locked' ? 'locked' : 'unlocked'} successfully`)
      loadCashBook()
    }
  }

  const totalIn = entries.filter(e => e.entry_type === 'in').reduce((s, e) => s + e.amount, 0)
  const totalOut = entries.filter(e => e.entry_type === 'out').reduce((s, e) => s + e.amount, 0)
  const computedClosingBalance = (cashBook?.opening_balance || 0) + totalIn - totalOut

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
              ₹{computedClosingBalance.toLocaleString('en-IN')}
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
              gridTemplateColumns: '1fr auto 90px 40px',
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
                gridTemplateColumns: '1fr auto 90px 40px',
                gap: '0.5rem',
                alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                  <span className={`cash-dot ${entry.entry_type}`} />
                  <div style={{ minWidth: 0 }}>
                    <span className="cash-category">{entry.category}</span>
                    {entry.receipt_url && (
                      <button
                        onClick={() => setViewingReceipt(receiptUrls[entry.id] || null)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                          marginLeft: '0.5rem', padding: '0.1rem 0.35rem',
                          borderRadius: '4px', border: '1px solid var(--border)',
                          background: 'var(--bg-elevated)', cursor: 'pointer',
                          fontSize: '0.65rem', color: 'var(--accent)',
                        }}
                        title="View receipt"
                      >
                        <Receipt size={10} /> Bill
                      </button>
                    )}
                  </div>
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
              gridTemplateColumns: '1fr auto 90px 40px',
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

      {/* Receipt Viewer Modal */}
      {viewingReceipt && (
        <>
          <div
            onClick={() => setViewingReceipt(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
              zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
              <button
                onClick={() => setViewingReceipt(null)}
                style={{
                  position: 'absolute', top: '-2rem', right: 0,
                  background: 'none', border: 'none', color: '#fff',
                  cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1,
                }}
              >×</button>
              <img
                src={viewingReceipt}
                alt="Receipt"
                style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: '8px', objectFit: 'contain' }}
              />
            </div>
          </div>
        </>
      )}

      {/* Entry Form Sheet */}
      {showForm && (
        <>
          <div className="sheet-overlay" onClick={() => { setShowForm(false); clearReceipt() }} />
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

              {/* Receipt Image Capture */}
              <div className="form-group">
                <label className="form-label">
                  <Receipt size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.3rem' }} />
                  Bill / Receipt Photo
                </label>

                {receiptPreview ? (
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img
                      src={receiptPreview}
                      alt="Receipt preview"
                      style={{
                        width: '100%', maxHeight: '180px', objectFit: 'cover',
                        borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                      }}
                    />
                    <button
                      type="button"
                      onClick={clearReceipt}
                      style={{
                        position: 'absolute', top: '0.4rem', right: '0.4rem',
                        background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff',
                        borderRadius: '50%', width: '24px', height: '24px',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {/* Camera capture (mobile) */}
                    <button
                      type="button"
                      className="btn btn-secondary w-full"
                      style={{ fontSize: '0.8rem' }}
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      <Camera size={15} /> Camera
                    </button>
                    {/* File upload (desktop/gallery) */}
                    <button
                      type="button"
                      className="btn btn-secondary w-full"
                      style={{ fontSize: '0.8rem' }}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <ImageIcon size={15} /> Gallery
                    </button>
                  </div>
                )}

                {/* Hidden inputs */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleReceiptSelect(f) }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleReceiptSelect(f) }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary w-full" onClick={() => { setShowForm(false); clearReceipt() }}>
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
