'use client'

import { useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import { useAuthMountPath } from './useAuthMountPath.js'

/**
 * Logout button component styled to match Payload's admin nav.
 * Uses Payload's CSS classes and variables for native theme integration.
 *
 * Signs out of Better Auth, then performs a full navigation to the login
 * page so every piece of client-side auth state (Payload's `useAuth()`,
 * the router cache) is discarded along with the session cookie.
 */
export function LogoutButton() {
  // Payload Config
  const {config: {routes: {admin:adminRoute}}} = useConfig()
  const authMountPath = useAuthMountPath()
  const [isLoading, setIsLoading] = useState(false)

  async function handleLogout() {
    if (isLoading) return
    setIsLoading(true)

    try {
      // Better Auth is the only session when the local strategy is disabled
      // (the recommended setup). Payload's `/users/logout` answers 400 there —
      // there is no local JWT to invalidate — so it is not called.
      await fetch(`${authMountPath}/sign-out`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    } catch (error) {
      // Best effort: the hard navigation below still resets the client, and
      // the login view re-checks the session server-side.
      console.error('[better-auth] Logout error:', error)
    }

    // A full navigation, not `router.push`. A soft navigation keeps Payload's
    // client auth state alive, so the admin still treats the user as logged in
    // even though the cookie is gone.
    window.location.assign(`${adminRoute}/login`)
  }

  return (
    <button
      onClick={handleLogout}
      disabled={isLoading}
      type="button"
      className="nav__link"
      style={{
        background: 'none',
        border: 'none',
        cursor: isLoading ? 'not-allowed' : 'pointer',
        opacity: isLoading ? 0.7 : 1,
        width: '100%',
        textAlign: 'left',
        padding: 0,
      }}
    >
      <span className="nav__link-label">
        {isLoading ? 'Logging out...' : 'Log out'}
      </span>
    </button>
  )
}

export default LogoutButton
