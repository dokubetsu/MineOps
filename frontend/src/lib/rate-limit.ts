/**
 * API rate limiting for Next.js proxy / route handlers.
 *
 * - Default: in-memory Map (per process / serverless isolate).
 * - Durable: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (Phase E).
 *
 * This is abuse dampening. Production should also use Vercel/WAF limits.
 */

export interface RateLimitResult {
  limited: boolean
  remaining: number
  resetAt: number
  backend: 'memory' | 'upstash'
}

const store = new Map<string, { count: number; resetTime: number }>()

function memoryCheck(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now()
  const record = store.get(key)

  if (!record || now > record.resetTime) {
    const resetAt = now + windowMs
    store.set(key, { count: 1, resetTime: resetAt })
    return { limited: false, remaining: limit - 1, resetAt, backend: 'memory' }
  }

  record.count += 1
  if (record.count > limit) {
    return { limited: true, remaining: 0, resetAt: record.resetTime, backend: 'memory' }
  }
  return {
    limited: false,
    remaining: Math.max(0, limit - record.count),
    resetAt: record.resetTime,
    backend: 'memory',
  }
}

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  )
}

/**
 * Durable fixed-window counter via Upstash REST (INCR + EXPIRE).
 * Falls back to memory on misconfiguration or network errors.
 */
async function upstashCheck(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const base = process.env.UPSTASH_REDIS_REST_URL!.replace(/\/$/, '')
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!
  const redisKey = `mineops:rl:${key}`

  try {
    const res = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', redisKey],
        ['PTTL', redisKey],
      ]),
      // Edge-friendly; avoid hanging the proxy
      signal: AbortSignal.timeout(1500),
    })

    if (!res.ok) {
      return memoryCheck(key, limit, windowMs)
    }

    const data = (await res.json()) as Array<{ result: number | string | null }>
    const count = Number(data?.[0]?.result ?? 0)
    let pttl = Number(data?.[1]?.result ?? -1)

    // First hit in window: set expiry
    if (count === 1 || pttl < 0) {
      await fetch(`${base}/pexpire/${encodeURIComponent(redisKey)}/${windowMs}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1500),
      }).catch(() => null)
      pttl = windowMs
    }

    const resetAt = Date.now() + (pttl > 0 ? pttl : windowMs)
    if (count > limit) {
      return { limited: true, remaining: 0, resetAt, backend: 'upstash' }
    }
    return {
      limited: false,
      remaining: Math.max(0, limit - count),
      resetAt,
      backend: 'upstash',
    }
  } catch {
    return memoryCheck(key, limit, windowMs)
  }
}

let warnedMemoryInProd = false

function warnIfMemoryInProduction(): void {
  if (warnedMemoryInProd) return
  const prod =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production'
  if (!prod) return
  warnedMemoryInProd = true
  console.warn(
    '[mineops/rate-limit] Using in-memory rate limits in production. ' +
      'Configure UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for durable multi-instance limits. ' +
      'See docs/ENV.md and docs/DEPLOYMENT_CHECKLIST.md.'
  )
}

/**
 * Async rate limit — prefers Upstash when configured (Phase E), else memory.
 * Prefer this from proxy / route handlers.
 *
 * Phase 2: logs once in production when falling back to memory (not a hard fail —
 * set Upstash for multi-instance deploys).
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  if (upstashConfigured()) {
    return upstashCheck(key, limit, windowMs)
  }
  warnIfMemoryInProduction()
  return memoryCheck(key, limit, windowMs)
}

/** Sync in-memory only — tests and non-async call sites. */
export function checkRateLimitMemory(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  return memoryCheck(key, limit, windowMs)
}

/** Prune expired in-memory entries (no-op for Upstash). */
export function pruneRateLimitStore(now = Date.now()): number {
  let removed = 0
  for (const [k, v] of store.entries()) {
    if (now > v.resetTime) {
      store.delete(k)
      removed++
    }
  }
  return removed
}

export function rateLimitBackendLabel(): 'memory' | 'upstash' {
  return upstashConfigured() ? 'upstash' : 'memory'
}
