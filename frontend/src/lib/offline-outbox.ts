/**
 * Offline write outbox — queue mutations when offline / network fails,
 * flush to Supabase when connectivity returns.
 *
 * Scope: trips create, attendance roster save, cash entry create (no binary photos in v1).
 * Storage: localStorage, scoped by user + org. Cleared on logout via clearOfflineCache.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { tripsRepository, type TripCreateInput } from '@/lib/repositories/trips'
import { attendanceRepository, type AttendanceSaveRecord } from '@/lib/repositories/attendance'
import { cashBookRepository } from '@/lib/repositories/cash-book'
import { isBrowserOnline, isLikelyNetworkError } from '@/lib/offline-network'

const OUTBOX_PREFIX = 'mineops_outbox_v1'
const MAX_ATTEMPTS = 8
const MAX_ITEMS = 200

export type OutboxKind = 'trip_create' | 'attendance_save' | 'cash_entry_create'

export interface TripCreateOutboxPayload {
  kind: 'trip_create'
  /** Trip row fields (vehicle_id may be null if only plate known) */
  trip: TripCreateInput
  /** Plate to resolve/create vehicle when vehicle_id missing */
  vehicle_plate?: string | null
  vehicle_type?: string | null
  ownership?: string | null
  /** Paths already uploaded (online photos); offline skips binary */
  photo_paths?: string[]
  /** Client-side optimistic id for UI */
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
  /** Prefer cash_book_id when known; else resolve via site_id + book_date on flush */
  cash_book_id: string | null
  site_id: string
  book_date: string
  entry_type: 'in' | 'out'
  category: string
  amount: number
  note: string | null
  /** Storage path if already uploaded; offline creates without receipt */
  receipt_url?: string | null
  client_id: string
}

export type OutboxPayload =
  | TripCreateOutboxPayload
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

/** In-memory fallback for unit tests / SSR; browser uses localStorage. */
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
      // fall through to memory
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
    id: payload.client_id || (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `outbox-${Date.now()}`),
    userId,
    orgId,
    createdAt: Date.now(),
    attempts: 0,
    payload,
  }
  const items = readAll(userId, orgId)
  // Dedupe attendance saves for same site+date — keep latest
  const filtered =
    payload.kind === 'attendance_save'
      ? items.filter(
          (i) =>
            !(
              i.payload.kind === 'attendance_save' &&
              i.payload.site_id === payload.site_id &&
              i.payload.att_date === payload.att_date
            )
        )
      : items
  filtered.push(item)
  writeAll(userId, orgId, filtered)
  notifyOutboxChanged()
  return item
}

export function removeOutboxItem(
  userId: string,
  orgId: string,
  id: string
): void {
  const next = readAll(userId, orgId).filter((i) => i.id !== id)
  writeAll(userId, orgId, next)
  notifyOutboxChanged()
}

export function clearOutboxForUser(userId?: string | null, orgId?: string | null): void {
  try {
    if (userId && orgId) {
      storageRemove(storageKey(userId, orgId))
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
    notifyOutboxChanged()
  } catch {
    // ignore
  }
}

/** Clear all outbox keys (logout). */
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
  payload: TripCreateOutboxPayload
): Promise<string | null> {
  if (payload.trip.vehicle_id) return payload.trip.vehicle_id
  const plate = (payload.vehicle_plate || '').toUpperCase().trim()
  if (!plate) return null

  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('plate_number', plate)
    .maybeSingle()
  if (existing?.id) return existing.id

  const { data: created, error } = await supabase
    .from('vehicles')
    .insert({
      plate_number: plate,
      vehicle_type: payload.vehicle_type || '12WH',
      ownership: payload.ownership || 'rented',
      active: true,
      organization_id: orgId,
    })
    .select('id')
    .single()
  if (error) throw error
  return created?.id ?? null
}

async function processItem(
  supabase: SupabaseClient<Database>,
  orgId: string,
  item: OutboxItem
): Promise<void> {
  const p = item.payload
  if (p.kind === 'trip_create') {
    const vehicleId = await resolveVehicleId(supabase, orgId, p)
    const tripPayload: TripCreateInput = {
      ...p.trip,
      vehicle_id: vehicleId,
      organization_id: p.trip.organization_id || orgId,
    }
    const row = await tripsRepository.create(supabase, tripPayload)
    if (p.photo_paths && p.photo_paths.length > 0) {
      await supabase.from('trip_photos').delete().eq('trip_id', row.id)
      await supabase.from('trip_photos').insert(
        p.photo_paths.map((url, idx) => ({
          trip_id: row.id,
          photo_url: url,
          sort_order: idx,
        }))
      )
    }
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
    await cashBookRepository.createEntry(supabase, {
      cash_book_id: bookId,
      entry_type: p.entry_type,
      category: p.category,
      amount: p.amount,
      note: p.note,
      receipt_url: p.receipt_url ?? null,
    })
  }
}

/**
 * Flush pending mutations for this user/org. Safe to call repeatedly.
 */
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
      // Stop if clearly offline again
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

/** Human label for UI */
export function outboxKindLabel(kind: OutboxKind): string {
  switch (kind) {
    case 'trip_create':
      return 'Trip'
    case 'attendance_save':
      return 'Attendance'
    case 'cash_entry_create':
      return 'Cash entry'
    default:
      return kind
  }
}
