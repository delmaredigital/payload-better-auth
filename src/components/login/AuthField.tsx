import type { ChangeEvent, Ref } from 'react'
import { color, font, radius, space } from '../theme.js'

export function AuthField({ id, label, type, value, onChange, autoComplete, required = true, inputRef, marginBottom = space(), autoFocus = false }: {
  id: string; label: string; type: string; value: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  autoComplete?: string; required?: boolean; inputRef?: Ref<HTMLInputElement>
  marginBottom?: string; autoFocus?: boolean
}) {
  return (
    <div style={{ marginBottom }}>
      <label htmlFor={id} style={{ display: 'block', color: color.text, marginBottom: space(0.5), fontSize: font.small, fontWeight: 500 }}>{label}</label>
      <input id={id} type={type} value={value} onChange={onChange} required={required} autoComplete={autoComplete} ref={inputRef} autoFocus={autoFocus}
        style={{ width: '100%', padding: space(0.75), background: color.inputBg, border: `1px solid ${color.inputBorder}`, borderRadius: radius.small, color: color.text, fontSize: font.base, outline: 'none', boxSizing: 'border-box' }} />
    </div>
  )
}
