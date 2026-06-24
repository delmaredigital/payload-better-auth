import type { ReactNode } from 'react'
import { AuthCard } from './AuthCard.js'

export function EmailSentScreen({
  icon,
  message,
  note,
  logo,
  onBack,
}: {
  icon: string
  message: ReactNode
  note?: ReactNode
  logo?: ReactNode
  onBack: () => void
}) {
  return (
    <AuthCard logo={logo} center>
      <div
        style={{
          width: '64px',
          height: '64px',
          background: 'var(--theme-success-100)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto calc(var(--base) * 1.5)',
          fontSize: '28px',
        }}
      >
        {icon}
      </div>

      <h1
        style={{
          color: 'var(--theme-text)',
          fontSize: 'var(--font-size-h3)',
          fontWeight: 600,
          margin: '0 0 calc(var(--base) * 0.5) 0',
        }}
      >
        Check Your Email
      </h1>

      <p
        style={{
          color: 'var(--theme-text)',
          opacity: 0.7,
          fontSize: 'var(--font-size-small)',
          marginBottom: 'calc(var(--base) * 1.5)',
        }}
      >
        {message}
      </p>

      {note && (
        <p
          style={{
            color: 'var(--theme-text)',
            opacity: 0.6,
            fontSize: 'var(--font-size-small)',
            marginBottom: 'calc(var(--base) * 1.5)',
          }}
        >
          {note}
        </p>
      )}

      <button
        type="button"
        onClick={onBack}
        style={{
          padding: 'calc(var(--base) * 0.75) calc(var(--base) * 1.5)',
          background: 'var(--theme-elevation-150)',
          border: 'none',
          borderRadius: 'var(--style-radius-s)',
          color: 'var(--theme-text)',
          fontSize: 'var(--font-size-base)',
          cursor: 'pointer',
        }}
      >
        Back to login
      </button>
    </AuthCard>
  )
}
