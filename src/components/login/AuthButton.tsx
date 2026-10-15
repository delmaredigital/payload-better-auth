import type { ReactNode } from 'react'
import { color, font, radius, space } from '../theme.js'

export function AuthButton({ variant = 'primary', type = 'button', disabled, onClick, icon, children }: {
  variant?: 'primary' | 'secondary'; type?: 'button' | 'submit'; disabled?: boolean
  onClick?: () => void; icon?: ReactNode; children: ReactNode
}) {
  const base = { width: '100%', padding: space(0.75), borderRadius: radius.small, fontSize: font.base, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.7 : 1, transition: 'opacity 150ms ease' } as const
  const variantStyle = variant === 'primary'
    ? { background: color.inverse, border: 'none', color: color.onInverse }
    : { background: 'transparent', border: `1px solid ${color.border}`, color: color.text, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: space(0.5) }
  return (
    <button type={type} disabled={disabled} onClick={onClick} style={{ ...base, ...variantStyle }}>
      {icon && <span style={{ fontSize: '18px' }}>{icon}</span>}
      {children}
    </button>
  )
}
