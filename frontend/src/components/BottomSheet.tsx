'use client'

import React, { useEffect, useId, useRef } from 'react'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

/**
 * Mobile-first bottom sheet with basic dialog a11y:
 * role=dialog, aria-modal, Escape to close, initial focus on open only, restore focus.
 *
 * Important: only focuses the first field when the sheet *opens*. Re-focusing on every
 * parent re-render (e.g. onClose identity change) was stealing the cursor after each
 * keystroke in Log Trip forms.
 */
export default function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!isOpen) {
      // Closing: restore focus once
      if (wasOpenRef.current) {
        previouslyFocused.current?.focus?.()
        previouslyFocused.current = null
      }
      wasOpenRef.current = false
      return
    }

    const justOpened = !wasOpenRef.current
    wasOpenRef.current = true

    if (justOpened) {
      previouslyFocused.current =
        typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    // Focus first field only when the sheet transitions closed → open
    let t: number | undefined
    if (justOpened) {
      t = window.setTimeout(() => {
        const first = panelRef.current?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        ;(first || panelRef.current)?.focus()
      }, 0)
    }

    return () => {
      if (t !== undefined) window.clearTimeout(t)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <>
      <div
        className="sheet-overlay"
        onClick={() => onCloseRef.current()}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <div className="sheet-title" id={titleId}>
          {title}
        </div>
        {children}
      </div>
    </>
  )
}
