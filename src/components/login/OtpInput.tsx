export function OtpInput({ id, value, onChange, length = 6 }: { id: string; value: string; onChange: (v: string) => void; length?: number }) {
  return (
    <input id={id} type="text" inputMode="numeric" autoComplete="one-time-code" value={value} required placeholder={'0'.repeat(length)}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
      style={{ width: '100%', padding: 'calc(var(--base) * 0.75)', background: 'var(--theme-input-bg)', border: '1px solid var(--theme-elevation-150)', borderRadius: 'var(--style-radius-s)', color: 'var(--theme-text)', fontSize: 'var(--font-size-h4)', fontFamily: 'monospace', textAlign: 'center', letterSpacing: '0.5em', outline: 'none', boxSizing: 'border-box' }} />
  )
}
