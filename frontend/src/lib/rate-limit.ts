/**
 * Soft API rate limiting for Next.js proxy / edge handlers.
 *
 * Default: in-memory Map (per process / serverless isolate).
 * Optional: set RATE_LIMIT_BACKEND=memory (default) — documented for future Redis.
 *
 * This is abuse dampening only. Production should also use Vercel/WAF rate limits.
 */

export interface RateLimitResult {
  limited: boolean
  remaining: number
  resetAt: number
}

const store = new Map<string, { count: number; resetTime: number }>()

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now()
  const record = store.get(key)

  if (!record || now > record.resetTime) {
    const resetAt = now + windowMs
    store.set(key, { count: 1, resetTime: resetAt })
    return { limited: false, remaining: limit - 1, resetAt }
  }

  record.count += 1
  if (record.count > limit) {
    return { limited: true, remaining: 0, resetAt: record.resetTime }
  }
  return {
    limited: false,
    remaining: Math.max(0, limit - record.count),
    resetAt: record.resetTime,
  }
}

/** Prune expired entries occasionally to avoid unbounded growth in long-lived processes. */
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
