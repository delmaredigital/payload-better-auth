import type { ReactNode } from 'react'
import { color, radius, space } from '../theme.js'

export function AuthCard({ logo, center = false, children }: { logo?: ReactNode; center?: boolean; children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: color.bg, padding: space() }}>
      <div style={{ background: color.surface, padding: space(2), borderRadius: radius.medium, boxShadow: '0 2px 20px rgba(0, 0, 0, 0.1)', width: '100%', maxWidth: '400px', ...(center ? { textAlign: 'center' as const } : {}) }}>
        {logo && <div style={{ textAlign: 'center', marginBottom: space(1.5) }}>{logo}</div>}
        {children}
      </div>
    </div>
  )
}
