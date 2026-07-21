import { test, expect } from '@playwright/test'
import {
  enqueueOutbox,
  enqueueTripCreateWithPhotos,
  enqueueTripUpdateWithPhotos,
  enqueueCashEntryWithReceipt,
  listOutbox,
  countOutbox,
  clearOutboxForUser,
  outboxKindLabel,
} from '../../src/lib/offline-outbox'
import { isLikelyNetworkError, shouldQueueOffline } from '../../src/lib/offline-network'
import {
  getOfflinePhotosByOutbox,
  clearOfflinePhotosForUser,
} from '../../src/lib/offline-photo-store'

/**
 * Unit tests for offline write outbox (localStorage-backed).
 * Run with PW_SKIP_WEBSERVER=1 when no Next server needed.
 */

const USER = 'user-e2e-1'
const ORG = 'org-e2e-1'

test.describe('offline network helpers', () => {
  test('detects fetch/network errors', () => {
    expect(isLikelyNetworkError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isLikelyNetworkError(new Error('NetworkError when attempting to fetch resource'))).toBe(
      true
    )
    expect(isLikelyNetworkError(new Error('row-level security policy'))).toBe(false)
    expect(isLikelyNetworkError(new Error('duplicate key value'))).toBe(false)
  })

  test('shouldQueueOffline when browser offline flag or network error', () => {
    // In Node/CI navigator may be undefined or online — still true for network errors
    expect(shouldQueueOffline(new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldQueueOffline(new Error('Permission denied (RLS)'))).toBe(false)
  })
})

test.describe('offline outbox queue', () => {
  test.beforeEach(() => {
    clearOutboxForUser(USER, ORG)
  })

  test.afterEach(() => {
    clearOutboxForUser(USER, ORG)
  })

  test('enqueue and list trip create', () => {
    const item = enqueueOutbox(USER, ORG, {
      kind: 'trip_create',
      client_id: 'trip-1',
      vehicle_plate: 'KA01MH1234',
      vehicle_type: '12WH',
      ownership: 'rented',
      photo_paths: [],
      trip: {
        site_id: 'site-1',
        trip_date: '2026-07-18',
        vehicle_id: null,
        ownership_snapshot: 'rented',
      },
    })
    expect(item).not.toBeNull()
    expect(countOutbox(USER, ORG)).toBe(1)
    const list = listOutbox(USER, ORG)
    expect(list[0].payload.kind).toBe('trip_create')
    if (list[0].payload.kind === 'trip_create') {
      expect(list[0].payload.vehicle_plate).toBe('KA01MH1234')
    }
  })

  test('attendance save dedupes same site+date keeping latest', () => {
    enqueueOutbox(USER, ORG, {
      kind: 'attendance_save',
      client_id: 'att-1',
      site_id: 'site-1',
      att_date: '2026-07-18',
      records: [
        { employee_id: 'e1', att_date: '2026-07-18', status: 'present', photo_url: null },
      ],
    })
    enqueueOutbox(USER, ORG, {
      kind: 'attendance_save',
      client_id: 'att-2',
      site_id: 'site-1',
      att_date: '2026-07-18',
      records: [
        { employee_id: 'e1', att_date: '2026-07-18', status: 'absent', photo_url: null },
      ],
    })
    expect(countOutbox(USER, ORG)).toBe(1)
    const list = listOutbox(USER, ORG)
    expect(list[0].id).toBe('att-2')
    if (list[0].payload.kind === 'attendance_save') {
      expect(list[0].payload.records[0].status).toBe('absent')
    }
  })

  test('cash entry enqueue and labels', () => {
    enqueueOutbox(USER, ORG, {
      kind: 'cash_entry_create',
      client_id: 'cash-1',
      cash_book_id: 'book-1',
      site_id: 'site-1',
      book_date: '2026-07-18',
      entry_type: 'out',
      category: 'Fuel / Diesel expense',
      amount: 500,
      note: 'Test',
      receipt_url: null,
    })
    expect(countOutbox(USER, ORG)).toBe(1)
    expect(outboxKindLabel('cash_entry_create')).toBe('Cash entry')
    expect(outboxKindLabel('trip_create')).toBe('Trip')
    expect(outboxKindLabel('trip_update')).toBe('Trip edit')
  })

  test('trip_update dedupes same trip_id keeping latest', () => {
    enqueueOutbox(USER, ORG, {
      kind: 'trip_update',
      client_id: 'up-1',
      trip_id: 'trip-abc',
      patch: { notes: 'first' },
    })
    enqueueOutbox(USER, ORG, {
      kind: 'trip_update',
      client_id: 'up-2',
      trip_id: 'trip-abc',
      patch: { notes: 'second' },
    })
    expect(countOutbox(USER, ORG)).toBe(1)
    const list = listOutbox(USER, ORG)
    expect(list[0].id).toBe('up-2')
    if (list[0].payload.kind === 'trip_update') {
      expect(list[0].payload.patch.notes).toBe('second')
    }
  })

  test('enqueue trip create with photos stores blobs', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'gate.jpg', { type: 'image/jpeg' })
    const item = await enqueueTripCreateWithPhotos(USER, ORG, {
      client_id: 'trip-photo-1',
      vehicle_plate: 'KA01AB0001',
      vehicle_type: '12WH',
      ownership: 'rented',
      files: [file],
      trip: {
        site_id: 'site-1',
        trip_date: '2026-07-18',
        ownership_snapshot: 'rented',
      },
    })
    expect(item).not.toBeNull()
    expect(countOutbox(USER, ORG)).toBe(1)
    const blobs = await getOfflinePhotosByOutbox(item!.id)
    expect(blobs.length).toBe(1)
    expect(blobs[0].name).toBe('gate.jpg')
    const listed = listOutbox(USER, ORG)[0]
    if (listed.payload.kind === 'trip_create') {
      expect(listed.payload.photo_blob_ids?.length).toBe(1)
    }
  })

  test('enqueue trip update with photos', async () => {
    const file = new File([new Uint8Array([9])], 'edit.jpg', { type: 'image/jpeg' })
    const item = await enqueueTripUpdateWithPhotos(USER, ORG, {
      client_id: 'trip-up-photo',
      trip_id: 'existing-trip',
      photo_paths: ['site/old.jpg'],
      files: [file],
      patch: { notes: 'offline edit', site_id: 'site-1', trip_date: '2026-07-18' },
    })
    expect(item).not.toBeNull()
    const blobs = await getOfflinePhotosByOutbox(item!.id)
    expect(blobs.length).toBe(1)
  })

  test('enqueue cash entry with receipt blob', async () => {
    const file = new File([new Uint8Array([4, 5])], 'receipt.jpg', { type: 'image/jpeg' })
    const item = await enqueueCashEntryWithReceipt(USER, ORG, {
      client_id: 'cash-receipt-1',
      cash_book_id: 'book-1',
      site_id: 'site-1',
      book_date: '2026-07-18',
      entry_type: 'out',
      category: 'Fuel / Diesel expense',
      amount: 100,
      note: null,
      receiptFile: file,
    })
    expect(item).not.toBeNull()
    const blobs = await getOfflinePhotosByOutbox(item!.id)
    expect(blobs.length).toBe(1)
    const listed = listOutbox(USER, ORG)[0]
    if (listed.payload.kind === 'cash_entry_create') {
      expect(listed.payload.receipt_blob_id).toBeTruthy()
    }
  })

  test('clear empties queue', async () => {
    enqueueOutbox(USER, ORG, {
      kind: 'trip_create',
      client_id: 't',
      trip: { site_id: 's', trip_date: '2026-07-18', ownership_snapshot: 'owned' },
    })
    clearOutboxForUser(USER, ORG)
    await clearOfflinePhotosForUser(USER, ORG)
    expect(countOutbox(USER, ORG)).toBe(0)
  })
})
