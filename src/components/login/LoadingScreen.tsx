import { color } from '../theme.js'
export function LoadingScreen() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color.bg,
      }}
    >
      <div style={{ color: color.text, opacity: 0.7 }}>
        Loading...
      </div>
    </div>
  )
}
