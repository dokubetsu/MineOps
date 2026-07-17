'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, subDays } from 'date-fns'
import { Plus, Image as ImageIcon, Check, X, AlertCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { computeTripWorthFromRate } from '@/lib/calculations'
import BottomSheet from '@/components/BottomSheet'
import toast from 'react-hot-toast'

interface EmployeeData {
  id: string
  name: string
  site_id: string
  sites?: {
    name: string
  } | null
}

export default function EmployeePage() {
  const { user, organizationId, loading: authLoading } = useAuth()
  const supabase = createClient()
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
  const [tripPhotos, setTripPhotos] = useState<File[]>([])

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

  // Capacity default values
  const getCapacityForType = (type: string) => {
    switch (type) {
      case '12WH': return '20'
      case '10WH': return '16'
      case '6WH': return '10'
      default: return '8'
    }
  }

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

    } catch (err: any) {
      toast.error(`Error loading profile: ${err.message}`)
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
    } catch (err: any) {
      toast.error(`Failed to mark attendance: ${err.message}`)
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
    } catch (err: any) {
      toast.error(`Failed to apply for leave: ${err.message}`)
    }
  }

  const uploadPhotos = async (files: File[], siteId: string): Promise<string[]> => {
    const urls: string[] = []
    for (const file of files) {
      const ext = file.name.split('.').pop() || 'jpg'
      const fileUuid = crypto.randomUUID()
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
    if (!employee || !user) return
    if (tripPhotos.length > 10) {
      toast.error('You can upload a maximum of 10 photos per trip')
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
            ownership: tripForm.ownership === 'lease' ? 'rented' : tripForm.ownership, // Map lease/rented appropriately
            default_contractor_id: tripForm.contractor_id || null,
            active: true,
            organization_id: organizationId!
          })
          .select('id')
          .single()

        if (createError) throw createError
        vehicleId = newVeh.id
      }

      // Upload photos
      const uploadedUrls = await uploadPhotos(tripPhotos, employee.site_id)

      // Get calculated negotiated rate (shared module)
      const rate = negotiatedRates.find(r => r.vehicle_type === tripForm.vehicle_type)?.rate_per_cubic || 0
      const capacity = parseFloat(tripForm.cubic_capacity) || 0
      const worth = computeTripWorthFromRate(capacity, rate)

      // Create trip record
      const { error } = await supabase
        .from('trips')
        .insert({
          site_id: employee.site_id,
          vehicle_id: vehicleId,
          contractor_id: tripForm.contractor_id || null,
          trip_date: todayStr,
          cubic_capacity: capacity,
          advance_amount: parseFloat(tripForm.advance_amount) || 0,
          photo_urls: uploadedUrls,
          customer_id: tripForm.customer_id || null,
          drop_location: tripForm.drop_location || null,
          distance_km: parseFloat(tripForm.distance_km) || null,
          total_shipment_cost: parseFloat(tripForm.total_shipment_cost) || worth,
          trip_worth: worth,
          notes: tripForm.notes || null,
          created_by: user.id,
          ownership_snapshot: tripForm.ownership,
          settled: tripForm.settled,
          settlement_method: tripForm.settled ? tripForm.settlement_method : null,
          settlement_ref: tripForm.settled ? tripForm.settlement_ref : null,
          settled_at: tripForm.settled ? new Date().toISOString() : null,
          settled_by: tripForm.settled ? user.id : null,
        })

      if (error) throw error
      toast.success('Trip logged successfully')
      setShowTripSheet(false)
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
    } catch (err: any) {
      toast.error(`Failed to log trip: ${err.message}`)
    } finally {
      setSubmittingTrip(false)
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

      const { error } = await supabase
        .from('trips')
        .update({
          vehicle_id: vehicleId,
          contractor_id: editForm.contractor_id || null,
          cubic_capacity: capacity,
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
          settled_at: editForm.settled && !editingTrip.settled ? new Date().toISOString() : editingTrip.settled_at,
          settled_by: editForm.settled && !editingTrip.settled ? user.id : editingTrip.settled_by,
        })
        .eq('id', editingTrip.id)

      if (error) throw error
      toast.success('Trip updated successfully')
      setShowEditSheet(false)
      setEditingTrip(null)
      loadInitialData()
    } catch (err: any) {
      toast.error(`Update failed: ${err.message}`)
    } finally {
      setSubmittingTrip(false)
    }
  }

  const handleSettleTripQuick = async (tripId: string, method: 'cash' | 'upi', ref: string) => {
    if (!ref.trim()) {
      toast.error('Please enter a transaction reference number')
      return
    }
    if (!user) return
    try {
      const { error } = await supabase
        .from('trips')
        .update({
          settled: true,
          settlement_method: method,
          settlement_ref: ref,
          settled_at: new Date().toISOString(),
          settled_by: user.id
        })
        .eq('id', tripId)

      if (error) throw error
      toast.success('Trip marked as settled')
      loadInitialData()
    } catch (err: any) {
      toast.error(`Settlement failed: ${err.message}`)
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
      {showLeaveBanner && (
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

      {/* Stats */}
      <div className="grid-2 mb-4">
        <div className="card" style={{ padding: '0.875rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Trips Logged Today</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem' }}>{todayTrips.length}</div>
        </div>
        <div className="card" style={{ padding: '0.875rem' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Today's Shipment Value</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--accent)' }}>
            ₹{todayTrips.reduce((sum, t) => sum + (t.total_shipment_cost || 0), 0).toLocaleString('en-IN')}
          </div>
        </div>
      </div>

      {/* Logged Trips Today */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>Today's Logged Trips</h3>
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
                      Settled ({trip.settlement_method} - {trip.settlement_ref})
                    </span>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button className="btn btn-sm btn-ghost" style={{ padding: '0.125rem 0.5rem', border: '1px solid var(--accent)', color: 'var(--accent)' }}
                        onClick={() => {
                          const ref = prompt(`Enter UPI or Cash reference for trip worth ₹${trip.total_shipment_cost}:`)
                          if (ref !== null) handleSettleTripQuick(trip.id, 'upi', ref)
                        }}>
                        Settle UPI
                      </button>
                      <button className="btn btn-sm btn-ghost" style={{ padding: '0.125rem 0.5rem', border: '1px solid var(--success)', color: 'var(--success)' }}
                        onClick={() => {
                          const ref = prompt(`Enter Cash reference/note for trip worth ₹${trip.total_shipment_cost}:`)
                          if (ref !== null) handleSettleTripQuick(trip.id, 'cash', ref)
                        }}>
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

      {/* Floating Bottom Major Action Buttons */}
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
        <button className="btn btn-secondary w-full btn-lg" onClick={() => toast.error('Expense logger to be implemented in Module 2')}>
          Log Expense
        </button>
        <button className="btn btn-primary w-full btn-lg" onClick={() => setShowTripSheet(true)}>
          + Log Trip
        </button>
      </div>

      {/* 1. Daily Attendance Verification Sheet Prompt */}
      {showAttendancePrompt && (
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
      {showLeaveForm && (
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
      <BottomSheet isOpen={showTripSheet} onClose={() => setShowTripSheet(false)} title="Log New Trip">
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
                <option value="12WH">12 Wheeler (12WH)</option>
                <option value="10WH">10 Wheeler (10WH)</option>
                <option value="6WH">6 Wheeler (6WH)</option>
                <option value="Other">Other</option>
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
            <label className="form-label">Upload Photos (Max 10)</label>
            <input className="form-input" type="file" multiple accept="image/*"
              onChange={e => {
                if (e.target.files) {
                  setTripPhotos(Array.from(e.target.files))
                }
              }} />
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Selected {tripPhotos.length} files. Maximum 10 photos.
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
                <option value="12WH">12 Wheeler (12WH)</option>
                <option value="10WH">10 Wheeler (10WH)</option>
                <option value="6WH">6 Wheeler (6WH)</option>
                <option value="Other">Other</option>
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
    </div>
  )
}
