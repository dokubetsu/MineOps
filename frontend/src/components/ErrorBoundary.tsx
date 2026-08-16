'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode)
  onError?: (error: Error, errorInfo: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught component error:', error, errorInfo)
    if (this.props.onError) {
      try {
        this.props.onError(error, errorInfo)
      } catch (e) {
        console.warn('[ErrorBoundary] onError callback failed:', e)
      }
    }
  }

  resetError = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'function') {
          return this.props.fallback(this.state.error || new Error('Unknown error'), this.resetError)
        }
        return this.props.fallback
      }

      return (
        <div
          role="alert"
          style={{
            padding: '2rem 1.5rem',
            margin: '1.5rem auto',
            maxWidth: '640px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-danger)',
            borderRadius: '12px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              padding: '0.75rem',
              borderRadius: '50%',
              background: 'rgba(239, 68, 68, 0.12)',
              color: 'var(--danger)',
              marginBottom: '1rem',
            }}
          >
            <AlertTriangle size={32} />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
            Something went wrong
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
              marginBottom: '1.25rem',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error?.message || 'An unexpected error occurred while rendering this component.'}
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={this.resetError}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              margin: '0 auto',
            }}
          >
            <RotateCcw size={16} />
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
