'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import {
  countOutbox,
  flushOutbox,
  listOutbox,
  outboxKindLabel,
  subscribeOutbox,
  removeOutboxItem,
  resetOutboxItemAttempts,
} from '@/lib/offline-outbox'
import { isBrowserOnline } from '@/lib/offline-network'
import { AlertCircle, ChevronDown, ChevronUp, CloudOff, RefreshCw, Trash2, Wifi } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * Shows offline status + pending outbox count; flushes queue when back online.
 * Displays failed mutations with explicit errors to avoid silent data loss.
 */
export default function OfflineBanner() {
  const { user, organizationId, loading } = useAuth()
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [showErrorDetails, setShowErrorDetails] = useState(false)
  const supabase = createClient()

  const refreshCount = useCallback(() => {
    setPending(countOutbox(user?.id, organizationId))
  }, [user?.id, organizationId])

  const runFlush = useCallback(
    async (quiet = false) => {
      const uid = user?.id
      if (!uid || !organizationId) return
      if (!isBrowserOnline()) return
      const n = countOutbox(uid, organizationId)
      if (n === 0) return

      setSyncing(true)
      try {
        const result = await flushOutbox(supabase, uid, organizationId)
        refreshCount()
        if (result.succeeded > 0 && !quiet) {
          toast.success(
            `Synced ${result.succeeded} offline change${result.succeeded === 1 ? '' : 's'}`
          )
        }
        if (result.failed > 0 && result.remaining > 0 && !quiet) {
          toast.error(
            `${result.remaining} change(s) failed or pending — check sync details`
          )
        }
        // Notify pages to reload data
        if (result.succeeded > 0 && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('khani:outbox-flushed', { detail: result }))
        }
      } catch (e) {
        if (!quiet) {
          toast.error('Offline sync failed — will retry')
        }
        console.warn('[offline] flush failed', e)
      } finally {
        setSyncing(false)
        refreshCount()
      }
    },
    [user, organizationId, supabase, refreshCount]
  )

  useEffect(() => {
    setOnline(isBrowserOnline())
    refreshCount()
    const unsub = subscribeOutbox(refreshCount)

    const onOnline = () => {
      setOnline(true)
      void runFlush(false)
    }
    const onOffline = () => setOnline(false)
    const onVis = () => {
      if (document.visibilityState === 'visible' && isBrowserOnline()) {
        void runFlush(true)
      }
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVis)

    // Initial flush if we have pending work
    if (isBrowserOnline()) {
      void runFlush(true)
    }

    return () => {
      unsub()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [refreshCount, runFlush])

  if (loading || (!user && pending === 0)) return null
  if (online && pending === 0) return null

  const items = user?.id && organizationId ? listOutbox(user.id, organizationId) : []
  const failedItems = items.filter((i) => (i.attempts && i.attempts > 0) || i.lastError)
  const summary = items
    .slice(0, 3)
    .map((i) => outboxKindLabel(i.payload.kind))
    .join(', ')

  return (
    <div
      aria-live="polite"
      role="status"
      data-testid="offline-banner"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 250,
        padding: '0.5rem 0.875rem',
        background: failedItems.length > 0
          ? 'rgba(239,68,68,0.12)'
          : online
            ? 'rgba(16,185,129,0.12)'
            : 'rgba(245,158,11,0.15)',
        borderBottom: `1px solid ${
          failedItems.length > 0
            ? 'var(--border-danger, #ef4444)'
            : online
              ? 'var(--success)'
              : 'var(--accent)'
        }`,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        fontSize: '0.8rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        {failedItems.length > 0 ? (
          <AlertCircle size={16} style={{ color: 'var(--danger, #ef4444)', flexShrink: 0 }} />
        ) : online ? (
          <Wifi size={16} style={{ color: 'var(--success)', flexShrink: 0 }} />
        ) : (
          <CloudOff size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!online && (
            <strong style={{ display: 'block' }}>You&apos;re offline</strong>
          )}
          {pending > 0 ? (
            <span style={{ color: 'var(--text-secondary)' }}>
              {pending} change{pending === 1 ? '' : 's'} waiting to sync
              {summary ? ` (${summary}${pending > 3 ? '…' : ''})` : ''}
              {failedItems.length > 0
                ? ` — ${failedItems.length} item(s) encountered sync errors`
                : !online
                  ? ' — will push when the network returns'
                  : ''}
            </span>
          ) : (
            <span style={{ color: 'var(--text-secondary)' }}>
              Working offline — reads use last cached data; new saves are queued.
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {failedItems.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowErrorDetails((v) => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem' }}
            >
              {showErrorDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showErrorDetails ? 'Hide errors' : 'View errors'}
            </button>
          )}
          {online && pending > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={syncing}
              onClick={() => void runFlush(false)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <RefreshCw size={14} className={syncing ? 'spinner' : undefined} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          )}
        </div>
      </div>

      {showErrorDetails && failedItems.length > 0 && (
        <div
          style={{
            background: 'var(--bg-card, #12131a)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '0.5rem 0.75rem',
            marginTop: '0.25rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          <strong style={{ fontSize: '0.75rem', color: 'var(--danger, #ef4444)' }}>
            Failed Offline Items ({failedItems.length}):
          </strong>
          {failedItems.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                borderBottom: '1px solid var(--border)',
                paddingBottom: '0.35rem',
                gap: '0.5rem',
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{outboxKindLabel(item.payload.kind)}</span>: {item.lastError || 'Sync failed'}
                <span style={{ color: 'var(--text-secondary)', marginLeft: '0.35rem' }}>
                  (Attempts: {item.attempts})
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.35rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  title="Retry sync"
                  onClick={() => {
                    resetOutboxItemAttempts(user?.id, organizationId, item.id)
                    refreshCount()
                    void runFlush(false)
                  }}
                  style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }}
                >
                  Retry
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  title="Dismiss item"
                  onClick={() => {
                    removeOutboxItem(user?.id, organizationId, item.id)
                    refreshCount()
                    toast.success('Item dismissed from sync queue')
                  }}
                  style={{ padding: '0.2rem 0.4rem', color: 'var(--danger, #ef4444)' }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

