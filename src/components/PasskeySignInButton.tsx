'use client'

import { useState, useRef, type ButtonHTMLAttributes } from 'react'
import { createAuthClient } from 'better-auth/react'
import { twoFactorClient } from 'better-auth/client/plugins'

export type PasskeySignInButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick'
> & {
  /** Optional pre-configured auth client */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authClient?: any
  /** Callback when sign-in succeeds */
  onSuccess?: (user: { id: string; email: string; role?: string }) => void
  /** Callback when sign-in fails */
  onError?: (error: string) => void
  /** Button text when idle. Default: 'Sign in with Passkey' */
  label?: string
  /** Button text when loading. Default: 'Authenticating...' */
  loadingLabel?: string
}

/**
 * Standalone passkey sign-in button component.
 * Handles the WebAuthn authentication flow with Better Auth.
 *
 * @example
 * ```tsx
 * import { PasskeySignInButton } from '@delmaredigital/payload-better-auth/components'
 *
 * function LoginForm() {
 *   return (
 *     <PasskeySignInButton
 *       onSuccess={(user) => {
 *         router.push('/dashboard')
 *       }}
 *       onError={(error) => {
 *         setError(error)
 *       }}
 *     />
 *   )
 * }
 * ```
 */
export function PasskeySignInButton({
  authClient: providedClient,
  onSuccess,
  onError,
  label = 'Sign in with Passkey',
  loadingLabel = 'Authenticating...',
  disabled,
  children,
  ...buttonProps
}: PasskeySignInButtonProps) {
  const [loading, setLoading] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null)

  async function getClient() {
    if (providedClient) return providedClient
    if (clientRef.current) return clientRef.current
    const { passkeyClient } = await import('@better-auth/passkey/client')
    clientRef.current = createAuthClient({
      plugins: [twoFactorClient(), passkeyClient()],
    })
    return clientRef.current
  }

  async function handleClick() {
    setLoading(true)

    try {
      const client = await getClient()
      const result = await client.signIn.passkey()

      if (result.error) {
        onError?.(result.error.message ?? 'Passkey authentication failed')
      } else if (result.data?.user) {
        onSuccess?.(result.data.user as { id: string; email: string; role?: string })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        onError?.('Passkey authentication was cancelled or not allowed')
      } else {
        onError?.(
          err instanceof Error ? err.message : 'Passkey authentication failed'
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || loading}
      {...buttonProps}
    >
      {children ?? (loading ? loadingLabel : label)}
    </button>
  )
}

export default PasskeySignInButton
