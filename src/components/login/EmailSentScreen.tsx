import type { ReactNode } from 'react'
import { AuthCard } from './AuthCard.js'
import { color, font, radius, space } from '../theme.js'

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
          background: color.successBg,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: `0 auto ${space(1.5)}`,
          fontSize: '28px',
        }}
      >
        {icon}
      </div>

      <h1
        style={{
          color: color.text,
          fontSize: font.h3,
          fontWeight: 600,
          margin: `0 0 ${space(0.5)} 0`,
        }}
      >
        Check Your Email
      </h1>

      <p
        style={{
          color: color.text,
          opacity: 0.7,
          fontSize: font.small,
          marginBottom: space(1.5),
        }}
      >
        {message}
      </p>

      {note && (
        <p
          style={{
            color: color.text,
            opacity: 0.6,
            fontSize: font.small,
            marginBottom: space(1.5),
          }}
        >
          {note}
        </p>
      )}

      <button
        type="button"
        onClick={onBack}
        style={{
          padding: `${space(0.75)} ${space(1.5)}`,
          background: color.surfaceRaised,
          border: 'none',
          borderRadius: radius.small,
          color: color.text,
          fontSize: font.base,
          cursor: 'pointer',
        }}
      >
        Back to login
      </button>
    </AuthCard>
  )
}
