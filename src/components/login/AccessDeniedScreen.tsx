import { AuthCard } from './AuthCard.js'
import { color, font, radius, space } from '../theme.js'

export function AccessDeniedScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <AuthCard center>
        <h1
          style={{
            color: color.danger,
            fontSize: font.h3,
            fontWeight: 600,
            margin: `0 0 ${space()} 0`,
          }}
        >
          Access Denied
        </h1>
        <p
          style={{
            color: color.text,
            opacity: 0.8,
            marginBottom: space(1.5),
            fontSize: font.small,
          }}
        >
          You don't have permission to access the admin panel.
          Please contact an administrator if you believe this is an error.
        </p>
        <button
          onClick={onSignOut}
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
          Sign out and try again
        </button>
    </AuthCard>
  )
}
