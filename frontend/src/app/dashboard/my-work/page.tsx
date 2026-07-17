'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { format, subDays } from 'date-fns'
import { Plus, Image as ImageIcon, Check, X, AlertCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { computeTripWorthFromRate } from '@/lib/calculations'
import { cashBookRepository } from '@/lib/repositories/cash-book'
import { tripsRepository } from '@/lib/repositories/trips'
import BottomSheet from '@/components/BottomSheet'
import toast from 'react-hot-toast'
import { toErrorMessage } from '@/lib/errors'
import {
  EXPENSE_CATEGORIES,
  VEHICLE_TYPES,
  getCapacityForType,
  vehicleTypeLabel,
} from '@/lib/trip-constants'

interface EmployeeData {
  id: string
  name: string
  site_id: string
  sites?: {
    name: string
  } | null
}

function EmployeePage() {
  const { user, organizationId, loading: authLoading, hasFeature } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const supabase = createClient()
  const canTrips = hasFeature('trips')
  const canCash = hasFeature('cash_book')
  const canLeave = hasFeature('leave')
  const canAttendance = hasFeature('attendance')
  const [loading, setLoading] = useState(true)
  const [employee, setEmployee] = useState<EmployeeData | null>(null)
  
  // Data lists
  const [vehicles, setVehicles] = useState<any[]>([])
  const [contractors, setContractors] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [negotiatedRates, setNegotiatedRates] = useState<any[]>([])
  const [todayTrips, setTodayTrips] = useState<any[]>([])

  // Prompts and Dialogs
  const [showAttendancePrompt, setShowAttendancePrompt] = useState(false)
  const [showLeaveBanner, setShowLeaveBanner] = useState(false)
  const [yesterdayDateStr, setYesterdayDateStr] = useState('')
  const [showLeaveForm, setShowLeaveForm] = useState(false)
  const [leaveReason, setLeaveReason] = useState('')

  // Log Trip Bottom Sheet
  const [showTripSheet, setShowTripSheet] = useState(false)
  const [submittingTrip, setSubmittingTrip] = useState(false)
  const [tripForm, setTripForm] = useState({
    vehicle_plate: '',
    vehicle_type: '12WH',
    cubic_capacity: '20',
    ownership: 'rented',
    contractor_id: '',
    permit_number: '',
    advance_amount: '0',
    customer_id: '',
    drop_location: '',
    distance_km: '',
    total_shipment_cost: '',
    notes: '',
    settled: false,
    settlement_method: 'upi',
    settlement_ref: '',
  })
  const [entryPhoto, setEntryPhoto] = useState<File | null>(null)
  const [tripPhotos, setTripPhotos] = useState<File[]>([])

  // Expense logger
  const [showExpenseSheet, setShowExpenseSheet] = useState(false)
  const [submittingExpense, setSubmittingExpense] = useState(false)
  const [expenseForm, setExpenseForm] = useState({
    category: EXPENSE_CATEGORIES[0] as string,
    amount: '',
    note: '',
  })
  const [expenseReceipt, setExpenseReceipt] = useState<File | null>(null)
  const [todayExpenses, setTodayExpenses] = useState<
    Array<{ id: string; category: string; amount: number; note: string | null; created_at: string | null }>
  >([])

  // Settle sheet (proper UX vs window.prompt)
  const [settleTrip, setSettleTrip] = useState<any | null>(null)
  const [settleMethod, setSettleMethod] = useState<'upi' | 'cash'>('upi')
  const [settleRef, setSettleRef] = useState('')
  const [submittingSettle, setSubmittingSettle] = useState(false)

  // Edit / Settle states
  const [editingTrip, setEditingTrip] = useState<any | null>(null)
  const [showEditSheet, setShowEditSheet] = useState(false)
  const [editForm, setEditForm] = useState({
    vehicle_plate: '',
    vehicle_type: '12WH',
    cubic_capacity: '20',
    ownership: 'rented',
    contractor_id: '',
    permit_number: '',
    advance_amount: '0',
    customer_id: '',
    drop_location: '',
    distance_km: '',
    total_shipment_cost: '',
    notes: '',
    settled: false,
    settlement_method: 'upi',
    settlement_ref: '',
  })
  const [editPhotos, setEditPhotos] = useState<File[]>([])
  const [editPhotoUrls, setEditPhotoUrls] = useState<string[]>([])

  const todayStr = format(new Date(), 'yyyy-MM-dd')

  useEffect(() => {
    if (authLoading) return
    if (!user) return
    loadInitialData()
  }, [authLoading, user])

  // Deep-link from bottom nav: /dashboard/my-work?action=trip|expense
  // (employees cannot open /dashboard/trips or /dashboard/cash-book — proxy redirects)
  useEffect(() => {
    if (authLoading || loading) return
    const action = searchParams.get('action')
    if (!action) return

    if (action === 'trip') {
      if (canTrips) {
        setShowTripSheet(true)
      } else {
        toast.error('Trips are not enabled for your organization')
      }
    } else if (action === 'expense') {
      if (canCash) {
        setShowExpenseSheet(true)
      } else {
        toast.error('Cash book is not enabled for your organization')
      }
    }

    // Strip query so back/refresh does not re-open the sheet
    router.replace('/dashboard/my-work', { scroll: false })
  }, [authLoading, loading, searchParams, canTrips, canCash, router])

  // Calculate shipment cost on tripForm changes
  useEffect(() => {
    const rate = negotiatedRates.find(r => r.vehicle_type === tripForm.vehicle_type)?.rate_per_cubic || 0
    const worth = computeTripWorthFromRate(tripForm.cubic_capacity, rate)
    setTripForm(f => ({
      ...f,
      total_shipment_cost: f.total_shipment_cost === '' || f.total_shipment_cost === '0' ? String(worth) : f.total_shipment_cost
    }))
  }, [tripForm.cubic_capacity, tripForm.vehicle_type, negotiatedRates])

  // Calculate shipment cost on editForm changes
  useEffect(() => {
    const rate = negotiatedRates.find(r => r.vehicle_type === editForm.vehicle_type)?.rate_per_cubic || 0
    const worth = computeTripWorthFromRate(editForm.cubic_capacity, rate)
    setEditForm(f => ({
      ...f,
      total_shipment_cost: f.total_shipment_cost === '' || f.total_shipment_cost === '0' ? String(worth) : f.total_shipment_cost
    }))
  }, [editForm.cubic_capacity, editForm.vehicle_type, negotiatedRates])

  const loadInitialData = async () => {
    if (!user) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      // 1. Fetch employee profile
      const { data: empData, error: empError } = await supabase
        .from('employees')
        .select('*, sites(name)')
        .eq('user_id', user.id)
        .maybeSingle()

      if (empError) throw empError
      if (!empData) {
        setEmployee(null)
        setLoading(false)
        return
      }

      setEmployee(empData as any)

      // 2. Fetch list data (scoped to caller org via RLS)
      const [
        { data: veh },
        { data: cont },
        { data: cust },
        { data: rates },
        { data: trips },
      ] = await Promise.all([
        supabase.from('vehicles').select('*').eq('active', true).order('plate_number'),
        supabase.from('transport_contractors').select('*').eq('active', true).order('name'),
        supabase.from('customers').select('*').eq('active', true).order('name'),
        supabase.from('negotiated_rates').select('*'),
        supabase.from('trips').select('*, vehicles(plate_number), customers(name)')
          .eq('created_by', user.id)
          .eq('trip_date', todayStr)
          .eq('active', true)
      ])

      setVehicles(veh || [])
      setContractors(cont || [])
      setCustomers(cust || [])
      setNegotiatedRates(rates || [])
      setTodayTrips(trips || [])

      // Today's expenses logged by this user
      try {
        if (!empData.site_id) throw new Error('no site')
        const myExp = await cashBookRepository.listMyEntriesForDate(
          supabase,
          empData.site_id,
          todayStr,
          user.id
        )
        setTodayExpenses(
          (myExp || []).map((e) => ({
            id: e.id,
            category: e.category,
            amount: Number(e.amount),
            note: e.note,
            created_at: e.created_at,
          }))
        )
      } catch {
        setTodayExpenses([])
      }

      // 3. Prompt attendance check
      const { data: todayAtt } = await supabase
        .from('attendance')
        .select('*')
        .eq('employee_id', empData.id)
        .eq('att_date', todayStr)
        .maybeSingle()

      if (!todayAtt) {
        setShowAttendancePrompt(true)
      }

      // 4. Prompt leave application check (look back 1 day, ignore Sundays)
      const yesterday = subDays(new Date(), 1)
      if (yesterday.getDay() !== 0) { // Not Sunday
        const yestStr = format(yesterday, 'yyyy-MM-dd')
        setYesterdayDateStr(yestStr)

        const [{ data: yestAtt }, { data: yestLeave }] = await Promise.all([
          supabase.from('attendance').select('*').eq('employee_id', empData.id).eq('att_date', yestStr).maybeSingle(),
          supabase.from('leave_applications').select('*').eq('employee_id', empData.id).eq('from_date', yestStr).maybeSingle()
        ])

        if (!yestAtt && !yestLeave) {
          setShowLeaveBanner(true)
        }
      }

    } catch (err: unknown) {
      toast.error(`Error loading profile: ${toErrorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const markAttendance = async (status: 'present' | 'absent' | 'half-day') => {
    if (!employee || !user) return
    try {
      const { error } = await supabase
        .from('attendance')
        .upsert({
          employee_id: employee.id,
          att_date: todayStr,
          status,
          marked_by: user.id
        }, { onConflict: 'employee_id,att_date' })

      if (error) throw error
      toast.success(`Attendance marked as ${status}`)
      setShowAttendancePrompt(false)
    } catch (err: unknown) {
      toast.error(`Failed to mark attendance: ${toErrorMessage(err)}`)
    }
  }

  const applyLeave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employee) return
    try {
      const { error } = await supabase
        .from('leave_applications')
        .insert({
          employee_id: employee.id,
          from_date: yesterdayDateStr,
          to_date: yesterdayDateStr,
          reason: leaveReason || 'Attendance missing prompt',
          status: 'pending'
        })

      if (error) throw error
      toast.success('Leave application submitted for yesterday')
      setShowLeaveForm(false)
      setShowLeaveBanner(false)
    } catch (err: unknown) {
      toast.error(`Failed to apply for leave: ${toErrorMessage(err)}`)
    }
  }

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024 // matches storage.buckets file_size_limit (Phase E2)

  const uploadPhotos = async (files: File[], siteId: string): Promise<string[]> => {
    const urls: string[] = []
    for (const file of files) {
      if (file.size > MAX_PHOTO_BYTES) {
        throw new Error(`Photo "${file.name}" exceeds 5MB limit`)
      }
      const ext = file.name.split('.').pop() || 'jpg'
      const fileUuid = crypto.randomUUID()
      // Path must start with site_id for storage RLS (026/045)
      const path = `${siteId}/${todayStr}/${fileUuid}.${ext}`
      const { data, error } = await supabase.storage
        .from('trip-photos')
        .upload(path, file, { upsert: true })
      
      if (error) throw error
      if (data) urls.push(path)
    }
    return urls
  }

  const handleTripSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canTrips) {
      toast.error('Trips module is not enabled for your organization')
      return
    }
    if (!employee || !user) return
    const allPhotoFiles = [...(entryPhoto ? [entryPhoto] : []), ...tripPhotos]
    if (allPhotoFiles.length > 10) {
      toast.error('You can upload a maximum of 10 photos per trip (1 entry + up to 9 trip photos)')
      return
    }

    setSubmittingTrip(true)
    try {
      // Find or register vehicle
      let vehicleId = ''
      const upperPlate = tripForm.vehicle_plate.toUpperCase().trim()
      const existingVeh = vehicles.find(v => v.plate_number === upperPlate)
      
      if (existingVeh) {
        vehicleId = existingVeh.id
      } else {
        const { data: newVeh, error: createError } = await supabase
          .from('vehicles')
          .insert({
            plate_number: upperPlate,
            vehicle_type: tripForm.vehicle_type,
            ownership: tripForm.ownership === 'lease' ? 'rented' : tripForm.ownership,
            default_contractor_id: tripForm.contractor_id || null,
            active: true,
            organization_id: organizationId!
          })
          .select('id')
          .single()

        if (createError) throw createError
        vehicleId = newVeh.id
      }

      // Entry photo first, then in-trip photos (max 10 total)
      const uploadedUrls = await uploadPhotos(allPhotoFiles, employee.site_id)
      const entryPhotoUrl = uploadedUrls[0] || null

      const rate = negotiatedRates.find(r => r.vehicle_type === tripForm.vehicle_type)?.rate_per_cubic || 0
      const capacity = parseFloat(tripForm.cubic_capacity) || 0
      const worth = computeTripWorthFromRate(capacity, rate)

      const newTrip = await tripsRepository.create(supabase, {
        site_id: employee.site_id,
        vehicle_id: vehicleId,
        contractor_id: tripForm.contractor_id || null,
        trip_date: todayStr,
        cubic_capacity: capacity,
        rate_per_cubic: rate,
        advance_amount: parseFloat(tripForm.advance_amount) || 0,
        photo_url: entryPhotoUrl,
        photo_urls: uploadedUrls,
        customer_id: tripForm.customer_id || null,
        drop_location: tripForm.drop_location || null,
        distance_km: parseFloat(tripForm.distance_km) || null,
        total_shipment_cost: parseFloat(tripForm.total_shipment_cost) || worth,
        trip_worth: worth,
        permit_number: tripForm.permit_number || null,
        notes: tripForm.notes || null,
        created_by: user.id,
        ownership_snapshot: tripForm.ownership,
        settled: tripForm.settled,
        settlement_method: tripForm.settled ? tripForm.settlement_method : null,
        settlement_ref: tripForm.settled ? tripForm.settlement_ref : null,
        settled_at: tripForm.settled ? new Date().toISOString() : null,
        settled_by: tripForm.settled ? user.id : null,
        payment_status: tripForm.settled ? 'settled' : 'pending',
        payment_method: tripForm.settled ? tripForm.settlement_method : null,
        payment_reference: tripForm.settled ? tripForm.settlement_ref : null,
      })

      // Sync trip_photos rows for managers / multi-photo views
      if (newTrip?.id && uploadedUrls.length > 0) {
        await supabase.from('trip_photos').insert(
          uploadedUrls.map((url, idx) => ({
            trip_id: newTrip.id,
            photo_url: url,
            sort_order: idx,
          }))
        )
      }

      toast.success('Trip logged successfully')
      setShowTripSheet(false)
      setEntryPhoto(null)
      setTripPhotos([])
      setTripForm({
        vehicle_plate: '',
        vehicle_type: '12WH',
        cubic_capacity: '20',
        ownership: 'rented',
        contractor_id: '',
        permit_number: '',
        advance_amount: '0',
        customer_id: '',
        drop_location: '',
        distance_km: '',
        total_shipment_cost: '',
        notes: '',
        settled: false,
        settlement_method: 'upi',
        settlement_ref: '',
      })
      loadInitialData()
    } catch (err: unknown) {
      const message = err instanceof Error ? toErrorMessage(err) : 'Unknown error'
      toast.error(`Failed to log trip: ${message}`)
    } finally {
      setSubmittingTrip(false)
    }
  }

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    if (!canCash) {
      toast.error('Cash book module is not enabled for your organization')
      return
    }
    e.preventDefault()
    if (!employee || !user) return
    setSubmittingExpense(true)
    try {
      await cashBookRepository.logSiteExpense(supabase, employee.site_id, todayStr, {
        category: expenseForm.category,
        amount: parseFloat(expenseForm.amount),
        note: expenseForm.note || null,
        receiptFile: expenseReceipt,
      })
      toast.success('Expense logged to site cash book')
      setShowExpenseSheet(false)
      setExpenseForm({ category: EXPENSE_CATEGORIES[0], amount: '', note: '' })
      setExpenseReceipt(null)
      void loadInitialData()
    } catch (err: unknown) {
      const message = err instanceof Error ? toErrorMessage(err) : 'Unknown error'
      toast.error(`Failed to log expense: ${message}`)
    } finally {
      setSubmittingExpense(false)
    }
  }

  const startEdit = (trip: any) => {
    setEditingTrip(trip)
    setEditForm({
      vehicle_plate: trip.vehicles?.plate_number || '',
      vehicle_type: trip.vehicles?.vehicle_type || '12WH',
      cubic_capacity: String(trip.cubic_capacity || ''),
      ownership: trip.ownership_snapshot || 'rented',
      contractor_id: trip.contractor_id || '',
      permit_number: trip.permit_number || '',
      advance_amount: String(trip.advance_amount || 0),
      customer_id: trip.customer_id || '',
      drop_location: trip.drop_location || '',
      distance_km: String(trip.distance_km || ''),
      total_shipment_cost: String(trip.total_shipment_cost || ''),
      notes: trip.notes || '',
      settled: trip.settled || false,
      settlement_method: trip.settlement_method || 'upi',
      settlement_ref: trip.settlement_ref || '',
    })
    setEditPhotos([])
    setEditPhotoUrls(trip.photo_urls || [])
    setShowEditSheet(true)
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingTrip || !employee || !user) return
    const totalPhotos = editPhotoUrls.length + editPhotos.length
    if (totalPhotos > 10) {
      toast.error('You can upload a maximum of 10 photos per trip')
      return
    }

    setSubmittingTrip(true)
    try {
      // Find or register vehicle if changed
      let vehicleId = editingTrip.vehicle_id
      const upperPlate = editForm.vehicle_plate.toUpperCase().trim()
      if (upperPlate !== editingTrip.vehicles?.plate_number) {
        const existingVeh = vehicles.find(v => v.plate_number === upperPlate)
        if (existingVeh) {
          vehicleId = existingVeh.id
        } else {
          const { data: newVeh, error: createError } = await supabase
            .from('vehicles')
            .insert({
              plate_number: upperPlate,
              vehicle_type: editForm.vehicle_type,
              ownership: editForm.ownership === 'lease' ? 'rented' : editForm.ownership,
              default_contractor_id: editForm.contractor_id || null,
              active: true,
              organization_id: organizationId!
            })
            .select('id')
            .single()

          if (createError) throw createError
          vehicleId = newVeh.id
        }
      }

      // Upload any new photos
      const newPhotoUrls = await uploadPhotos(editPhotos, employee.site_id)
      const updatedPhotoUrls = [...editPhotoUrls, ...newPhotoUrls]

      // Calculate shipment rates (shared module)
      const capacity = parseFloat(editForm.cubic_capacity) || 0
      const rate = negotiatedRates.find(r => r.vehicle_type === editForm.vehicle_type)?.rate_per_cubic || 0
      const worth = computeTripWorthFromRate(capacity, rate)
      const settleAmt = Number(worth) || Number(editingTrip.settlement_amount) || 0
      if (editForm.settled && settleAmt <= 0) {
        toast.error('Settled trips require a positive settlement amount')
        setSubmittingTrip(false)
        return
      }

      await tripsRepository.update(supabase, editingTrip.id, {
        vehicle_id: vehicleId,
        contractor_id: editForm.contractor_id || null,
        cubic_capacity: capacity,
        rate_per_cubic: rate,
        advance_amount: parseFloat(editForm.advance_amount) || 0,
        photo_urls: updatedPhotoUrls,
        customer_id: editForm.customer_id || null,
        drop_location: editForm.drop_location || null,
        distance_km: parseFloat(editForm.distance_km) || null,
        total_shipment_cost: parseFloat(editForm.total_shipment_cost) || worth,
        trip_worth: worth,
        notes: editForm.notes || null,
        ownership_snapshot: editForm.ownership,
        settled: editForm.settled,
        settlement_method: editForm.settled ? editForm.settlement_method : null,
        settlement_ref: editForm.settled ? editForm.settlement_ref : null,
        settlement_amount: editForm.settled ? settleAmt : editingTrip.settlement_amount,
        payment_status: editForm.settled ? 'settled' : (editingTrip.payment_status || 'pending'),
        settled_at: editForm.settled && !editingTrip.settled ? new Date().toISOString() : editingTrip.settled_at,
        settled_by: editForm.settled && !editingTrip.settled ? user.id : editingTrip.settled_by,
      })
      toast.success('Trip updated successfully')
      setShowEditSheet(false)
      setEditingTrip(null)
      loadInitialData()
    } catch (err: unknown) {
      toast.error(`Update failed: ${toErrorMessage(err)}`)
    } finally {
      setSubmittingTrip(false)
    }
  }

  const openSettleSheet = (trip: any, method: 'upi' | 'cash' = 'upi') => {
    setSettleTrip(trip)
    setSettleMethod(method)
    setSettleRef(trip.settlement_ref || '')
  }

  const handleSettleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settleTrip || !user) return
    if (!settleRef.trim()) {
      toast.error('Please enter a transaction reference number')
      return
    }
    const settleAmt = Number(settleTrip.trip_worth || settleTrip.total_shipment_cost)
    if (!Number.isFinite(settleAmt) || settleAmt <= 0) {
      toast.error('Trip has no positive worth to settle. Edit trip worth first.')
      return
    }
    setSubmittingSettle(true)
    try {
      await tripsRepository.settle(supabase, settleTrip.id, {
        settlement_amount: settleAmt,
        payment_method: settleMethod,
        payment_reference: settleRef.trim(),
        settled_by: user.id,
      })
      toast.success('Trip marked as settled')
      setSettleTrip(null)
      setSettleRef('')
      void loadInitialData()
    } catch (err: unknown) {
      const message = err instanceof Error ? toErrorMessage(err) : 'Unknown error'
      toast.error(`Settlement failed: ${message}`)
    } finally {
      setSubmittingSettle(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: '2rem', height: '2rem' }} />
      </div>
    )
  }

  if (!employee) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <div className="card" style={{ padding: '2rem' }}>
          <AlertCircle size={40} style={{ color: 'var(--danger)', marginBottom: '1rem' }} />
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Roster Profile Missing</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '0.5rem', lineHeight: 1.5 }}>
            Your login account is not linked to any employee record. Please contact your system Administrator to link your user ID under Roster settings.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', paddingBottom: '5rem' }}>
      {/* Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Hello, {employee.name}</h1>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Site: {employee.sites?.name || 'Unassigned'}</p>
        </div>
        <span className="badge badge-blue">Employee Home</span>
      </div>

      {/* Yesterday Leave Application Alert Banner */}
      {canLeave && showLeaveBanner && (
        <div className="card mb-3" style={{ borderLeft: '4px solid var(--amber)', display: 'flex', gap: '0.75rem', padding: '0.75rem' }}>
          <AlertCircle style={{ color: 'var(--amber)', flexShrink: 0 }} size={20} />
          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Missing Attendance Alert</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
              No attendance was marked for you yesterday ({yesterdayDateStr}). Would you like to submit a leave request?
            </div>
            <button className="btn btn-sm btn-ghost" style={{ padding: 0, minHeight: 'unset', color: 'var(--accent)', marginTop: '0.375rem', fontSize: '0.75rem' }}
              onClick={() => setShowLeaveForm(true)}>
              Apply for Leave
            </button>
          </div>
        </div>
      )}

      {!canTrips && !canCash && !canLeave && !canAttendance && (
        <div className="card mb-4" style={{ padding: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          No self-service modules are enabled for your organization. Contact your administrator.
        </div>
      )}

      {/* Stats */}
      {canTrips && (
      <div className="grid-2 mb-4">
        <div className="card" style={{ padding: '0.875rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Trips Logged Today</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem' }}>{todayTrips.length}</div>
        </div>
        <div className="card" style={{ padding: '0.875rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Today&apos;s Shipment Value</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--accent)' }}>
            ₹{todayTrips.reduce((sum, t) => sum + (t.total_shipment_cost || 0), 0).toLocaleString('en-IN')}
          </div>
        </div>
      </div>
      )}

      {/* Logged Trips Today */}
      {canTrips && (
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>Today&apos;s Logged Trips</h3>
        {todayTrips.length === 0 ? (
          <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            No trips logged yet today.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {todayTrips.map(trip => (
              <div key={trip.id} className="trip-card" style={{ padding: '0.75rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{trip.vehicles?.plate_number} ({trip.vehicles?.vehicle_type})</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                    Cust: {trip.customers?.name || 'Generic'} · Location: {trip.drop_location || 'N/A'}
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent)', marginTop: '0.25rem' }}>
                    Worth: ₹{(trip.total_shipment_cost || 0).toLocaleString('en-IN')}
                  </div>
                  {trip.settled ? (
                    <span className="badge badge-success" style={{ marginTop: '0.375rem', display: 'inline-block' }}>
                      Settled ({trip.settlement_method} · {trip.settlement_ref})
                    </span>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        style={{ padding: '0.125rem 0.5rem', border: '1px solid var(--accent)', color: 'var(--accent)' }}
                        onClick={() => openSettleSheet(trip, 'upi')}
                      >
                        Settle UPI
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        style={{ padding: '0.125rem 0.5rem', border: '1px solid var(--success)', color: 'var(--success)' }}
                        onClick={() => openSettleSheet(trip, 'cash')}
                      >
                        Settle Cash
                      </button>
                    </div>
                  )}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => startEdit(trip)}>Edit</button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Today's expenses (own entries) */}
      {canCash && todayExpenses.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>Today&apos;s Expenses</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {todayExpenses.map((ex) => (
              <div key={ex.id} className="card" style={{ padding: '0.75rem', display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{ex.category}</div>
                  {ex.note && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ex.note}</div>
                  )}
                </div>
                <div style={{ fontWeight: 700, color: 'var(--danger)' }}>
                  −₹{ex.amount.toLocaleString('en-IN')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Floating Bottom Major Action Buttons */}
      {(canCash || canTrips) && (
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--bg-card)',
        borderTop: '1px solid var(--border)',
        padding: '0.75rem',
        display: 'flex',
        gap: '0.75rem',
        zIndex: 99
      }}>
        {canCash && (
        <button className="btn btn-secondary w-full btn-lg" type="button" onClick={() => setShowExpenseSheet(true)}>
          Log Expense
        </button>
        )}
        {canTrips && (
        <button className="btn btn-primary w-full btn-lg" type="button" onClick={() => setShowTripSheet(true)}>
          + Log Trip
        </button>
        )}
      </div>
      )}

      {/* 1. Daily Attendance Verification Sheet Prompt */}
      {canAttendance && showAttendancePrompt && (
        <>
          <div className="sheet-overlay" style={{ zIndex: 1000 }} />
          <div className="sheet" style={{ zIndex: 1001, padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem', textAlign: 'center' }}>Daily Attendance Check</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '1.25rem' }}>
              Please verify your attendance for today ({todayStr}).
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button className="btn btn-primary btn-lg" onClick={() => markAttendance('present')}>
                Present (Full Day)
              </button>
              <button className="btn btn-secondary btn-lg" onClick={() => markAttendance('half-day')}>
                Half Day
              </button>
              <button className="btn btn-ghost btn-lg" style={{ color: 'var(--danger)' }} onClick={() => markAttendance('absent')}>
                Absent / On Leave
              </button>
            </div>
          </div>
        </>
      )}

      {/* 2. Leave Form Bottom Sheet */}
      {canLeave && showLeaveForm && (
        <>
          <div className="sheet-overlay" onClick={() => setShowLeaveForm(false)} style={{ zIndex: 1000 }} />
          <div className="sheet" style={{ zIndex: 1001, padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Apply Leave for {yesterdayDateStr}</h3>
            <form onSubmit={applyLeave}>
              <div className="form-group">
                <label className="form-label">Reason for Absence</label>
                <textarea className="form-input" rows={3} placeholder="Sick leave / personal work etc."
                  value={leaveReason} onChange={e => setLeaveReason(e.target.value)} required />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button type="button" className="btn btn-secondary w-full" onClick={() => setShowLeaveForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary w-full">Apply</button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* 3. Log Trip Bottom Sheet Form */}
      <BottomSheet isOpen={canTrips && showTripSheet} onClose={() => setShowTripSheet(false)} title="Log New Trip">
        <form onSubmit={handleTripSubmit}>
          <div className="form-group">
            <label className="form-label">Vehicle Plate Number *</label>
            <input className="form-input" style={{ textTransform: 'uppercase' }} placeholder="e.g. TN-01-AB-1234"
              value={tripForm.vehicle_plate} onChange={e => setTripForm(f => ({ ...f, vehicle_plate: e.target.value }))} required />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Vehicle Type</label>
              <select className="form-input form-select" value={tripForm.vehicle_type}
                onChange={e => {
                  const type = e.target.value
                  setTripForm(f => ({
                    ...f,
                    vehicle_type: type,
                    cubic_capacity: getCapacityForType(type)
                  }))
                }}>
                {VEHICLE_TYPES.map((t) => (
                  <option key={t} value={t}>{vehicleTypeLabel(t)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Cubic Capacity (CUM) *</label>
              <input className="form-input" type="number" placeholder="20"
                value={tripForm.cubic_capacity} onChange={e => setTripForm(f => ({ ...f, cubic_capacity: e.target.value }))} required />
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Ownership</label>
              <select className="form-input form-select" value={tripForm.ownership}
                onChange={e => setTripForm(f => ({ ...f, ownership: e.target.value }))}>
                <option value="rented">Rented</option>
                <option value="owned">Owned</option>
                <option value="lease">Leased</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Contractor (Optional)</label>
              <select className="form-input form-select" value={tripForm.contractor_id}
                onChange={e => setTripForm(f => ({ ...f, contractor_id: e.target.value }))}>
                <option value="">None / Select Contractor</option>
                {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Permit Number</label>
            <input className="form-input" placeholder="Permit reference ID"
              value={tripForm.permit_number} onChange={e => setTripForm(f => ({ ...f, permit_number: e.target.value }))} />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Customer</label>
              <select className="form-input form-select" value={tripForm.customer_id}
                onChange={e => setTripForm(f => ({ ...f, customer_id: e.target.value }))}>
                <option value="">Select Customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Drop Location</label>
              <input className="form-input" placeholder="e.g. Site B Yard"
                value={tripForm.drop_location} onChange={e => setTripForm(f => ({ ...f, drop_location: e.target.value }))} />
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Distance (KM)</label>
              <input className="form-input" type="number" placeholder="45"
                value={tripForm.distance_km} onChange={e => setTripForm(f => ({ ...f, distance_km: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Advance Amount Paid (₹)</label>
              <input className="form-input" type="number" placeholder="1000"
                value={tripForm.advance_amount} onChange={e => setTripForm(f => ({ ...f, advance_amount: e.target.value }))} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Total Shipment Cost / Price (₹) *</label>
            <input className="form-input" type="number" placeholder="Calculated automatically"
              value={tripForm.total_shipment_cost} onChange={e => setTripForm(f => ({ ...f, total_shipment_cost: e.target.value }))} required />
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
              Note: Autocalculated rate worth is ₹{(parseFloat(tripForm.cubic_capacity) || 0) * (negotiatedRates.find(r => r.vehicle_type === tripForm.vehicle_type)?.rate_per_cubic || 0)}
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Entry photo (gate / entry capture)</label>
            <input
              className="form-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setEntryPhoto(e.target.files?.[0] || null)}
            />
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {entryPhoto ? `Selected: ${entryPhoto.name}` : 'Optional. First photo is stored as the entry capture.'}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Trip photos (max 9 more · 10 total)</label>
            <input
              className="form-input"
              type="file"
              multiple
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                if (e.target.files) {
                  const files = Array.from(e.target.files).slice(0, entryPhoto ? 9 : 10)
                  setTripPhotos(files)
                }
              }}
            />
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Trip photos: {tripPhotos.length}
              {entryPhoto ? ' + 1 entry' : ''}
              {' '}(max 10 total)
            </div>
          </div>

          <div className="card mb-3" style={{ padding: '0.875rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>
              <input type="checkbox" checked={tripForm.settled} onChange={e => setTripForm(f => ({ ...f, settled: e.target.checked }))} />
              Is this trip settled immediately?
            </label>

            {tripForm.settled && (
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', flexDirection: 'column' }}>
                <div className="form-group">
                  <label className="form-label">Payment Method</label>
                  <select className="form-input form-select" value={tripForm.settlement_method}
                    onChange={e => setTripForm(f => ({ ...f, settlement_method: e.target.value }))}>
                    <option value="upi">UPI / Online Transfer</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Reference ID / Txn Number *</label>
                  <input className="form-input" placeholder="e.g. UPI Ref, Cash Receipt #"
                    value={tripForm.settlement_ref} onChange={e => setTripForm(f => ({ ...f, settlement_ref: e.target.value }))} required={tripForm.settled} />
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input" placeholder="Any extra information"
              value={tripForm.notes} onChange={e => setTripForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary w-full" onClick={() => setShowTripSheet(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary w-full" disabled={submittingTrip}>
              {submittingTrip ? <span className="spinner" /> : 'Log Trip'}
            </button>
          </div>
        </form>
      </BottomSheet>

      {/* 4. Edit Trip Bottom Sheet Form */}
      <BottomSheet isOpen={showEditSheet} onClose={() => setShowEditSheet(false)} title="Edit Trip Details">
        <form onSubmit={handleEditSubmit}>
          <div className="form-group">
            <label className="form-label">Vehicle Plate Number *</label>
            <input className="form-input" style={{ textTransform: 'uppercase' }} placeholder="e.g. TN-01-AB-1234"
              value={editForm.vehicle_plate} onChange={e => setEditForm(f => ({ ...f, vehicle_plate: e.target.value }))} required />
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Vehicle Type</label>
              <select className="form-input form-select" value={editForm.vehicle_type}
                onChange={e => {
                  const type = e.target.value
                  setEditForm(f => ({
                    ...f,
                    vehicle_type: type,
                    cubic_capacity: getCapacityForType(type)
                  }))
                }}>
                {VEHICLE_TYPES.map((t) => (
                  <option key={t} value={t}>{vehicleTypeLabel(t)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Cubic Capacity (CUM) *</label>
              <input className="form-input" type="number" placeholder="20"
                value={editForm.cubic_capacity} onChange={e => setEditForm(f => ({ ...f, cubic_capacity: e.target.value }))} required />
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Ownership</label>
              <select className="form-input form-select" value={editForm.ownership}
                onChange={e => setEditForm(f => ({ ...f, ownership: e.target.value }))}>
                <option value="rented">Rented</option>
                <option value="owned">Owned</option>
                <option value="lease">Leased</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Contractor (Optional)</label>
              <select className="form-input form-select" value={editForm.contractor_id}
                onChange={e => setEditForm(f => ({ ...f, contractor_id: e.target.value }))}>
                <option value="">None / Select Contractor</option>
                {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Customer</label>
              <select className="form-input form-select" value={editForm.customer_id}
                onChange={e => setEditForm(f => ({ ...f, customer_id: e.target.value }))}>
                <option value="">Select Customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Drop Location</label>
              <input className="form-input" placeholder="e.g. Site B Yard"
                value={editForm.drop_location} onChange={e => setEditForm(f => ({ ...f, drop_location: e.target.value }))} />
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Distance (KM)</label>
              <input className="form-input" type="number" placeholder="45"
                value={editForm.distance_km} onChange={e => setEditForm(f => ({ ...f, distance_km: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Advance Amount Paid (₹)</label>
              <input className="form-input" type="number" placeholder="1000"
                value={editForm.advance_amount} onChange={e => setEditForm(f => ({ ...f, advance_amount: e.target.value }))} />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Total Shipment Cost / Price (₹) *</label>
            <input className="form-input" type="number"
              value={editForm.total_shipment_cost} onChange={e => setEditForm(f => ({ ...f, total_shipment_cost: e.target.value }))} required />
          </div>

          <div className="form-group">
            <label className="form-label">Existing Photo Attachments</label>
            {editPhotoUrls.length === 0 ? (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No photos attached.</div>
            ) : (
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                {editPhotoUrls.map((url, idx) => (
                  <div key={idx} style={{ position: 'relative', width: '60px', height: '60px', borderRadius: '4px', background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)' }}>
                    <ImageIcon size={18} style={{ color: 'var(--text-muted)' }} />
                    <button type="button" onClick={() => setEditPhotoUrls(urls => urls.filter((_, i) => i !== idx))}
                      style={{ position: 'absolute', top: '-5px', right: '-5px', background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: '55%', width: '16px', height: '16px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Add New Photos (Max 10 total)</label>
            <input className="form-input" type="file" multiple accept="image/*"
              onChange={e => {
                if (e.target.files) {
                  setEditPhotos(Array.from(e.target.files))
                }
              }} />
          </div>

          <div className="card mb-3" style={{ padding: '0.875rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>
              <input type="checkbox" checked={editForm.settled} onChange={e => setEditForm(f => ({ ...f, settled: e.target.checked }))} />
              Is this trip settled?
            </label>

            {editForm.settled && (
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.75rem', flexDirection: 'column' }}>
                <div className="form-group">
                  <label className="form-label">Payment Method</label>
                  <select className="form-input form-select" value={editForm.settlement_method}
                    onChange={e => setEditForm(f => ({ ...f, settlement_method: e.target.value }))}>
                    <option value="upi">UPI / Online Transfer</option>
                    <option value="cash">Cash</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Reference ID / Txn Number *</label>
                  <input className="form-input" placeholder="e.g. UPI Ref, Cash Receipt #"
                    value={editForm.settlement_ref} onChange={e => setEditForm(f => ({ ...f, settlement_ref: e.target.value }))} required={editForm.settled} />
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input" placeholder="Any extra information"
              value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary w-full" onClick={() => setShowEditSheet(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary w-full" disabled={submittingTrip}>
              {submittingTrip ? <span className="spinner" /> : 'Save Changes'}
            </button>
          </div>
        </form>
      </BottomSheet>

      {/* 5. Log Expense */}
      <BottomSheet isOpen={canCash && showExpenseSheet} onClose={() => setShowExpenseSheet(false)} title="Log Expense">
        <form onSubmit={handleExpenseSubmit}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Posts an outgoing entry to today&apos;s site cash book for {employee.sites?.name || 'your site'}.
          </p>
          <div className="form-group">
            <label className="form-label">Category *</label>
            <select
              className="form-input form-select"
              value={expenseForm.category}
              onChange={(e) => setExpenseForm((f) => ({ ...f, category: e.target.value }))}
              required
            >
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Amount (₹) *</label>
            <input
              className="form-input"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="e.g. 500"
              value={expenseForm.amount}
              onChange={(e) => setExpenseForm((f) => ({ ...f, amount: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Note</label>
            <textarea
              className="form-input"
              rows={2}
              placeholder="Optional details"
              value={expenseForm.note}
              onChange={(e) => setExpenseForm((f) => ({ ...f, note: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Receipt photo</label>
            <input
              className="form-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setExpenseReceipt(e.target.files?.[0] || null)}
            />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary w-full" onClick={() => setShowExpenseSheet(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary w-full" disabled={submittingExpense}>
              {submittingExpense ? <span className="spinner" /> : 'Save Expense'}
            </button>
          </div>
        </form>
      </BottomSheet>

      {/* 6. Settle payment */}
      <BottomSheet
        isOpen={!!settleTrip}
        onClose={() => { setSettleTrip(null); setSettleRef('') }}
        title="Settle trip payment"
      >
        {settleTrip && (
          <form onSubmit={handleSettleSubmit}>
            <p style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              Collect shipment payment for{' '}
              <strong>{settleTrip.vehicles?.plate_number || 'trip'}</strong>
              {' · '}
              Worth ₹{Number(settleTrip.total_shipment_cost || settleTrip.trip_worth || 0).toLocaleString('en-IN')}
            </p>
            <div className="form-group">
              <label className="form-label">Payment method *</label>
              <select
                className="form-input form-select"
                value={settleMethod}
                onChange={(e) => setSettleMethod(e.target.value as 'upi' | 'cash')}
              >
                <option value="upi">UPI / Online</option>
                <option value="cash">Cash</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Reference / transaction number *</label>
              <input
                className="form-input"
                placeholder={settleMethod === 'upi' ? 'UPI ref / UTR' : 'Cash receipt #'}
                value={settleRef}
                onChange={(e) => setSettleRef(e.target.value)}
                required
              />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary w-full"
                onClick={() => { setSettleTrip(null); setSettleRef('') }}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary w-full" disabled={submittingSettle}>
                {submittingSettle ? <span className="spinner" /> : 'Mark settled'}
              </button>
            </div>
          </form>
        )}
      </BottomSheet>
    </div>
  )
}

export default function EmployeePageRoute() {
  return (
    <Suspense
      fallback={
        <div className="page-container" style={{ padding: '2rem', textAlign: 'center' }}>
          <span className="spinner" />
        </div>
      }
    >
      <EmployeePage />
    </Suspense>
  )
}
