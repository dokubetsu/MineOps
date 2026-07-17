'use client'

import { useEffect } from 'react'
import { toErrorMessage } from '@/lib/errors'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard]', error)
  }, [error])

  return (
    <div
      className="page-container"
      style={{
        maxWidth: 480,
        margin: '2rem auto',
        padding: '1.5rem',
        textAlign: 'center',
      }}
      role="alert"
    >
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Something went wrong
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
        {toErrorMessage(error, 'An unexpected error occurred in this section.')}
      </p>
      <button type="button" className="btn btn-primary" onClick={() => reset()}>
        Try again
      </button>
    </div>
  )
}
