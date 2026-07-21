/**
 * IndexedDB blob store for offline photos (trips / cash receipts).
 * Linked to outbox item ids; flushed on reconnect then deleted.
 */

const DB_NAME = 'mineops_photos_v1'
const STORE = 'blobs'
const DB_VERSION = 1

export interface OfflinePhotoMeta {
  id: string
  userId: string
  orgId: string
  outboxId: string
  name: string
  type: string
  createdAt: number
}

export interface OfflinePhotoRecord extends OfflinePhotoMeta {
  blob: Blob
}

function canUseIdb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIdb()) {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error || new Error('IDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' })
        os.createIndex('outboxId', 'outboxId', { unique: false })
        os.createIndex('userOrg', ['userId', 'orgId'], { unique: false })
      }
    }
  })
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Memory fallback when IDB fails (tests / private mode) */
const memoryBlobs = new Map<string, OfflinePhotoRecord>()

export async function putOfflinePhotos(
  userId: string,
  orgId: string,
  outboxId: string,
  files: File[]
): Promise<string[]> {
  if (!userId || !orgId || files.length === 0) return []
  const ids: string[] = []

  for (const file of files) {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `photo-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const record: OfflinePhotoRecord = {
      id,
      userId,
      orgId,
      outboxId,
      name: file.name || `photo-${id}.jpg`,
      type: file.type || 'image/jpeg',
      createdAt: Date.now(),
      blob: file,
    }
    ids.push(id)
    try {
      const db = await openDb()
      const tx = db.transaction(STORE, 'readwrite')
      await idbReq(tx.objectStore(STORE).put(record))
      db.close()
    } catch {
      memoryBlobs.set(id, record)
    }
  }
  return ids
}

export async function getOfflinePhotosByOutbox(
  outboxId: string
): Promise<OfflinePhotoRecord[]> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    const idx = tx.objectStore(STORE).index('outboxId')
    const rows = await idbReq(idx.getAll(outboxId))
    db.close()
    if (rows?.length) return rows as OfflinePhotoRecord[]
  } catch {
    // fall through
  }
  return [...memoryBlobs.values()].filter((r) => r.outboxId === outboxId)
}

export async function deleteOfflinePhotosByOutbox(outboxId: string): Promise<void> {
  try {
    const rows = await getOfflinePhotosByOutbox(outboxId)
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const r of rows) {
      store.delete(r.id)
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // ignore
  }
  for (const [id, r] of memoryBlobs) {
    if (r.outboxId === outboxId) memoryBlobs.delete(id)
  }
}

export async function clearOfflinePhotosForUser(
  userId?: string | null,
  orgId?: string | null
): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    if (userId && orgId) {
      const idx = store.index('userOrg')
      const rows = (await idbReq(idx.getAll([userId, orgId]))) as OfflinePhotoRecord[]
      for (const r of rows) store.delete(r.id)
    } else {
      store.clear()
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    // ignore
  }
  if (userId && orgId) {
    for (const [id, r] of memoryBlobs) {
      if (r.userId === userId && r.orgId === orgId) memoryBlobs.delete(id)
    }
  } else {
    memoryBlobs.clear()
  }
}

export async function countOfflinePhotos(
  userId: string | null | undefined,
  orgId: string | null | undefined
): Promise<number> {
  if (!userId || !orgId) return 0
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    const idx = tx.objectStore(STORE).index('userOrg')
    const rows = (await idbReq(idx.getAll([userId, orgId]))) as OfflinePhotoRecord[]
    db.close()
    return rows.length
  } catch {
    return [...memoryBlobs.values()].filter(
      (r) => r.userId === userId && r.orgId === orgId
    ).length
  }
}
