'use client'

import type { ReactNode } from 'react'

/**
 * Shared page title block used by dashboard modules.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? (
        <div
          role="group"
          aria-label="Page actions"
          style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
        >
          {actions}
        </div>
      ) : null}
    </div>
  )
}
