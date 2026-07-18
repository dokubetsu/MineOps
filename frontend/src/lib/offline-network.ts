/**
 * Network / offline helpers for field PWA usage.
 */

export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine !== false
}

/** True when the failure is likely connectivity (queue for retry) vs business/RLS. */
export function isLikelyNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true

  const msg =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error ?? '')

  const lower = msg.toLowerCase()
  if (
    /failed to fetch|networkerror|network request failed|load failed|err_internet|err_network|err_connection|err_name_not_resolved|err_failed|timeout|timed out|econnrefused|enotfound|offline|fetch failed|aborted|connection refused|net::/i.test(
      lower
    )
  ) {
    return true
  }

  // Supabase/PostgREST often surfaces fetch failures as TypeError
  if (error instanceof TypeError && /fetch|network|load/i.test(lower)) return true

  return false
}

/** Prefer offline queue when browser is offline or the error looks like connectivity. */
export function shouldQueueOffline(error?: unknown): boolean {
  if (!isBrowserOnline()) return true
  if (error !== undefined) return isLikelyNetworkError(error)
  return false
}
