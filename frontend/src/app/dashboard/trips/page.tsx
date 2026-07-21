'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { Plus, Search, Truck, X, Camera, Image as ImageIcon, Pencil, Trash2, Check, ExternalLink } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useRouter } from 'next/navigation'
import { Site, Vehicle, TransportContractor, Trip, Customer, TripPhoto } from '@/lib/supabase/types'
import { tripsRepository } from '@/lib/repositories/trips'
import { getOfflineCache, setOfflineCache } from '@/lib/offline-cache'
import { enqueueOutbox } from '@/lib/offline-outbox'
import { isBrowserOnline, shouldQueueOffline } from '@/lib/offline-network'
import { computeTripWorthFromRate } from '@/lib/calculations'
import BottomSheet from '@/components/BottomSheet'
import ConfirmDialog from '@/components/ConfirmDialog'
import toast from 'react-hot-toast'
import { toErrorMessage } from '@/lib/errors'

import {
  VEHICLE_TYPES,
  OWNERSHIP_TYPES,
  getCapacityForType,
  resolveTripRateForCustomer,
} from '@/lib/trip-constants'
import {
  getCachedSignedUrl,
  prepareUploadImages,
  setCachedSignedUrl,
} from '@/lib/image-utils'

interface ExtendedVehicle extends Vehicle {
  transport_contractors?: {
    name: string
  } | null
}

interface ExtendedTrip extends Trip {
  vehicles?: {
    plate_number: string
    vehicle_type: string
  } | null
  transport_contractors?: {
    name: string
  } | null
  drivers?: {
    name: string
  } | null
  customers?: {
    name: string
  } | null
  trip_photos?: Array<{
    photo_url: string
  }> | null
  signed_photo_urls?: string[] | null
}

export default function TripsPage() {
  const { user, isAdmin, isSiteManager, organizationId, loading: authLoading } = useAuth()
  const router = useRouter()
  const supabase = createClient()
  const PAGE_LIMIT = 20

  const [trips, setTrips] = useState<ExtendedTrip[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [vehicles, setVehicles] = useState<ExtendedVehicle[]>([])
  const [contractors, setContractors] = useState<TransportContractor[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [rates, setRates] = useState<any[]>([])

  const [selectedSite, setSelectedSite] = useState('')
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingTripId, setEditingTripId] = useState<string | null>(null)
  
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [filteredVehicles, setFilteredVehicles] = useState<ExtendedVehicle[]>([])
  
  const [form, setForm] = useState({
    vehicle_id: '',
    plate_number: '',
    contractor_id: '',
    ownership: 'rented',
    vehicle_type: '12WH',
    cubic_capacity: '',
    advance_amount: '0',
    customer_id: '',
    drop_location: '',
    distance_km: '',
    trip_worth: '',
    total_shipment_cost: '',
    payment_status: 'pending',
    payment_method: 'cash',
    payment_reference: '',
    permit_number: '',
    load_info: '',
    notes: '',
  })

  // Multiple photo uploads
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const [existingPhotoUrls, setExistingPhotoUrls] = useState<string[]>([])
  
  const [submitting, setSubmitting] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [usersMap, setUsersMap] = useState<Record<string, string>>({})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Settle trip states
  const [settleTripId, setSettleTripId] = useState<string | null>(null)
  const [settleAmount, setSettleAmount] = useState('')
  const [settleAccount, setSettleAccount] = useState('')
  const [settleMethod, setSettleMethod] = useState('cash')
  const [settleRef, setSettleRef] = useState('')
  const [settleSubmitting, setSettleSubmitting] = useState(false)

  useEffect(() => {
    if (authLoading) return
    if (!isAdmin && !isSiteManager) {
      router.push('/dashboard')
      return
    }
    loadInitialData()
  }, [authLoading, isAdmin, isSiteManager])

  useEffect(() => {
    if (selectedSite) loadTrips(false)
  }, [selectedSite, selectedDate])

  // After offline outbox flush, refresh list from server
  useEffect(() => {
    const onFlushed = () => {
      if (selectedSite) void loadTrips(false)
    }
    window.addEventListener('mineops:outbox-flushed', onFlushed)
    return () => window.removeEventListener('mineops:outbox-flushed', onFlushed)
  }, [selectedSite, selectedDate])

  useEffect(() => {
    if (!selectedSite) return
    const channel = supabase
      .channel(`trips-realtime-${selectedSite}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trips',
          filter: `site_id=eq.${selectedSite}`,
        },
        () => {
          loadTrips(false)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedSite, selectedDate])

  useEffect(() => {
    if (vehicleSearch.length > 0) {
      const filtered = vehicles.filter(v =>
        v.plate_number.toLowerCase().includes(vehicleSearch.toLowerCase())
      )
      setFilteredVehicles(filtered)
    } else {
      setFilteredVehicles([])
    }
  }, [vehicleSearch, vehicles])

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      photoPreviews.forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
      })
    }
  }, [photoPreviews])

  // Auto-fill trip cost: customer rate (type or default) → org vehicle rate → app default
  useEffect(() => {
    const cust = customers.find((c) => c.id === form.customer_id) as
      | { default_trip_rate?: number | null; trip_rates?: Record<string, number> | null }
      | undefined
    const { rate } = resolveTripRateForCustomer(form.vehicle_type, cust || null, rates)
    const worth = String(computeTripWorthFromRate(null, rate))
    setForm((f) => {
      if (f.trip_worth === worth && f.total_shipment_cost === worth) return f
      const ship =
        !f.total_shipment_cost ||
        f.total_shipment_cost === f.trip_worth ||
        f.total_shipment_cost === '0'
          ? worth
          : f.total_shipment_cost
      return { ...f, trip_worth: worth, total_shipment_cost: ship }
    })
  }, [form.vehicle_type, form.customer_id, rates, customers])

  const loadInitialData = async () => {
    try {
      const [{ data: sitesData }, { data: vehiclesData }, { data: contractorsData }, { data: customersData }, { data: ratesData }] = await Promise.all([
        supabase.from('sites').select('*').eq('active', true).order('name'),
        supabase.from('vehicles').select('*, transport_contractors(name)').eq('active', true).order('plate_number'),
        supabase.from('transport_contractors').select('*').eq('active', true).order('name'),
        supabase.from('customers').select('*').eq('active', true).order('name'),
        supabase.from('negotiated_rates').select('*'),
      ])
      
      const loadedSites = sitesData || []
      setSites(loadedSites)
      setVehicles((vehiclesData as any) || [])
      setContractors(contractorsData || [])
      setCustomers(customersData || [])
      setRates(ratesData || [])

      if (loadedSites.length > 0) {
        setSelectedSite(loadedSites[0].id)
      }

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
      toast.error(`Error loading master data: ${toErrorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const loadTrips = async (loadMore = false) => {
    if (loadMore) {
      setLoadingMore(true)
    } else {
      setLoading(true)
    }
    try {
      const offset = loadMore ? trips.length : 0
      const data = await tripsRepository.list(supabase, selectedSite, selectedDate, PAGE_LIMIT, offset)
      
      const tripsWithSignedUrls = await Promise.all(data.map(async (trip) => {
        // Load all photos for this trip from trip_photos
        const { data: photos } = await supabase
          .from('trip_photos')
          .select('photo_url')
          .eq('trip_id', trip.id)
          .order('sort_order')

        const photoUrls = photos && photos.length > 0 ? photos.map(p => p.photo_url) : (trip.photo_url ? [trip.photo_url] : [])
        // Only sign first photo for list view (faster); full set on edit
        const listPaths = photoUrls.slice(0, 1)
        const signedUrls = await Promise.all(listPaths.map(async (p) => {
          let path = p
          if (path.includes('trip-photos/')) {
            path = path.split('trip-photos/').pop() || path
          }
          const cacheKey = `trip-photos:${path}`
          const cached = getCachedSignedUrl(cacheKey)
          if (cached) return cached
          const { data: signed } = await supabase.storage
            .from('trip-photos')
            .createSignedUrl(path, 3600)
          const url = signed?.signedUrl || null
          if (url) setCachedSignedUrl(cacheKey, url)
          return url
        }))

        return {
          ...trip,
          signed_photo_urls: signedUrls.filter(Boolean) as string[]
        }
      }))

      const cacheKey = `trips_${selectedSite}_${selectedDate}`
      // Never persist signed photo URLs
      const cacheableTrips = tripsWithSignedUrls.map(({ signed_photo_urls: _s, ...rest }) => rest)

      if (loadMore) {
        setTrips(prev => {
          const nextTrips = [...prev, ...tripsWithSignedUrls]
          const cacheable = nextTrips.map(({ signed_photo_urls: _s, ...rest }) => rest)
          setOfflineCache(user?.id, organizationId, cacheKey, cacheable)
          return nextTrips
        })
      } else {
        setTrips(tripsWithSignedUrls)
        setOfflineCache(user?.id, organizationId, cacheKey, cacheableTrips)
      }
      setHasMore(data.length === PAGE_LIMIT)
    } catch (error: unknown) {
      const message = error instanceof Error ? toErrorMessage(error) : 'Unknown error'
      const cached = getOfflineCache<ExtendedTrip[]>(user?.id, organizationId, `trips_${selectedSite}_${selectedDate}`)
      if (cached && !loadMore) {
        setTrips(cached)
        toast('Serving cached trip logs (offline mode)', { icon: '📶' })
      } else {
        toast.error(`Error loading trips: ${message}`)
        if (!loadMore) setTrips([])
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  const selectVehicle = (vehicle: ExtendedVehicle) => {
    const vType = vehicle.vehicle_type || '12WH'
    const defaultCap =
      vehicle.default_cubic_capacity != null && Number(vehicle.default_cubic_capacity) > 0
        ? String(vehicle.default_cubic_capacity)
        : getCapacityForType(vType)

    setForm((f) => ({
      ...f,
      vehicle_id: vehicle.id,
      plate_number: vehicle.plate_number,
      contractor_id: vehicle.default_contractor_id || '',
      ownership: vehicle.ownership || 'rented',
      vehicle_type: vType,
      cubic_capacity: defaultCap,
    }))
    setVehicleSearch(vehicle.plate_number)
    setFilteredVehicles([])
  }

  const handleVehicleTypeChange = (type: '12WH' | '10WH' | '6WH' | 'Other') => {
    setForm((f) => ({
      ...f,
      vehicle_type: type,
      cubic_capacity: getCapacityForType(type),
    }))
  }

  const handlePhotosSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    opts?: { fromCamera?: boolean }
  ) => {
    const files = e.target.files
    if (!files) return
    const picked = Array.from(files)
    if (photoFiles.length + existingPhotoUrls.length + picked.length > 10) {
      toast.error('You can upload a maximum of 10 photos')
      e.target.value = ''
      return
    }

    for (const f of picked) {
      if (f.size > 12 * 1024 * 1024) {
        toast.error(`${f.name} is too large (max 12MB before compress)`)
        e.target.value = ''
        return
      }
    }

    const newFiles = await prepareUploadImages(picked, {
      saveToGallery: !!opts?.fromCamera,
    })
    if (opts?.fromCamera && newFiles.length > 0) {
      toast.success('Photo saved to device and attached', { icon: '📷' })
    }

    const newPreviews = newFiles.map((f) => URL.createObjectURL(f))
    setPhotoFiles((prev) => [...prev, ...newFiles])
    setPhotoPreviews((prev) => [...prev, ...newPreviews])
    e.target.value = ''
  }

  const removePhoto = (index: number) => {
    if (index < existingPhotoUrls.length) {
      // Remove from existing
      setExistingPhotoUrls(prev => prev.filter((_, i) => i !== index))
    } else {
      // Remove from newly added files
      const fileIdx = index - existingPhotoUrls.length
      const previewUrl = photoPreviews[index]
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl)
      }
      setPhotoFiles(prev => prev.filter((_, i) => i !== fileIdx))
    }
    setPhotoPreviews(prev => prev.filter((_, i) => i !== index))
  }

  const startEditTrip = async (trip: ExtendedTrip) => {
    setEditingTripId(trip.id)
    setForm({
      vehicle_id: trip.vehicle_id || '',
      plate_number: trip.vehicles?.plate_number || '',
      contractor_id: trip.contractor_id || '',
      ownership: (trip.ownership_snapshot as any) || 'rented',
      vehicle_type: (trip.vehicles?.vehicle_type as any) || '12WH',
      cubic_capacity: String(trip.cubic_capacity || ''),
      advance_amount: String(trip.advance_amount || '0'),
      customer_id: trip.customer_id || '',
      drop_location: trip.drop_location || '',
      distance_km: String(trip.distance_km || ''),
      trip_worth: String(trip.trip_worth || ''),
      total_shipment_cost: String(trip.total_shipment_cost || ''),
      payment_status: trip.payment_status || 'pending',
      payment_method: (trip.payment_method as any) || 'cash',
      payment_reference: trip.payment_reference || '',
      permit_number: trip.permit_number || '',
      load_info: trip.load_info || '',
      notes: trip.notes || '',
    })
    setVehicleSearch(trip.vehicles?.plate_number || '')

    // Load existing trip photos
    const { data: photos } = await supabase
      .from('trip_photos')
      .select('*')
      .eq('trip_id', trip.id)
      .order('sort_order')

    const photoPaths = photos && photos.length > 0 ? photos.map(p => p.photo_url) : (trip.photo_url ? [trip.photo_url] : [])
    setExistingPhotoUrls(photoPaths)

    const signedUrls = await Promise.all(photoPaths.map(async (p) => {
      let path = p
      if (path.includes('trip-photos/')) {
        path = path.split('trip-photos/').pop() || path
      }
      const cacheKey = `trip-photos:${path}`
      const cached = getCachedSignedUrl(cacheKey)
      if (cached) return cached
      const { data: signed } = await supabase.storage
        .from('trip-photos')
        .createSignedUrl(path, 3600)
      const url = signed?.signedUrl || p
      if (signed?.signedUrl) setCachedSignedUrl(cacheKey, signed.signedUrl)
      return url
    }))

    setPhotoPreviews(signedUrls.filter(Boolean) as string[])
    setPhotoFiles([])
    setShowForm(true)
  }

  const queueTripCreateOffline = (args: {
    vehicleId: string | null
    plate: string
    photoPaths: string[]
    payload: Parameters<typeof tripsRepository.create>[1]
  }) => {
    const clientId = crypto.randomUUID()
    const item = enqueueOutbox(user?.id, organizationId, {
      kind: 'trip_create',
      client_id: clientId,
      vehicle_plate: args.plate || null,
      vehicle_type: form.vehicle_type,
      ownership: form.ownership,
      photo_paths: args.photoPaths,
      trip: {
        ...args.payload,
        vehicle_id: args.vehicleId,
        organization_id: organizationId || undefined,
      },
    })
    if (!item) {
      toast.error('Could not queue trip offline (storage full or not signed in)')
      return false
    }
    // Optimistic list row in memory + read cache
    const optimistic = {
      id: clientId,
      site_id: selectedSite,
      trip_date: selectedDate,
      vehicle_id: args.vehicleId,
      ownership_snapshot: form.ownership,
      trip_worth: parseFloat(form.trip_worth) || null,
      active: true,
      vehicles: {
        plate_number: (args.plate || 'PENDING').toUpperCase(),
        vehicle_type: form.vehicle_type,
      },
      transport_contractors: null,
      _offline_pending: true,
    } as ExtendedTrip & { _offline_pending?: boolean }
    setTrips((prev) => [optimistic, ...prev])
    const cacheKey = `trips_${selectedSite}_${selectedDate}`
    const prevCache = getOfflineCache<ExtendedTrip[]>(user?.id, organizationId, cacheKey) || []
    setOfflineCache(user?.id, organizationId, cacheKey, [optimistic, ...prevCache])
    toast.success('Trip saved offline — will sync when online', { icon: '📶' })
    if (photoFiles.length > 0) {
      toast('Photos were not stored offline — re-attach after sync if needed', { icon: '📷' })
    }
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    let vehicleId = form.vehicle_id
    const plate = vehicleSearch.toUpperCase().trim()

    const buildPayload = (vId: string | null, photoPaths: string[]) => ({
      site_id: selectedSite,
      vehicle_id: vId || null,
      contractor_id: form.contractor_id || null,
      trip_date: selectedDate,
      ownership_snapshot: form.ownership,
      permit_number: form.permit_number || null,
      load_info: form.load_info || null,
      notes: form.notes || null,
      photo_url: photoPaths[0] || null,
      cubic_capacity: parseFloat(form.cubic_capacity) || null,
      advance_amount: parseFloat(form.advance_amount) || 0,
      customer_id: form.customer_id || null,
      drop_location: form.drop_location || null,
      distance_km: parseFloat(form.distance_km) || null,
      trip_worth: parseFloat(form.trip_worth) || null,
      total_shipment_cost: parseFloat(form.total_shipment_cost) || null,
      payment_status: form.payment_status,
      payment_method: form.payment_status === 'settled' ? form.payment_method : null,
      payment_reference: form.payment_status === 'settled' ? form.payment_reference : null,
      settled: form.payment_status === 'settled',
      settlement_amount: form.payment_status === 'settled' ? (parseFloat(form.trip_worth) || 0) : 0,
      settlement_account: form.payment_status === 'settled' ? (form.payment_reference || 'UPI/Cash') : null,
    })

    const resetFormAfterSave = () => {
      setShowForm(false)
      setEditingTripId(null)
      setForm({
        vehicle_id: '', plate_number: '', contractor_id: form.contractor_id,
        ownership: form.ownership, vehicle_type: form.vehicle_type, cubic_capacity: '',
        advance_amount: '0', customer_id: '', drop_location: '', distance_km: '',
        trip_worth: '', total_shipment_cost: '', payment_status: 'pending',
        payment_method: 'cash', payment_reference: '', permit_number: '', load_info: '', notes: ''
      })
      setVehicleSearch('')
      setPhotoFiles([])
      setPhotoPreviews([])
      setExistingPhotoUrls([])
    }

    // Offline path: queue create (edits require server row id)
    if (!isBrowserOnline() && !editingTripId) {
      if (!selectedSite || !plate) {
        toast.error('Site and vehicle number are required offline')
        setSubmitting(false)
        return
      }
      const payload = buildPayload(vehicleId || null, existingPhotoUrls)
      if (payload.settled && !(Number(payload.settlement_amount) > 0)) {
        toast.error('Settled trips require trip worth / settlement amount greater than zero')
        setSubmitting(false)
        return
      }
      queueTripCreateOffline({
        vehicleId: vehicleId || null,
        plate,
        photoPaths: existingPhotoUrls,
        payload,
      })
      resetFormAfterSave()
      setSubmitting(false)
      return
    }

    try {
      // 1. Resolve/create vehicle
      if (!vehicleId && vehicleSearch) {
        const upperPlate = vehicleSearch.toUpperCase()
        const { data: existing } = await supabase.from('vehicles')
          .select('id')
          .eq('plate_number', upperPlate)
          .maybeSingle()

        if (existing) {
          vehicleId = existing.id
        } else {
          const { data: newVehicle, error: createError } = await supabase.from('vehicles').insert({
            plate_number: upperPlate,
            vehicle_type: form.vehicle_type,
            ownership: form.ownership,
            default_contractor_id: form.contractor_id || null,
            active: true,
            organization_id: organizationId!,
          }).select().single()

          if (createError) throw createError
          vehicleId = newVehicle?.id || ''
        }
      }

      // 2. Upload photos in parallel (already compressed client-side)
      const uploadedPaths = (
        await Promise.all(
          photoFiles.map(async (file) => {
            const ext = file.name.split('.').pop() || 'jpg'
            const fileUuid = crypto.randomUUID()
            const path = `${selectedSite}/${selectedDate}/${fileUuid}.${ext}`
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from('trip-photos')
              .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' })
            if (uploadError) throw uploadError
            return uploadData ? path : null
          })
        )
      ).filter(Boolean) as string[]

      const finalPhotos = [...existingPhotoUrls, ...uploadedPaths]
      const payload = buildPayload(vehicleId || null, finalPhotos)

      if (payload.settled && !(Number(payload.settlement_amount) > 0)) {
        toast.error('Settled trips require trip worth / settlement amount greater than zero')
        setSubmitting(false)
        return
      }

      let tripId = editingTripId

      if (editingTripId) {
        const { error: updateError } = await supabase
          .from('trips')
          .update(payload)
          .eq('id', editingTripId)

        if (updateError) throw updateError
        toast.success('Trip updated successfully')
      } else {
        const newTrip = await tripsRepository.create(supabase, payload)
        tripId = newTrip.id
        toast.success('Trip logged successfully')
      }

      if (tripId) {
        await supabase.from('trip_photos').delete().eq('trip_id', tripId)
        if (finalPhotos.length > 0) {
          const photoInserts = finalPhotos.map((url, idx) => ({
            trip_id: tripId!,
            photo_url: url,
            sort_order: idx,
          }))
          const { error: photoErr } = await supabase.from('trip_photos').insert(photoInserts)
          if (photoErr) {
            console.error('Failed to sync trip photos:', photoErr.message)
          }
        }
      }

      resetFormAfterSave()
      loadTrips()
    } catch (error: unknown) {
      if (!editingTripId && shouldQueueOffline(error) && plate) {
        const payload = buildPayload(vehicleId || null, existingPhotoUrls)
        if (
          queueTripCreateOffline({
            vehicleId: vehicleId || null,
            plate,
            photoPaths: existingPhotoUrls,
            payload,
          })
        ) {
          resetFormAfterSave()
          setSubmitting(false)
          return
        }
      }
      toast.error(`Error saving trip: ${toErrorMessage(error)}`)
    } finally {
      setSubmitting(false)
    }
  }

  const executeDeleteTrip = async () => {
    if (!confirmDeleteId) return
    try {
      await tripsRepository.delete(supabase, confirmDeleteId)
      toast.success('Trip deleted')
      loadTrips()
    } catch (error: unknown) {
      toast.error(`Error deleting trip: ${toErrorMessage(error)}`)
    } finally {
      setConfirmDeleteId(null)
    }
  }

  const handleSettleTrip = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!settleTripId) return
    const amt = parseFloat(settleAmount)
    if (isNaN(amt) || amt <= 0) {
      toast.error('Please enter a settlement amount greater than zero')
      return
    }
    if (!settleAccount.trim()) {
      toast.error('Please enter whose account/destination')
      return
    }
    setSettleSubmitting(true)
    try {
      await tripsRepository.settle(supabase, settleTripId, {
        settlement_amount: amt,
        settlement_account: settleAccount.trim(),
        payment_status: 'settled',
        payment_method: settleMethod,
        payment_reference: settleRef.trim() || undefined,
        settled_by: user?.id
      })
      toast.success('Trip settled successfully')
      setSettleTripId(null)
      setSettleAmount('')
      setSettleAccount('')
      setSettleMethod('cash')
      setSettleRef('')
      loadTrips()
    } catch (err: unknown) {
      toast.error(`Error settling trip: ${toErrorMessage(err)}`)
    } finally {
      setSettleSubmitting(false)
    }
  }

  const byContractor = trips.reduce((acc, t) => {
    const name = t.transport_contractors?.name || 'Unknown'
    if (!acc[name]) acc[name] = []
    acc[name].push(t)
    return acc
  }, {} as Record<string, ExtendedTrip[]>)

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Trips</h1>
          <p className="page-subtitle">Vehicle Movement Log</p>
        </div>
        <button className="btn btn-primary" onClick={() => {
          setEditingTripId(null)
          setPhotoFiles([])
          setPhotoPreviews([])
          setExistingPhotoUrls([])
          setForm({
            vehicle_id: '', plate_number: '', contractor_id: '',
            ownership: 'rented', vehicle_type: '12WH', cubic_capacity: getCapacityForType('12WH'),
            advance_amount: '0', customer_id: '', drop_location: '', distance_km: '',
            trip_worth: '', total_shipment_cost: '', payment_status: 'pending',
            payment_method: 'cash', payment_reference: '', permit_number: '', load_info: '', notes: ''
          })
          setVehicleSearch('')
          setShowForm(true)
        }}>
          <Plus size={18} /> Log Trip
        </button>
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
            style={{ flex: 1, minWidth: '140px' }}
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
          />
          <div style={{
            padding: '0.375rem 0.875rem',
            background: 'var(--accent-muted)',
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius)',
            color: 'var(--accent)',
            fontWeight: 700,
            fontFamily: 'var(--font-display)',
            fontSize: '1.1rem',
          }}>
            {trips.length}
          </div>
        </div>
      </div>

      {/* Contractor Summary */}
      {Object.keys(byContractor).length > 0 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {Object.entries(byContractor).map(([name, trps]) => (
            <div key={name} className="badge badge-amber" style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}>
              {name}: <strong style={{ marginLeft: '0.25rem' }}>{trps.length}</strong>
            </div>
          ))}
        </div>
      )}

      {/* Trips List */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: '72px', borderRadius: 'var(--radius)' }} />)}
        </div>
      ) : trips.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Truck size={28} /></div>
          <div className="empty-title">No trips today</div>
          <div className="empty-desc">Tap "Log Trip" to record the first vehicle movement</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {trips.map(trip => (
            <div key={trip.id} className="trip-card" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', flex: 1, minWidth: 0 }}>
                <div style={{
                  width: '50px', height: '50px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.25rem', flexShrink: 0,
                  overflow: 'hidden',
                  position: 'relative'
                }}>
                  {trip.signed_photo_urls && trip.signed_photo_urls.length > 0 ? (
                    <a href={trip.signed_photo_urls[0]} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title="View captured photo">
                      <img src={trip.signed_photo_urls[0]} alt="Truck" style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                      {trip.signed_photo_urls.length > 1 && (
                        <div style={{ position: 'absolute', bottom: 2, right: 2, background: 'rgba(0,0,0,0.6)', color: 'white', fontSize: '0.55rem', padding: '0.1rem 0.2rem', borderRadius: 2, fontWeight: 700 }}>
                          +{trip.signed_photo_urls.length - 1}
                        </div>
                      )}
                    </a>
                  ) : '🚛'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span className="trip-vehicle" style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{trip.vehicles?.plate_number || 'Unknown'}</span>
                    <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>{trip.vehicles?.vehicle_type}</span>
                    <span className={`badge ${trip.ownership_snapshot === 'owned' ? 'badge-blue' : trip.ownership_snapshot === 'leased' ? 'badge-purple' : 'badge-gray'}`} style={{ fontSize: '0.65rem' }}>
                      {trip.ownership_snapshot}
                    </span>
                  </div>
                  <div className="trip-contractor" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {trip.transport_contractors?.name || 'Self/Rented'} {trip.customers?.name ? `→ ${trip.customers.name}` : ''}
                  </div>
                  
                  {/* Detailed specs banner */}
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.25rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {trip.cubic_capacity && <span>Capacity: {trip.cubic_capacity} m³</span>}
                    {trip.permit_number && <span>Permit: {trip.permit_number}</span>}
                    {trip.drop_location && <span>Drop: {trip.drop_location}</span>}
                    {trip.distance_km && <span>Dist: {trip.distance_km} km</span>}
                    {trip.advance_amount ? <span>Advance: ₹{trip.advance_amount}</span> : null}
                  </div>

                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                    {trip.created_at ? format(new Date(trip.created_at), 'hh:mm a') : ''}
                    {trip.created_by && usersMap[trip.created_by] ? ` by ${usersMap[trip.created_by]}` : ''}
                  </div>

                  <div style={{ marginTop: '0.375rem', display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
                    {trip.settled || trip.payment_status === 'settled' ? (
                      <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.35rem', borderRadius: '5px', background: 'rgba(16,185,129,0.12)', color: 'var(--success)', fontWeight: 600 }}>
                        Collected: ₹{Number(trip.trip_worth || trip.settlement_amount).toLocaleString('en-IN')} via {trip.payment_method?.toUpperCase() || 'UPI/Cash'}
                      </span>
                    ) : (
                      <button
                        className="btn btn-success btn-xs"
                        style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          setSettleTripId(trip.id)
                          setSettleAmount(String(trip.trip_worth || ''))
                        }}
                      >
                        Settle Collection
                      </button>
                    )}
                    {trip.trip_worth && (
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent)' }}>
                        Worth: ₹{trip.trip_worth.toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', justifyContent: 'center' }}>
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ padding: '0.25rem' }}
                  onClick={() => startEditTrip(trip)}
                  title="Edit details"
                >
                  <Pencil size={14} style={{ color: 'var(--text-muted)' }} />
                </button>
                <button
                  className="btn btn-ghost btn-icon"
                  style={{ padding: '0.25rem' }}
                  onClick={() => setConfirmDeleteId(trip.id)}
                  title="Delete trip log"
                >
                  <Trash2 size={14} style={{ color: 'var(--danger)' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Log / Edit Trip BottomSheet */}
      <BottomSheet isOpen={showForm} onClose={() => setShowForm(false)} title={editingTripId ? "Edit Trip Log" : "Log Trip Movement"}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '2rem' }}>
          
          {/* Vehicle Input & Auto Suggest */}
          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label">Vehicle Number *</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                className="form-input"
                data-testid="trip-vehicle-input"
                aria-label="Vehicle Number"
                style={{ textTransform: 'uppercase', flex: 1 }}
                placeholder="e.g. KA-19-M-1234"
                value={vehicleSearch}
                onChange={e => {
                  setVehicleSearch(e.target.value)
                  if (!e.target.value) {
                    setForm(f => ({ ...f, vehicle_id: '' }))
                  }
                }}
                required
              />
            </div>
            {filteredVehicles.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', zIndex: 10, maxHeight: '160px', overflowY: 'auto',
                boxShadow: 'var(--shadow-lg)'
              }}>
                {filteredVehicles.map(v => (
                  <div
                    key={v.id}
                    onClick={() => selectVehicle(v)}
                    style={{
                      padding: '0.75rem 1rem',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border-subtle)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, fontFamily: 'var(--font-display)' }}>{v.plate_number}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{v.vehicle_type}</span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>{v.transport_contractors?.name || 'Self'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-input form-select" value={form.vehicle_type}
                onChange={e => handleVehicleTypeChange(e.target.value as any)}>
                {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Ownership</label>
              <select className="form-input form-select" value={form.ownership}
                onChange={e => setForm(f => ({ ...f, ownership: e.target.value }))}>
                {OWNERSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Cubic Capacity (m³)</label>
              <input className="form-input" type="number" step="any" value={form.cubic_capacity}
                onChange={e => setForm(f => ({ ...f, cubic_capacity: e.target.value }))}
                placeholder="Auto-filled, editable" />
            </div>
            <div className="form-group">
              <label className="form-label">Permit No.</label>
              <input className="form-input" value={form.permit_number}
                onChange={e => setForm(f => ({ ...f, permit_number: e.target.value }))}
                placeholder="Permit Number" />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Transport Contractor</label>
            <select className="form-input form-select" value={form.contractor_id}
              onChange={e => setForm(f => ({ ...f, contractor_id: e.target.value }))}>
              <option value="">Select contractor</option>
              {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* New fields for Customer & Scopes */}
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Customer</label>
              <select className="form-input form-select" value={form.customer_id}
                onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
                <option value="">
                  {customers.length === 0 ? 'No customers — add in Settings' : 'Choose customer'}
                </option>
                {customers.map((cust) => (
                  <option key={cust.id} value={cust.id}>
                    {cust.name}
                  </option>
                ))}
              </select>
              {customers.length === 0 && (
                <span style={{ fontSize: '0.65rem', color: 'var(--accent)' }}>
                  Settings → Customers to add buyers and their rates
                </span>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Drop Location</label>
              <input className="form-input" value={form.drop_location}
                onChange={e => setForm(f => ({ ...f, drop_location: e.target.value }))}
                placeholder="Destination" />
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Distance (KM)</label>
              <input className="form-input" type="number" step="any" value={form.distance_km}
                onChange={e => setForm(f => ({ ...f, distance_km: e.target.value }))}
                placeholder="e.g. 45" />
            </div>
            <div className="form-group">
              <label className="form-label">Trip cost (₹)</label>
              <input
                className="form-input"
                type="number"
                step="any"
                value={form.trip_worth}
                onChange={(e) =>
                  setForm((f) => {
                    const next = e.target.value
                    // Keep shipment in sync if it still matched previous trip cost
                    const ship =
                      !f.total_shipment_cost || f.total_shipment_cost === f.trip_worth
                        ? next
                        : f.total_shipment_cost
                    return { ...f, trip_worth: next, total_shipment_cost: ship }
                  })
                }
                placeholder="Auto from customer / type rate"
              />
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                {(() => {
                  const cust = customers.find((c) => c.id === form.customer_id) as
                    | { default_trip_rate?: number | null; trip_rates?: Record<string, number> | null; name?: string }
                    | undefined
                  const { rate, source } = resolveTripRateForCustomer(
                    form.vehicle_type,
                    cust || null,
                    rates
                  )
                  const srcLabel =
                    source === 'customer_type' || source === 'customer_default'
                      ? `customer ${cust?.name || ''}`
                      : source === 'vehicle_type'
                        ? 'org rates'
                        : 'app default'
                  return `₹${rate}/trip (${srcLabel.trim()}) · ${form.vehicle_type}`
                })()}
              </span>
            </div>
          </div>

          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Advance Amount (₹)</label>
              <input className="form-input" type="number" step="any" value={form.advance_amount}
                onChange={e => setForm(f => ({ ...f, advance_amount: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Total shipment / billing cost (₹)</label>
              <input
                className="form-input"
                type="number"
                step="any"
                value={form.total_shipment_cost}
                onChange={(e) => setForm((f) => ({ ...f, total_shipment_cost: e.target.value }))}
                placeholder="Defaults to trip cost"
              />
            </div>
          </div>

          {/* Payment Status & Settlement */}
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.75rem', fontFamily: 'var(--font-display)', color: 'var(--accent)' }}>Payment Settlement</div>
            
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-input form-select" value={form.payment_status}
                onChange={e => setForm(f => ({ ...f, payment_status: e.target.value }))}>
                <option value="pending">Pending Collection</option>
                <option value="settled">Settled / Collected</option>
              </select>
            </div>

            {form.payment_status === 'settled' && (
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Method</label>
                  <select className="form-input form-select" value={form.payment_method}
                    onChange={e => setForm(f => ({ ...f, payment_method: e.target.value as any }))}>
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Reference ID / Account</label>
                  <input className="form-input" value={form.payment_reference}
                    onChange={e => setForm(f => ({ ...f, payment_reference: e.target.value }))}
                    placeholder="e.g. Txn or Safe Account" />
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Load Info</label>
            <input className="form-input" value={form.load_info}
              onChange={e => setForm(f => ({ ...f, load_info: e.target.value }))}
              placeholder="e.g. 6 loads, 12 tonnes..." />
          </div>

          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-input" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional remarks..." rows={2} />
          </div>

          {/* Multiple Photo capture */}
          <div className="form-group">
            <label className="form-label">Photo Evidences (up to 10 photos)</label>
            <div style={{ display: 'flex', gap: '0.625rem', marginBottom: '0.75rem' }}>
              <label style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '0.5rem', padding: '0.75rem',
                background: 'var(--bg-elevated)', border: '1.5px dashed var(--border)',
                borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.875rem',
                color: 'var(--text-muted)', transition: 'all 0.15s',
              }}>
                <Camera size={18} /> Capture
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={(e) => void handlePhotosSelect(e, { fromCamera: true })}
                />
              </label>
              <label style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '0.5rem', padding: '0.75rem',
                background: 'var(--bg-elevated)', border: '1.5px dashed var(--border)',
                borderRadius: 'var(--radius)', cursor: 'pointer', fontSize: '0.875rem',
                color: 'var(--text-muted)', transition: 'all 0.15s',
              }}>
                <ImageIcon size={18} /> Gallery
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => void handlePhotosSelect(e, { fromCamera: false })}
                  multiple
                />
              </label>
            </div>
            {photoPreviews.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
                {photoPreviews.map((url, idx) => (
                  <div key={idx} style={{ position: 'relative', aspectRatio: '1/1' }}>
                    <img src={url} alt="Preview"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }} />
                    <button type="button" onClick={() => removePhoto(idx)}
                      style={{ position: 'absolute', top: '-4px', right: '-4px', background: 'rgba(220,38,38,0.9)', border: 'none', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff' }}>
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
            <button type="button" className="btn btn-secondary w-full" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
              {submitting ? <span className="spinner" /> : (editingTripId ? 'Save Changes' : '+ Log Trip')}
            </button>
          </div>
        </form>
      </BottomSheet>

      {/* Shared ConfirmDialog for deletion */}
      <ConfirmDialog 
        isOpen={confirmDeleteId !== null}
        title="Delete Trip"
        message="Are you sure you want to delete this trip record? This action cannot be undone."
        onConfirm={executeDeleteTrip}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {/* Settle Trip Modal */}
      {settleTripId && (
        <>
          <div className="sheet-overlay" onClick={() => setSettleTripId(null)} />
          <div className="sheet">
            <div className="sheet-handle" />
            <div className="sheet-title">Settle Trip Money Collection</div>
            <form onSubmit={handleSettleTrip}>
              <div className="form-group">
                <label className="form-label">Amount Collected (₹) *</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="e.g. 5000"
                  value={settleAmount}
                  onChange={e => setSettleAmount(e.target.value)}
                  min="0"
                  step="any"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Payment Method *</label>
                <select className="form-input form-select" value={settleMethod} onChange={e => setSettleMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Transaction Ref / Reference Details</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. UPI ID, Txn No, or Safe"
                  value={settleRef}
                  onChange={e => setSettleRef(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Whose Account / Destination *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Main Safe, Bank, Driver Account"
                  value={settleAccount}
                  onChange={e => setSettleAccount(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', paddingTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary w-full" onClick={() => setSettleTripId(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary w-full" disabled={settleSubmitting}>
                  {settleSubmitting ? <span className="spinner" /> : 'Settle'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
