import type { ReactNode } from 'react'
import { color, font, radius, space } from '../theme.js'

export function AuthBanner({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  const palette = kind === 'error'
    ? { color: color.danger, background: color.dangerBg, border: `1px solid ${color.dangerBorder}` }
    : { color: color.success, background: color.successBg, border: `1px solid ${color.successBorder}` }
  return (
    <div role="alert" aria-live="polite" style={{ marginBottom: space(), fontSize: font.small, padding: space(0.5), borderRadius: radius.small, ...palette }}>
      {children}
    </div>
  )
}
