import type { ReactNode } from 'react'

export function AuthBanner({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  const palette = kind === 'error'
    ? { color: 'var(--theme-error-500)', background: 'var(--theme-error-50)', border: '1px solid var(--theme-error-200)' }
    : { color: 'var(--theme-success-500)', background: 'var(--theme-success-50)', border: '1px solid var(--theme-success-200)' }
  return (
    <div role="alert" aria-live="polite" style={{ marginBottom: 'var(--base)', fontSize: 'var(--font-size-small)', padding: 'calc(var(--base) * 0.5)', borderRadius: 'var(--style-radius-s)', ...palette }}>
      {children}
    </div>
  )
}
