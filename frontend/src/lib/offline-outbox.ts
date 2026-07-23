/**
 * Offline write outbox — queue mutations when offline / network fails,
 * flush to Supabase when connectivity returns.
 *
 * Supports: trip create/update, attendance save, cash entry create.
 * Binary photos live in IndexedDB (offline-photo-store) linked by photo_blob_ids.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { tripsRepository, type TripCreateInput } from '@/lib/repositories/trips'
import type { TripUpdate } from '@/lib/repositories/trips'
import { attendanceRepository, type AttendanceSaveRecord } from '@/lib/repositories/attendance'
import { cashBookRepository } from '@/lib/repositories/cash-book'
import { isBrowserOnline, isLikelyNetworkError } from '@/lib/offline-network'
import {
  clearOfflinePhotosForUser,
  deleteOfflinePhotosByOutbox,
  getOfflinePhotosByOutbox,
  putOfflinePhotos,
} from '@/lib/offline-photo-store'
import { resolveOrCreateContractorId } from '@/lib/resolve-contractor'

const OUTBOX_PREFIX = 'mineops_outbox_v1'
const MAX_ATTEMPTS = 8
const MAX_ITEMS = 200

export type OutboxKind = 'trip_create' | 'trip_update' | 'attendance_save' | 'cash_entry_create'

export interface TripCreateOutboxPayload {
  kind: 'trip_create'
  trip: TripCreateInput
  vehicle_plate?: string | null
  vehicle_type?: string | null
  ownership?: string | null
  /** Free-text contractor — resolved to id on flush if trip.contractor_id missing */
  contractor_name?: string | null
  /** Already-uploaded storage paths */
  photo_paths?: string[]
  /** IndexedDB blob ids to upload on flush */
  photo_blob_ids?: string[]
  client_id: string
}

export interface TripUpdateOutboxPayload {
  kind: 'trip_update'
  trip_id: string
  patch: TripUpdate & { rate_per_cubic?: number | null }
  vehicle_plate?: string | null
  vehicle_type?: string | null
  ownership?: string | null
  contractor_name?: string | null
  /** Replace trip_photos with these storage paths after update */
  photo_paths?: string[]
  photo_blob_ids?: string[]
  client_id: string
}

export interface AttendanceSaveOutboxPayload {
  kind: 'attendance_save'
  site_id: string
  att_date: string
  records: AttendanceSaveRecord[]
  client_id: string
}

export interface CashEntryOutboxPayload {
  kind: 'cash_entry_create'
  cash_book_id: string | null
  site_id: string
  book_date: string
  entry_type: 'in' | 'out'
  category: string
  amount: number
  note: string | null
  receipt_url?: string | null
  /** IndexedDB blob for receipt when offline */
  receipt_blob_id?: string | null
  contractor_id?: string | null
  /** Free-text contractor for expense lines */
  contractor_name?: string | null
  client_id: string
}

export type OutboxPayload =
  | TripCreateOutboxPayload
  | TripUpdateOutboxPayload
  | AttendanceSaveOutboxPayload
  | CashEntryOutboxPayload

export interface OutboxItem {
  id: string
  userId: string
  orgId: string
  createdAt: number
  attempts: number
  lastError?: string
  payload: OutboxPayload
}

export interface FlushResult {
  processed: number
  succeeded: number
  failed: number
  remaining: number
  errors: string[]
}

const memoryStore = new Map<string, string>()

function canUseLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
  } catch {
    return false
  }
}

function storageKey(userId: string, orgId: string): string {
  return `${OUTBOX_PREFIX}:${userId}:${orgId}`
}

function storageGet(key: string): string | null {
  if (canUseLocalStorage()) {
    try {
      return localStorage.getItem(key)
    } catch {
      return memoryStore.get(key) ?? null
    }
  }
  return memoryStore.get(key) ?? null
}

function storageSet(key: string, value: string): void {
  if (canUseLocalStorage()) {
    try {
      localStorage.setItem(key, value)
      return
    } catch {
      // fall through
    }
  }
  memoryStore.set(key, value)
}

function storageRemove(key: string): void {
  if (canUseLocalStorage()) {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }
  memoryStore.delete(key)
}

function readAll(userId: string, orgId: string): OutboxItem[] {
  if (!userId || !orgId) return []
  try {
    const raw = storageGet(storageKey(userId, orgId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as OutboxItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeAll(userId: string, orgId: string, items: OutboxItem[]): void {
  if (!userId || !orgId) return
  storageSet(storageKey(userId, orgId), JSON.stringify(items.slice(0, MAX_ITEMS)))
}

export function listOutbox(userId: string | null | undefined, orgId: string | null | undefined): OutboxItem[] {
  if (!userId || !orgId) return []
  return readAll(userId, orgId).sort((a, b) => a.createdAt - b.createdAt)
}

export function countOutbox(userId: string | null | undefined, orgId: string | null | undefined): number {
  return listOutbox(userId, orgId).length
}

export function enqueueOutbox(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  payload: OutboxPayload
): OutboxItem | null {
  if (!userId || !orgId) return null
  const item: OutboxItem = {
    id:
      payload.client_id ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `outbox-${Date.now()}`),
    userId,
    orgId,
    createdAt: Date.now(),
    attempts: 0,
    payload,
  }
  const items = readAll(userId, orgId)
  let filtered = items

  if (payload.kind === 'attendance_save') {
    filtered = items.filter(
      (i) =>
        !(
          i.payload.kind === 'attendance_save' &&
          i.payload.site_id === payload.site_id &&
          i.payload.att_date === payload.att_date
        )
    )
  } else if (payload.kind === 'trip_update') {
    // Keep latest patch for same trip_id; drop prior photo blobs
    const dropped = items.filter(
      (i) => i.payload.kind === 'trip_update' && i.payload.trip_id === payload.trip_id
    )
    for (const d of dropped) void deleteOfflinePhotosByOutbox(d.id)
    filtered = items.filter(
      (i) => !(i.payload.kind === 'trip_update' && i.payload.trip_id === payload.trip_id)
    )
  }

  filtered.push(item)
  writeAll(userId, orgId, filtered)
  notifyOutboxChanged()
  return item
}

/**
 * Queue trip create + store photo blobs in IndexedDB.
 */
export async function enqueueTripCreateWithPhotos(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  payload: Omit<TripCreateOutboxPayload, 'kind' | 'photo_blob_ids'> & {
    kind?: 'trip_create'
    files?: File[]
  }
): Promise<OutboxItem | null> {
  const client_id =
    payload.client_id ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `trip-${Date.now()}`)
  const item = enqueueOutbox(userId, orgId, {
    ...payload,
    kind: 'trip_create',
    client_id,
    photo_blob_ids: [],
  })
  if (!item || !userId || !orgId) return item
  const files = payload.files || []
  if (files.length > 0) {
    const ids = await putOfflinePhotos(userId, orgId, item.id, files)
    const items = readAll(userId, orgId).map((i) =>
      i.id === item.id && i.payload.kind === 'trip_create'
        ? {
            ...i,
            payload: { ...i.payload, photo_blob_ids: ids },
          }
        : i
    )
    writeAll(userId, orgId, items)
    notifyOutboxChanged()
  }
  return item
}

export async function enqueueTripUpdateWithPhotos(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  payload: Omit<TripUpdateOutboxPayload, 'kind' | 'photo_blob_ids'> & {
    files?: File[]
  }
): Promise<OutboxItem | null> {
  const client_id =
    payload.client_id ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `trip-up-${Date.now()}`)
  const item = enqueueOutbox(userId, orgId, {
    ...payload,
    kind: 'trip_update',
    client_id,
    photo_blob_ids: [],
  })
  if (!item || !userId || !orgId) return item
  const files = payload.files || []
  if (files.length > 0) {
    const ids = await putOfflinePhotos(userId, orgId, item.id, files)
    const items = readAll(userId, orgId).map((i) =>
      i.id === item.id && i.payload.kind === 'trip_update'
        ? { ...i, payload: { ...i.payload, photo_blob_ids: ids } }
        : i
    )
    writeAll(userId, orgId, items)
    notifyOutboxChanged()
  }
  return item
}

/**
 * Queue cash entry + optional receipt image in IndexedDB.
 */
export async function enqueueCashEntryWithReceipt(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  payload: Omit<CashEntryOutboxPayload, 'kind' | 'receipt_blob_id'> & {
    kind?: 'cash_entry_create'
    receiptFile?: File | null
  }
): Promise<OutboxItem | null> {
  const client_id =
    payload.client_id ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `cash-${Date.now()}`)
  const item = enqueueOutbox(userId, orgId, {
    ...payload,
    kind: 'cash_entry_create',
    client_id,
    receipt_blob_id: null,
  })
  if (!item || !userId || !orgId) return item
  const file = payload.receiptFile
  if (file) {
    const ids = await putOfflinePhotos(userId, orgId, item.id, [file])
    const items = readAll(userId, orgId).map((i) =>
      i.id === item.id && i.payload.kind === 'cash_entry_create'
        ? {
            ...i,
            payload: {
              ...i.payload,
              receipt_blob_id: ids[0] || null,
            },
          }
        : i
    )
    writeAll(userId, orgId, items)
    notifyOutboxChanged()
  }
  return item
}

export function removeOutboxItem(userId: string, orgId: string, id: string): void {
  const next = readAll(userId, orgId).filter((i) => i.id !== id)
  writeAll(userId, orgId, next)
  void deleteOfflinePhotosByOutbox(id)
  notifyOutboxChanged()
}

export function clearOutboxForUser(userId?: string | null, orgId?: string | null): void {
  try {
    if (userId && orgId) {
      storageRemove(storageKey(userId, orgId))
      void clearOfflinePhotosForUser(userId, orgId)
      notifyOutboxChanged()
      return
    }
    if (canUseLocalStorage()) {
      const toRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith(OUTBOX_PREFIX)) toRemove.push(k)
      }
      for (const k of toRemove) storageRemove(k)
    }
    for (const k of [...memoryStore.keys()]) {
      if (k.startsWith(OUTBOX_PREFIX)) memoryStore.delete(k)
    }
    void clearOfflinePhotosForUser()
    notifyOutboxChanged()
  } catch {
    // ignore
  }
}

export function clearAllOutboxes(): void {
  clearOutboxForUser()
}

type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyOutboxChanged(): void {
  for (const l of listeners) {
    try {
      l()
    } catch {
      // ignore
    }
  }
}

async function resolveVehicleId(
  supabase: SupabaseClient<Database>,
  orgId: string,
  plate: string | null | undefined,
  vehicleType: string | null | undefined,
  ownership: string | null | undefined,
  existingId: string | null | undefined
): Promise<string | null> {
  if (existingId) return existingId
  const upper = (plate || '').toUpperCase().trim()
  if (!upper) return null

  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('plate_number', upper)
    .maybeSingle()
  if (existing?.id) return existing.id

  const { data: created, error } = await supabase
    .from('vehicles')
    .insert({
      plate_number: upper,
      vehicle_type: vehicleType || '12WH',
      ownership: ownership || 'rented',
      active: true,
      organization_id: orgId,
    })
    .select('id')
    .single()
  if (error) throw error
  return created?.id ?? null
}

async function uploadOfflineBlobs(
  supabase: SupabaseClient<Database>,
  outboxId: string,
  bucket: 'trip-photos' | 'cash-receipts',
  pathPrefix: string
): Promise<string[]> {
  const photos = await getOfflinePhotosByOutbox(outboxId)
  const paths: string[] = []
  for (const rec of photos) {
    const ext = rec.name.split('.').pop() || 'jpg'
    const path = `${pathPrefix}/${rec.id}.${ext}`
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, rec.blob, { upsert: true, contentType: rec.type || 'image/jpeg' })
    if (error) throw error
    paths.push(path)
  }
  return paths
}

async function processItem(
  supabase: SupabaseClient<Database>,
  orgId: string,
  item: OutboxItem
): Promise<void> {
  const p = item.payload

  if (p.kind === 'trip_create') {
    const vehicleId = await resolveVehicleId(
      supabase,
      orgId,
      p.vehicle_plate,
      p.vehicle_type,
      p.ownership,
      p.trip.vehicle_id
    )
    const siteId = p.trip.site_id || 'unknown'
    const tripDate = String(p.trip.trip_date || '').slice(0, 10) || 'unknown'
    const blobPaths = await uploadOfflineBlobs(
      supabase,
      item.id,
      'trip-photos',
      `${siteId}/${tripDate}`
    )
    const allPhotos = [...(p.photo_paths || []), ...blobPaths]
    let contractorId = p.trip.contractor_id || null
    if (!contractorId && p.contractor_name) {
      contractorId = await resolveOrCreateContractorId(supabase, orgId, p.contractor_name)
    }
    const tripPayload: TripCreateInput = {
      ...p.trip,
      vehicle_id: vehicleId,
      contractor_id: contractorId,
      organization_id: p.trip.organization_id || orgId,
      photo_url: allPhotos[0] || p.trip.photo_url || null,
      _vehicle_plate: p.vehicle_plate || null,
    }
    const row = await tripsRepository.create(supabase, tripPayload)
    if (allPhotos.length > 0) {
      await supabase.from('trip_photos').delete().eq('trip_id', row.id)
      await supabase.from('trip_photos').insert(
        allPhotos.map((url, idx) => ({
          trip_id: row.id,
          photo_url: url,
          sort_order: idx,
        }))
      )
    }
    await deleteOfflinePhotosByOutbox(item.id)
    return
  }

  if (p.kind === 'trip_update') {
    let patch = { ...p.patch }
    if (p.vehicle_plate && !patch.vehicle_id) {
      const vid = await resolveVehicleId(
        supabase,
        orgId,
        p.vehicle_plate,
        p.vehicle_type,
        p.ownership,
        p.patch.vehicle_id as string | null
      )
      if (vid) patch = { ...patch, vehicle_id: vid }
    }
    const siteId = String(p.patch.site_id || 'unknown')
    const tripDate = String(p.patch.trip_date || '').slice(0, 10) || 'unknown'
    const blobPaths = await uploadOfflineBlobs(
      supabase,
      item.id,
      'trip-photos',
      `${siteId}/${tripDate}`
    )
    if (!patch.contractor_id && p.contractor_name) {
      const cid = await resolveOrCreateContractorId(supabase, orgId, p.contractor_name)
      if (cid) patch = { ...patch, contractor_id: cid }
    }
    await tripsRepository.update(supabase, p.trip_id, {
      ...patch,
      _vehicle_plate: p.vehicle_plate || null,
    })
    const allPhotos = [...(p.photo_paths || []), ...blobPaths]
    if (allPhotos.length > 0 || (p.photo_blob_ids && p.photo_blob_ids.length > 0)) {
      await supabase.from('trip_photos').delete().eq('trip_id', p.trip_id)
      if (allPhotos.length > 0) {
        await supabase.from('trip_photos').insert(
          allPhotos.map((url, idx) => ({
            trip_id: p.trip_id,
            photo_url: url,
            sort_order: idx,
          }))
        )
      }
    }
    await deleteOfflinePhotosByOutbox(item.id)
    return
  }

  if (p.kind === 'attendance_save') {
    await attendanceRepository.saveRoster(supabase, p.records, p.site_id)
    return
  }

  if (p.kind === 'cash_entry_create') {
    let bookId = p.cash_book_id
    if (!bookId) {
      const book = await cashBookRepository.getOrCreate(supabase, p.site_id, p.book_date)
      bookId = book.id
    }
    let receiptUrl = p.receipt_url ?? null
    if (p.receipt_blob_id || (await getOfflinePhotosByOutbox(item.id)).length > 0) {
      const paths = await uploadOfflineBlobs(supabase, item.id, 'cash-receipts', bookId)
      if (paths[0]) receiptUrl = paths[0]
    }
    let contractorId = p.contractor_id ?? null
    if (!contractorId && p.contractor_name) {
      contractorId = await resolveOrCreateContractorId(supabase, orgId, p.contractor_name)
    }
    await cashBookRepository.createEntry(supabase, {
      cash_book_id: bookId,
      entry_type: p.entry_type,
      category: p.category,
      amount: p.amount,
      note: p.note,
      receipt_url: receiptUrl,
      contractor_id: contractorId,
    })
    await deleteOfflinePhotosByOutbox(item.id)
  }
}

export async function flushOutbox(
  supabase: SupabaseClient<Database>,
  userId: string | null | undefined,
  orgId: string | null | undefined
): Promise<FlushResult> {
  const empty: FlushResult = { processed: 0, succeeded: 0, failed: 0, remaining: 0, errors: [] }
  if (!userId || !orgId || !isBrowserOnline()) {
    empty.remaining = countOutbox(userId, orgId)
    return empty
  }

  const items = listOutbox(userId, orgId)
  if (items.length === 0) return empty

  let succeeded = 0
  let failed = 0
  const errors: string[] = []
  let remaining = readAll(userId, orgId)

  for (const item of items) {
    if (item.attempts >= MAX_ATTEMPTS) {
      failed++
      errors.push(`${item.payload.kind}: max attempts exceeded`)
      continue
    }

    try {
      await processItem(supabase, orgId, item)
      remaining = remaining.filter((i) => i.id !== item.id)
      writeAll(userId, orgId, remaining)
      succeeded++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${item.payload.kind}: ${message}`)
      remaining = remaining.map((i) =>
        i.id === item.id
          ? {
              ...i,
              attempts: i.attempts + 1,
              lastError: message,
            }
          : i
      )
      writeAll(userId, orgId, remaining)
      if (isLikelyNetworkError(err) || !isBrowserOnline()) break
    }
  }

  notifyOutboxChanged()
  return {
    processed: succeeded + failed,
    succeeded,
    failed,
    remaining: remaining.length,
    errors,
  }
}

export function outboxKindLabel(kind: OutboxKind): string {
  switch (kind) {
    case 'trip_create':
      return 'Trip'
    case 'trip_update':
      return 'Trip edit'
    case 'attendance_save':
      return 'Attendance'
    case 'cash_entry_create':
      return 'Cash entry'
    default:
      return kind
  }
}
