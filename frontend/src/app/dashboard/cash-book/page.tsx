'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { Plus, X, Lock, Unlock, Camera, Image as ImageIcon } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site, CashBook, CashEntry } from '@/lib/supabase/types'
import { cashBookRepository } from '@/lib/repositories/cash-book'
import { sitesRepository } from '@/lib/repositories/sites'
import { getOfflineCache, setOfflineCache } from '@/lib/offline-cache'
import { enqueueCashEntryWithReceipt } from '@/lib/offline-outbox'
import { isBrowserOnline, shouldQueueOffline } from '@/lib/offline-network'
import { formatInr } from '@/lib/calculations'
import BottomSheet from '@/components/BottomSheet'
import ConfirmDialog from '@/components/ConfirmDialog'
import toast from 'react-hot-toast'
import { toErrorMessage } from '@/lib/errors'

import {
  CASH_ENTRY_CATEGORIES_IN,
  CASH_ENTRY_CATEGORIES_OUT,
  expenseRequiresContractor,
} from '@/lib/trip-constants'
import ContractorInput from '@/components/ContractorInput'
import { resolveOrCreateContractorId, contractorNameById } from '@/lib/resolve-contractor'

const ENTRY_CATEGORIES_IN = [...CASH_ENTRY_CATEGORIES_IN]
const ENTRY_CATEGORIES_OUT = [...CASH_ENTRY_CATEGORIES_OUT]

export default function CashBookPage() {
  const { isAdmin, isSiteManager, loading: authLoading, user, organizationId } = useAuth()
  const router = useRouter()
  const [sites, setSites] = useState<Site[]>([])
  const [selectedSite, setSelectedSite] = useState('')
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [cashBook, setCashBook] = useState<CashBook | null>(null)
  const [entries, setEntries] = useState<(CashEntry & { signed_receipt_url?: string | null })[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<{
    entry_type: 'in' | 'out'
    category: string
    amount: string
    note: string
    contractor_name: string
  }>({
    entry_type: 'out',
    category: ENTRY_CATEGORIES_OUT[0],
    amount: '',
    note: '',
    contractor_name: '',
  })
  const [contractors, setContractors] = useState<Array<{ id: string; name: string }>>([])
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const emptyOutForm = (): typeof form => ({
    entry_type: 'out',
    category: ENTRY_CATEGORIES_OUT[0],
    amount: '',
    note: '',
    contractor_name: '',
  })

  // Pagination states
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [usersMap, setUsersMap] = useState<Record<string, string>>({}) // uuid -> email
  const [totalIn, setTotalIn] = useState(0)
  const [totalOut, setTotalOut] = useState(0)

  // ConfirmDialog states
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmLock, setConfirmLock] = useState(false)

  const supabase = createClient()
  const PAGE_LIMIT = 20

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin && !isSiteManager) {
      router.push('/dashboard')
      return
    }
    loadSites()
  }, [authLoading, isAdmin, isSiteManager])

  useEffect(() => {
    if (selectedSite) loadCashBook(false)
  }, [selectedSite, selectedDate])

  useEffect(() => {
    const onFlushed = () => {
      if (selectedSite) void loadCashBook(false)
    }
    window.addEventListener('khani:outbox-flushed', onFlushed)
    return () => window.removeEventListener('khani:outbox-flushed', onFlushed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSite, selectedDate])

  useEffect(() => {
    if (!selectedSite || !cashBook?.id) return
    const channel = supabase
      .channel(`cash-realtime-${selectedSite}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cash_entries',
          filter: `cash_book_id=eq.${cashBook.id}`,
        },
        () => {
          loadCashBook(false)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedSite, selectedDate, cashBook?.id])

  const loadSites = async () => {
    try {
      const loadedSites = await sitesRepository.listActive(supabase)
      setSites(loadedSites)
      if (loadedSites.length > 0) {
        setSelectedSite(loadedSites[0].id)
      }

      const { data: contractorsData } = await supabase
        .from('transport_contractors')
        .select('id, name')
        .eq('active', true)
        .order('name')
      setContractors(contractorsData || [])

      // Fetch user profile map for Audit details
      const token = await supabase.auth.getSession().then(({ data }) => data.session?.access_token)
      if (token) {
        fetch('/api/admin/list-users', {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(r => r.json())
          .then(data => {
            if (data?.users) {
              const mapping: Record<string, string> = {}
              for (const u of data.users) {
                mapping[u.id] = u.email
              }
              setUsersMap(mapping)
            }
          })
          .catch(() => {})
      }
    } catch (err: unknown) {
      toast.error(`Error loading sites: ${toErrorMessage(err)}`)
    }
  }

  const loadCashBook = async (loadMore = false) => {
    if (loadMore) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }
    try {
      const cb = await cashBookRepository.getOrCreate(supabase, selectedSite, selectedDate)
      setCashBook(cb)
      
      const balances = await cashBookRepository.getBalances(supabase, cb.id)
      setTotalIn(balances.totalIn)
      setTotalOut(balances.totalOut)
      
      const offset = loadMore ? entries.length : 0
      const loadedEntries = await cashBookRepository.listEntries(supabase, cb.id, PAGE_LIMIT, offset)

      // Signed receipt URLs are for display only — never written to offline cache
      const entriesWithUrls = await Promise.all(loadedEntries.map(async (entry) => {
        let signedReceiptUrl = null
        if (entry.receipt_url) {
          let path = entry.receipt_url
          if (path.includes('cash-receipts/')) {
            path = path.split('cash-receipts/').pop() || path
          }
          try {
            const { data: signed } = await supabase.storage
              .from('cash-receipts')
              .createSignedUrl(path, 3600)
            signedReceiptUrl = signed?.signedUrl || null
          } catch (e) {
            console.error(e)
          }
        }
        return {
          ...entry,
          signed_receipt_url: signedReceiptUrl
        }
      }))

      const cacheKey = `cashbook_${selectedSite}_${selectedDate}`
      // Persist book + balances + entry rows without signed URLs
      const cacheableEntries = entriesWithUrls.map(({ signed_receipt_url: _s, ...rest }) => rest)

      if (loadMore) {
        setEntries(prev => {
          const nextEntries = [...prev, ...entriesWithUrls]
          const cacheable = nextEntries.map(({ signed_receipt_url: _s, ...rest }) => rest)
          setOfflineCache(user?.id, organizationId, cacheKey, {
            book: cb,
            balances: { totalIn: balances.totalIn, totalOut: balances.totalOut },
            entries: cacheable,
          })
          return nextEntries
        })
      } else {
        setEntries(entriesWithUrls)
        setOfflineCache(user?.id, organizationId, cacheKey, {
          book: cb,
          balances: { totalIn: balances.totalIn, totalOut: balances.totalOut },
          entries: cacheableEntries,
        })
      }
      setHasMore(loadedEntries.length === PAGE_LIMIT)
    } catch (error: unknown) {
      const message = error instanceof Error ? toErrorMessage(error) : 'Unknown error'
      const cached = getOfflineCache<{
        book: CashBook
        balances: { totalIn: number; totalOut: number }
        entries: CashEntry[]
      }>(user?.id, organizationId, `cashbook_${selectedSite}_${selectedDate}`)

      if (cached && !loadMore) {
        setCashBook(cached.book)
        setEntries(cached.entries)
        setTotalIn(cached.balances.totalIn)
        setTotalOut(cached.balances.totalOut)
        toast('Serving cached cash book (offline mode)', { icon: '📶' })
      } else {
        toast.error(`Error loading cash book: ${message}`)
        setCashBook(null)
        if (!loadMore) setEntries([])
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const handlePhotoSelect = async (file: File, fromCamera = false) => {
    const { compressImageFile, saveCaptureToDevice } = await import('@/lib/image-utils')
    const compressed = await compressImageFile(file)
    if (compressed.size > 5 * 1024 * 1024) {
      toast.error('File still exceeds 5MB after compress')
      return
    }
    if (fromCamera) {
      void saveCaptureToDevice(compressed)
      toast.success('Receipt saved to device and attached', { icon: '📷' })
    }
    setPhotoFile(compressed)
    setPhotoPreview(URL.createObjectURL(compressed))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cashBook) return
    if (cashBook.status === 'locked') {
      toast.error('This Cash Book is locked for the day and cannot be modified.')
      return
    }

    const amt = parseFloat(form.amount)
    if (isNaN(amt) || amt <= 0) {
      toast.error('Please enter a valid amount')
      return
    }

    setSubmitting(true)

    const queueCashOffline = async (receiptUrl: string | null, receiptFile: File | null) => {
      const clientId = crypto.randomUUID()
      const known = contractors.find(
        (c) => c.name.trim().toLowerCase() === form.contractor_name.trim().toLowerCase()
      )
      const item = await enqueueCashEntryWithReceipt(user?.id, organizationId, {
        client_id: clientId,
        cash_book_id: cashBook.id,
        site_id: selectedSite,
        book_date: selectedDate,
        entry_type: form.entry_type,
        category: form.category,
        amount: amt,
        note: form.note || null,
        receipt_url: receiptUrl,
        contractor_id: known?.id || null,
        contractor_name: form.contractor_name || null,
        receiptFile,
      })
      if (!item) {
        toast.error('Could not queue cash entry offline')
        return false
      }
      const optimistic = {
        id: clientId,
        cash_book_id: cashBook.id,
        entry_type: form.entry_type,
        category: form.category,
        amount: amt,
        note: form.note || null,
        receipt_url: receiptUrl,
        contractor_id: known?.id || null,
        active: true,
        created_at: new Date().toISOString(),
      } as CashEntry
      setEntries((prev) => [optimistic, ...prev])
      const photoNote = receiptFile ? ' · receipt queued' : ''
      toast.success(`Cash entry saved offline — will sync when online${photoNote}`, {
        icon: '📶',
      })
      return true
    }

    if (!isBrowserOnline()) {
      if (await queueCashOffline(null, photoFile)) {
        setShowForm(false)
        setForm(emptyOutForm())
        setPhotoFile(null)
        setPhotoPreview(null)
      }
      setSubmitting(false)
      return
    }

    try {
      let contractorId: string | null = null
      if (
        form.entry_type === 'out' &&
        expenseRequiresContractor(form.category) &&
        form.contractor_name.trim()
      ) {
        contractorId = await resolveOrCreateContractorId(
          supabase,
          organizationId,
          form.contractor_name
        )
        if (contractorId && !contractors.some((c) => c.id === contractorId)) {
          setContractors((prev) => [
            ...prev,
            { id: contractorId!, name: form.contractor_name.trim() },
          ])
        }
      }

      let receiptUrl: string | null = null
      if (photoFile) {
        // Path must start with cash_book_id for storage RLS (migration 026/042)
        const ext = photoFile.name.split('.').pop() || 'jpg'
        const path = `${cashBook.id}/${crypto.randomUUID()}.${ext}`
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('cash-receipts')
          .upload(path, photoFile, { upsert: true })

        if (uploadError) throw uploadError
        if (uploadData) receiptUrl = path
      }

      await cashBookRepository.createEntry(supabase, {
        cash_book_id: cashBook.id,
        entry_type: form.entry_type,
        category: form.category,
        amount: amt,
        note: form.note || null,
        receipt_url: receiptUrl,
        contractor_id: contractorId,
      })

      toast.success('Cash entry recorded successfully')
      setShowForm(false)
      setForm(emptyOutForm())
      setPhotoFile(null)
      setPhotoPreview(null)
      loadCashBook()
    } catch (err: unknown) {
      if (shouldQueueOffline(err) && (await queueCashOffline(null, photoFile))) {
        setShowForm(false)
        setForm(emptyOutForm())
        setPhotoFile(null)
        setPhotoPreview(null)
        setSubmitting(false)
        return
      }
      toast.error(`Error saving cash entry: ${toErrorMessage(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const executeDeleteEntry = async () => {
    if (!confirmDeleteId || !cashBook) return
    if (cashBook.status === 'locked') {
      toast.error('This Cash Book is locked.')
      return
    }

    try {
      await cashBookRepository.deleteEntry(supabase, confirmDeleteId)
      toast.success('Cash entry removed')
      loadCashBook()
    } catch (error: unknown) {
      toast.error(`Error deleting cash entry: ${toErrorMessage(error)}`)
    } finally {
      setConfirmDeleteId(null)
    }
  }

  const executeToggleLock = async () => {
    if (!cashBook) return
    try {
      const nextStatus = await cashBookRepository.toggleLock(
        supabase,
        cashBook.id,
        cashBook.status,
        { isAdmin }
      )
      toast.success(`Cash book is now ${nextStatus}`)
      loadCashBook()
    } catch (error: unknown) {
      const message = error instanceof Error ? toErrorMessage(error) : 'Unknown error'
      toast.error(`Error toggling lock status: ${message}`)
    } finally {
      setConfirmLock(false)
    }
  }

  const [uploadingId, setUploadingId] = useState<string | null>(null)

  const handleUpdateReceipt = async (entryId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !cashBook) return

    setUploadingId(entryId)
    try {
      const ext = file.name.split('.').pop() || 'jpg'
      const fileUuid = crypto.randomUUID()
      const path = `${selectedSite}/${selectedDate}/${fileUuid}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from('cash-receipts')
        .upload(path, file, { upsert: true })

      if (uploadError) throw uploadError

      await cashBookRepository.updateReceiptUrl(supabase, entryId, path)
      toast.success('Receipt photo updated successfully')
      loadCashBook()
    } catch (err: unknown) {
      toast.error(`Error updating receipt: ${toErrorMessage(err)}`)
    } finally {
      setUploadingId(null)
    }
  }

  const handleEntryTypeChange = (type: 'in' | 'out') => {
    setForm((f) => ({
      ...f,
      entry_type: type,
      category: type === 'in' ? ENTRY_CATEGORIES_IN[0] : ENTRY_CATEGORIES_OUT[0],
      contractor_id: '',
    }))
  }

  const isLocked = cashBook?.status === 'locked'

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Book</h1>
          <p className="page-subtitle">Site Expense Ledger</p>
        </div>
        {cashBook && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(!isLocked || isAdmin) && (
              <button
                className={`btn ${isLocked ? 'btn-secondary' : 'btn-primary'}`}
                onClick={() => setConfirmLock(true)}
                title={isLocked && !isAdmin ? 'Only admins can unlock' : undefined}
              >
                {isLocked ? <><Unlock size={16} /> Unlock Book</> : <><Lock size={16} /> Lock Book</>}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => setShowForm(true)} disabled={isLocked}>
              <Plus size={18} /> Add Entry
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card mb-4" style={{ padding: '0.875rem 1rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {sites.length > 1 && (
            <select className="form-input form-select" style={{ flex: 1, minWidth: '140px' }}
              value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <input
            type="date"
            className="form-input"
            style={{ flex: 1, minWidth: '165px' }}
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '72px', borderRadius: 'var(--radius)' }} />)}
        </div>
      ) : !cashBook ? (
        <div className="empty-state">
          <div className="empty-title">Initialization Error</div>
          <div className="empty-desc">Could not create cash book session.</div>
        </div>
      ) : (
        <>
          {/* Lock Banner */}
          {isLocked && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.625rem',
              background: 'var(--danger-muted)', border: '1px solid var(--danger)',
              padding: '0.75rem 1rem', borderRadius: 'var(--radius)',
              color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.875rem',
            }}>
              <Lock size={16} />
              <span>
                <strong>Locked:</strong> This ledger is locked.
                {isAdmin
                  ? ' You can unlock as admin if corrections are required.'
                  : ' Only an organization admin can unlock it.'}
              </span>
            </div>
          )}

          {/* Balance Cards */}
          <div className="grid-2 mb-4" style={{ gap: '0.75rem' }}>
            <div className="card" style={{ padding: '0.75rem 0.875rem', minWidth: 0, overflow: 'hidden' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Opening Balance</span>
              <div
                style={{
                  fontSize: 'clamp(0.95rem, 2vw, 1.15rem)',
                  fontWeight: 700,
                  marginTop: '0.25rem',
                  overflowWrap: 'anywhere',
                  fontVariantNumeric: 'tabular-nums',
                }}
                title={`₹${(cashBook.opening_balance ?? 0).toLocaleString('en-IN')}`}
              >
                {formatInr(cashBook.opening_balance ?? 0)}
              </div>
            </div>
            <div className="card" style={{ padding: '0.75rem 0.875rem', minWidth: 0, overflow: 'hidden' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Closing Balance</span>
              <div
                style={{
                  fontSize: 'clamp(0.95rem, 2vw, 1.15rem)',
                  fontWeight: 700,
                  color: (cashBook.closing_balance ?? 0) < 0 ? 'var(--danger)' : 'var(--accent)',
                  marginTop: '0.25rem',
                  overflowWrap: 'anywhere',
                  fontVariantNumeric: 'tabular-nums',
                }}
                title={`₹${(cashBook.closing_balance ?? 0).toLocaleString('en-IN')}`}
              >
                {formatInr(cashBook.closing_balance ?? 0)}
              </div>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Ledger Entries</h3>
              <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--success)' }}>In: ₹{totalIn.toLocaleString('en-IN')}</span>
                <span style={{ color: 'var(--danger)' }}>Out: ₹{totalOut.toLocaleString('en-IN')}</span>
              </div>
            </div>

            {entries.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                <div className="empty-desc">No cash transactions logged for this day</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {entries.map(entry => (
                  <div
                    key={entry.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.875rem 1.25rem',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span className={`cash-dot ${entry.entry_type}`} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{entry.category}</div>
                        {entry.contractor_id && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '0.125rem', fontWeight: 500 }}>
                            Contractor: {contractorNameById(contractors, entry.contractor_id)}
                          </div>
                        )}
                        {entry.note && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>{entry.note}</div>}
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                          {entry.created_at ? format(new Date(entry.created_at), 'hh:mm a') : ''}
                          {entry.created_by && usersMap[entry.created_by] ? ` by ${usersMap[entry.created_by]}` : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={`cash-amount ${entry.entry_type}`} style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                        {entry.entry_type === 'in' ? '+' : '-'}₹{entry.amount.toLocaleString('en-IN')}
                      </span>
                      
                      {entry.entry_type === 'out' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          {entry.signed_receipt_url ? (
                            <a 
                              href={entry.signed_receipt_url} 
                              target="_blank" 
                              rel="noreferrer"
                              className="btn btn-ghost btn-icon btn-sm"
                              title="View receipt image"
                            >
                              <ImageIcon size={14} style={{ color: 'var(--accent)' }} />
                            </a>
                          ) : null}
                          {!isLocked && (
                            <>
                              <input 
                                type="file" 
                                id={`file-${entry.id}`} 
                                style={{ display: 'none' }} 
                                accept="image/*"
                                onChange={(e) => handleUpdateReceipt(entry.id, e)}
                                disabled={uploadingId === entry.id}
                              />
                              <button
                                className="btn btn-ghost btn-icon btn-sm"
                                onClick={() => document.getElementById(`file-${entry.id}`)?.click()}
                                title={entry.receipt_url ? "Update receipt photo" : "Upload receipt photo"}
                                disabled={uploadingId === entry.id}
                              >
                                <Camera size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      {!isLocked && (
                        <button
                          className="btn btn-danger btn-icon btn-sm"
                          onClick={() => setConfirmDeleteId(entry.id)}
                          title="Delete entry"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Load More Button */}
                {hasMore && (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
                    <button 
                      className="btn btn-secondary" 
                      onClick={() => loadCashBook(true)}
                      disabled={loadingMore}
                      style={{ minWidth: '150px' }}
                    >
                      {loadingMore ? <span className="spinner" /> : 'Load More Entries'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {cashBook && !isLocked && (
        <button className="btn-fab" onClick={() => setShowForm(true)} title="Add Cash Entry">
          <Plus size={24} />
        </button>
      )}

      {/* BottomSheet Form */}
      <BottomSheet isOpen={showForm} onClose={() => setShowForm(false)} title="Add Cash Entry">
        <form onSubmit={handleSubmit}>
          {/* Type Selector */}
          <div className="form-group">
            <label className="form-label">Transaction Type</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className={`btn w-full ${form.entry_type === 'out' ? 'btn-danger' : 'btn-secondary'}`}
                onClick={() => handleEntryTypeChange('out')}
              >
                Cash Out (Expense)
              </button>
              <button
                type="button"
                className={`btn w-full ${form.entry_type === 'in' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => handleEntryTypeChange('in')}
              >
                Cash In (Deposit)
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Category</label>
            <select
              className="form-input form-select"
              value={form.category}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  category: e.target.value,
                  contractor_name: expenseRequiresContractor(e.target.value)
                    ? f.contractor_name
                    : '',
                }))
              }
            >
              {form.entry_type === 'in'
                ? ENTRY_CATEGORIES_IN.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))
                : ENTRY_CATEGORIES_OUT.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
            </select>
          </div>

          {form.entry_type === 'out' && expenseRequiresContractor(form.category) && (
            <ContractorInput
              label="Transport contractor (optional)"
              value={form.contractor_name}
              onChange={(name) => setForm((f) => ({ ...f, contractor_name: name }))}
              contractors={contractors}
              placeholder="Type name or pick from list"
              hint="Optional — pick from list or type a new name"
            />
          )}

          <div className="form-group">
            <label className="form-label">Amount (₹) *</label>
            <input
              type="number"
              className="form-input"
              placeholder="0.00"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              rows={2}
              placeholder="e.g. Voucher no, description..."
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            />
          </div>

          {/* Receipt capture */}
          <div className="form-group">
            <label className="form-label">Receipt Image Evidence (optional)</label>
            <div style={{ display: 'flex', gap: '0.625rem' }}>
              <label style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '0.5rem', padding: '0.75rem',
                background: 'var(--bg-elevated)', border: '1.5px dashed var(--border)',
                borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.875rem',
                color: 'var(--text-muted)', transition: 'all 0.15s',
              }}>
                <Camera size={18} /> Capture
                <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) void handlePhotoSelect(f, true)
                  }} />
              </label>
              <label style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '0.5rem', padding: '0.75rem',
                background: 'var(--bg-elevated)', border: '1.5px dashed var(--border)',
                borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.875rem',
                color: 'var(--text-muted)', transition: 'all 0.15s',
              }}>
                <ImageIcon size={18} /> Gallery
                <input type="file" accept="image/*" style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) void handlePhotoSelect(f, false)
                  }} />
              </label>
            </div>
            {photoPreview && (
              <div style={{ position: 'relative', marginTop: '0.625rem' }}>
                <img src={photoPreview} alt="Preview"
                  style={{ width: '100%', maxHeight: '160px', objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }} />
                <button type="button" onClick={() => { setPhotoFile(null); setPhotoPreview(null) }}
                  style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}>
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary w-full" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
              {submitting ? <span className="spinner" /> : '+ Save Entry'}
            </button>
          </div>
        </form>
      </BottomSheet>

      {/* Confirm deletion modal */}
      <ConfirmDialog 
        isOpen={confirmDeleteId !== null}
        title="Delete Cash Entry"
        message="Are you sure you want to remove this cash transaction? This will automatically update the closing balance."
        onConfirm={executeDeleteEntry}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {/* Confirm Lock Book modal */}
      {cashBook && (
        <ConfirmDialog 
          isOpen={confirmLock}
          title={isLocked ? 'Unlock Ledger' : 'Lock Ledger'}
          message={isLocked
            ? 'Are you sure you want to unlock this day\'s cash book? Modifying locked balances requires extreme caution.'
            : 'Are you sure you want to lock today\'s cash book? Locked ledgers prevent further changes and are ready for admin review.'
          }
          onConfirm={executeToggleLock}
          onCancel={() => setConfirmLock(false)}
        />
      )}
    </div>
  )
}
