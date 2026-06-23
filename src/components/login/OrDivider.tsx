export function OrDivider() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        margin: 'calc(var(--base) * 1.5) 0',
        gap: 'calc(var(--base) * 1)',
      }}
    >
      <div style={{ flex: 1, height: '1px', background: 'var(--theme-elevation-150)' }} />
      <span style={{ color: 'var(--theme-text)', opacity: 0.6, fontSize: 'var(--font-size-small)' }}>
        or
      </span>
      <div style={{ flex: 1, height: '1px', background: 'var(--theme-elevation-150)' }} />
    </div>
  )
}
