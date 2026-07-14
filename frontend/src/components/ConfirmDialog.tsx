'use client'

import React from 'react'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null

  return (
    <>
      <div 
        onClick={onCancel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          zIndex: 300,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
        }}
      >
        <div 
          onClick={e => e.stopPropagation()}
          className="card"
          style={{
            width: '100%',
            maxWidth: '400px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-elevated)',
            padding: '1.5rem',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
            {title}
          </div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {message}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={onCancel} style={{ flex: 1 }}>
              {cancelText}
            </button>
            <button className="btn btn-danger" onClick={onConfirm} style={{ flex: 1 }}>
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
