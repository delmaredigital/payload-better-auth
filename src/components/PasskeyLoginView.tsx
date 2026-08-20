'use client'

import { useRef } from 'react'
import { createAuthClient } from 'better-auth/react'
import { twoFactorClient, magicLinkClient, emailOTPClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'
import { LoginView } from './LoginView.js'
import { useAuthClientBaseURL } from './useAuthMountPath.js'
import type { ResolvedLoginViewProps } from './LoginViewWrapper.js'

/**
 * Client wrapper that builds an auth client WITH the passkey plugin and injects
 * it into LoginView.
 *
 * This module statically imports `@better-auth/passkey/client`, so it is the
 * opt-in home for that optional peer: only consumers who point their admin login
 * at the passkey wrapper pull passkey into their bundle (and they have the peer
 * installed). The default LoginView / LoginViewWrapper stay passkey-free, so
 * consumers who don't use passkey never hit a missing-module build error.
 */
// baseURL targets the mount (routes.api + authBasePath) instead of Better
// Auth's `/api/auth` default. It's undefined during SSR (no window); the ref
// re-initializes on the hydration render, where it's set.
//
// Kept as a named factory so the ref infers this exact plugin-laden client
// type. Better Auth 1.7's `hydrateSession(session)` puts the session — and so
// the plugin-augmented user shape — in parameter position, which makes the
// client type invariant: a client built with plugins no longer assigns to the
// bare `ReturnType<typeof createAuthClient>`.
function createPasskeyAuthClient(baseURL: string | undefined) {
  return createAuthClient({
    ...(baseURL ? { baseURL } : {}),
    plugins: [twoFactorClient(), magicLinkClient(), emailOTPClient(), passkeyClient()],
  })
}

export function PasskeyLoginView(props: ResolvedLoginViewProps) {
  const authBaseURL = useAuthClientBaseURL(props.authBasePath)
  const clientRef = useRef<ReturnType<typeof createPasskeyAuthClient> | null>(null)
  if (!clientRef.current) {
    clientRef.current = createPasskeyAuthClient(authBaseURL)
  }
  return <LoginView {...props} authClient={clientRef.current} />
}

export default PasskeyLoginView
