import { color, font, space } from '../theme.js'
export function OrDivider() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        margin: `${space(1.5)} 0`,
        gap: space(1),
      }}
    >
      <div style={{ flex: 1, height: '1px', background: color.border }} />
      <span style={{ color: color.text, opacity: 0.6, fontSize: font.small }}>
        or
      </span>
      <div style={{ flex: 1, height: '1px', background: color.border }} />
    </div>
  )
}
