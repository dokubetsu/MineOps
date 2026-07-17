/**
 * Normalize unknown thrown values for toasts and UI messages.
 * Prefer this over `catch (err: any)` + `err.message`.
 */
export function toErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error) {
    return err.message?.trim() || fallback
  }
  if (typeof err === 'string' && err.trim()) {
    return err.trim()
  }
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message: unknown }).message
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  }
  return fallback
}
