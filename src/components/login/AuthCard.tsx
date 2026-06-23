import type { ReactNode } from 'react'

export function AuthCard({ logo, center = false, children }: { logo?: ReactNode; center?: boolean; children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--theme-bg)', padding: 'var(--base)' }}>
      <div style={{ background: 'var(--theme-elevation-50)', padding: 'calc(var(--base) * 2)', borderRadius: 'var(--style-radius-m)', boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)', width: '100%', maxWidth: '400px', ...(center ? { textAlign: 'center' as const } : {}) }}>
        {logo && <div style={{ textAlign: 'center', marginBottom: 'calc(var(--base) * 1.5)' }}>{logo}</div>}
        {children}
      </div>
    </div>
  )
}
