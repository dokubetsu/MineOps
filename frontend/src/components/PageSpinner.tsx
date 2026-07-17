/** Simple full-page / section loading indicator for App Router loading.tsx and gates. */
export default function PageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      className="page-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '40vh',
        gap: '0.75rem',
        color: 'var(--text-secondary)',
      }}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="spinner" aria-hidden />
      <span style={{ fontSize: '0.875rem' }}>{label}</span>
    </div>
  )
}
