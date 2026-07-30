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
} from '@/lib/offline-outbox'
import { isBrowserOnline } from '@/lib/offline-network'
import { CloudOff, RefreshCw, Wifi } from 'lucide-react'
import toast from 'react-hot-toast'

/**
 * Shows offline status + pending outbox count; flushes queue when back online.
 */
export default function OfflineBanner() {
  const { user, organizationId, loading } = useAuth()
  const [online, setOnline] = useState(true)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
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
            `${result.remaining} change(s) still pending — will retry when online`
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
  const summary = items
    .slice(0, 3)
    .map((i) => outboxKindLabel(i.payload.kind))
    .join(', ')

  return (
    <div
      role="status"
      data-testid="offline-banner"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 250,
        padding: '0.5rem 0.875rem',
        background: online ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.15)',
        borderBottom: `1px solid ${online ? 'var(--success)' : 'var(--accent)'}`,
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        flexWrap: 'wrap',
        fontSize: '0.8rem',
      }}
    >
      {online ? (
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
            {!online ? ' — will push when the network returns' : ''}
          </span>
        ) : (
          <span style={{ color: 'var(--text-secondary)' }}>
            Working offline — reads use last cached data; new saves are queued.
          </span>
        )}
      </div>
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
  )
}
