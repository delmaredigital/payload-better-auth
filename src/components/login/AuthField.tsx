import type { ChangeEvent, Ref } from 'react'

export function AuthField({ id, label, type, value, onChange, autoComplete, required = true, inputRef, marginBottom = 'var(--base)' }: {
  id: string; label: string; type: string; value: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  autoComplete?: string; required?: boolean; inputRef?: Ref<HTMLInputElement>
  marginBottom?: string
}) {
  return (
    <div style={{ marginBottom }}>
      <label htmlFor={id} style={{ display: 'block', color: 'var(--theme-text)', marginBottom: 'calc(var(--base) * 0.5)', fontSize: 'var(--font-size-small)', fontWeight: 500 }}>{label}</label>
      <input id={id} type={type} value={value} onChange={onChange} required={required} autoComplete={autoComplete} ref={inputRef}
        style={{ width: '100%', padding: 'calc(var(--base) * 0.75)', background: 'var(--theme-input-bg)', border: '1px solid var(--theme-elevation-150)', borderRadius: 'var(--style-radius-s)', color: 'var(--theme-text)', fontSize: 'var(--font-size-base)', outline: 'none', boxSizing: 'border-box' }} />
    </div>
  )
}
