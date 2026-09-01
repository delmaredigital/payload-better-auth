import type { AdminViewProps } from 'payload'
import { resolveLoginViewProps } from './LoginViewWrapper.js'
import { PasskeyLoginView } from './PasskeyLoginView.js'

/**
 * Passkey-enabled variant of `LoginViewWrapper`.
 *
 * Point your admin login view at this (instead of the default) to enable passkey
 * sign-in on the admin login. It performs the same server-side method detection
 * as `LoginViewWrapper`, then injects a passkey-capable auth client via a client
 * component — the optional `@better-auth/passkey` peer is imported only along
 * this path, so the default login view stays passkey-free.
 *
 * @example
 * ```ts
 * // payload.config.ts
 * createBetterAuthPlugin({
 *   admin: {
 *     loginViewComponent:
 *       '@delmaredigital/payload-better-auth/components/login-passkey#LoginViewWrapperWithPasskey',
 *   },
 * })
 * ```
 */
export async function LoginViewWrapperWithPasskey({ initPageResult }: AdminViewProps) {
  const { payload } = initPageResult.req
  return <PasskeyLoginView {...(await resolveLoginViewProps(payload))} />
}

export default LoginViewWrapperWithPasskey
