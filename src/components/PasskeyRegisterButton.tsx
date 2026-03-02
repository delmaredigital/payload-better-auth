'use client'

import { useState, useRef, type ButtonHTMLAttributes } from 'react'
import { createAuthClient } from 'better-auth/react'
import { twoFactorClient } from 'better-auth/client/plugins'

export type PasskeyRegisterButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onClick'
> & {
  /** Optional pre-configured auth client */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authClient?: any
  /** Optional name for the passkey */
  passkeyName?: string
  /** Callback when registration succeeds */
  onSuccess?: (passkey: { id: string; name?: string }) => void
  /** Callback when registration fails */
  onError?: (error: string) => void
  /** Button text when idle. Default: 'Add Passkey' */
  label?: string
  /** Button text when loading. Default: 'Registering...' */
  loadingLabel?: string
}

/**
 * Standalone passkey registration button component.
 * Handles the WebAuthn registration flow with Better Auth.
 *
 * @example
 * ```tsx
 * import { PasskeyRegisterButton } from '@delmaredigital/payload-better-auth/components'
 *
 * function SecuritySettings() {
 *   return (
 *     <PasskeyRegisterButton
 *       passkeyName="My MacBook"
 *       onSuccess={(passkey) => {
 *         console.log('Passkey registered:', passkey.id)
 *         refetchPasskeys()
 *       }}
 *       onError={(error) => {
 *         setError(error)
 *       }}
 *     />
 *   )
 * }
 * ```
 */
export function PasskeyRegisterButton({
  authClient: providedClient,
  passkeyName,
  onSuccess,
  onError,
  label = 'Add Passkey',
  loadingLabel = 'Registering...',
  disabled,
  children,
  ...buttonProps
}: PasskeyRegisterButtonProps) {
  const [loading, setLoading] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null)

  async function getClient() {
    if (providedClient) return providedClient
    if (clientRef.current) return clientRef.current
    const { passkeyClient } = await import(/* webpackIgnore: true */ '@better-auth/passkey/client')
    clientRef.current = createAuthClient({
      plugins: [twoFactorClient(), passkeyClient()],
    })
    return clientRef.current
  }

  async function handleClick() {
    setLoading(true)

    try {
      const client = await getClient()
      const result = await client.passkey.addPasskey({
        name: passkeyName,
      })

      if (result.error) {
        onError?.(result.error.message ?? 'Passkey registration failed')
      } else if (result.data) {
        onSuccess?.({ id: result.data.id, name: passkeyName })
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        onError?.('Passkey registration was cancelled or not allowed')
      } else if (err instanceof Error && err.name === 'InvalidStateError') {
        onError?.('This passkey is already registered')
      } else {
        onError?.(
          err instanceof Error ? err.message : 'Passkey registration failed'
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

export default PasskeyRegisterButton
