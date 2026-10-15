import { color, font, radius, space } from '../theme.js'
export function OtpInput({ id, value, onChange, length = 6, autoFocus = false, pattern }: { id: string; value: string; onChange: (v: string) => void; length?: number; autoFocus?: boolean; pattern?: string }) {
  return (
    <input id={id} type="text" inputMode="numeric" autoComplete="one-time-code" value={value} required placeholder={'0'.repeat(length)} autoFocus={autoFocus} pattern={pattern}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
      style={{ width: '100%', padding: space(0.75), background: color.inputBg, border: `1px solid ${color.inputBorder}`, borderRadius: radius.small, color: color.text, fontSize: font.h4, fontFamily: 'monospace', textAlign: 'center', letterSpacing: '0.5em', outline: 'none', boxSizing: 'border-box' }} />
  )
}
