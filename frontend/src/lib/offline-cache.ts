/**
 * Namespaced, TTL-backed offline cache for sensitive dashboard data.
 * - Keys are scoped by user + org so multi-tenant sessions do not leak
 * - Expired entries are ignored on read
 * - Signed URLs must never be written (strip before set)
 * - Call clearOfflineCache() on logout
 */

const PREFIX = 'mineops_cache_v1'
const DEFAULT_TTL_MS = 30 * 60 * 1000 // 30 minutes

export interface CacheEnvelope<T> {
  v: 1
  userId: string
  orgId: string
  expiresAt: number
  data: T
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function scopeKey(userId: string, orgId: string, key: string): string {
  return `${PREFIX}:${userId}:${orgId}:${key}`
}

/** Remove signed URL fields before persistence. */
export function stripSignedUrls<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((item) => stripSignedUrls(item)) as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/signed/i.test(k) && typeof v === 'string' && /^https?:\/\//i.test(v)) {
      continue
    }
    if (k === 'signed_receipt_url' || k === 'signed_photo_urls' || k === 'display_photo_url') {
      // Transient display URLs — do not cache
      continue
    }
    out[k] = stripSignedUrls(v)
  }
  return out as T
}

export function setOfflineCache<T>(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  key: string,
  data: T,
  ttlMs: number = DEFAULT_TTL_MS
): void {
  if (!isBrowser() || !userId || !orgId) return
  try {
    const envelope: CacheEnvelope<T> = {
      v: 1,
      userId,
      orgId,
      expiresAt: Date.now() + ttlMs,
      data: stripSignedUrls(data),
    }
    localStorage.setItem(scopeKey(userId, orgId, key), JSON.stringify(envelope))
  } catch {
    // Quota / private mode — ignore
  }
}

export function getOfflineCache<T>(
  userId: string | null | undefined,
  orgId: string | null | undefined,
  key: string
): T | null {
  if (!isBrowser() || !userId || !orgId) return null
  try {
    const raw = localStorage.getItem(scopeKey(userId, orgId, key))
    if (!raw) return null
    const envelope = JSON.parse(raw) as CacheEnvelope<T>
    if (!envelope || envelope.v !== 1) return null
    if (envelope.userId !== userId || envelope.orgId !== orgId) return null
    if (typeof envelope.expiresAt !== 'number' || Date.now() > envelope.expiresAt) {
      localStorage.removeItem(scopeKey(userId, orgId, key))
      return null
    }
    return envelope.data
  } catch {
    return null
  }
}

/** Remove all MineOps offline cache entries (call on logout). */
export function clearOfflineCache(): void {
  if (!isBrowser()) return
  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && (k.startsWith(PREFIX) || k.startsWith('cached_cashbook_') || k.startsWith('cached_cashentries_') || k.startsWith('cached_balances_') || k.startsWith('cached_trips_') || k.startsWith('cached_attendance_'))) {
        toRemove.push(k)
      }
    }
    for (const k of toRemove) localStorage.removeItem(k)
  } catch {
    // ignore
  }
}

/** Clear only the legacy unscoped keys used before namespacing. */
export function clearLegacyOfflineKeys(): void {
  if (!isBrowser()) return
  try {
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (
        k &&
        (k.startsWith('cached_cashbook_') ||
          k.startsWith('cached_cashentries_') ||
          k.startsWith('cached_balances_') ||
          k.startsWith('cached_trips_') ||
          k.startsWith('cached_attendance_'))
      ) {
        toRemove.push(k)
      }
    }
    for (const k of toRemove) localStorage.removeItem(k)
  } catch {
    // ignore
  }
}
