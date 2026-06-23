import type { ReactNode } from 'react'

export function AuthButton({ variant = 'primary', type = 'button', disabled, onClick, icon, children }: {
  variant?: 'primary' | 'secondary'; type?: 'button' | 'submit'; disabled?: boolean
  onClick?: () => void; icon?: ReactNode; children: ReactNode
}) {
  const base = { width: '100%', padding: 'calc(var(--base) * 0.75)', borderRadius: 'var(--style-radius-s)', fontSize: 'var(--font-size-base)', fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1, transition: 'opacity 150ms ease' } as const
  const variantStyle = variant === 'primary'
    ? { background: 'var(--theme-elevation-800)', border: 'none', color: 'var(--theme-elevation-50)' }
    : { background: 'transparent', border: '1px solid var(--theme-elevation-300)', color: 'var(--theme-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'calc(var(--base) * 0.5)' }
  return (
    <button type={type} disabled={disabled} onClick={onClick} style={{ ...base, ...variantStyle }}>
      {icon && <span style={{ fontSize: '18px' }}>{icon}</span>}
      {children}
    </button>
  )
}
