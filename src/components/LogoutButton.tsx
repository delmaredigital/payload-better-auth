'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation.js'

/**
 * Logout button component styled to match Payload's admin nav.
 * Uses Payload's CSS classes and variables for native theme integration.
 *
 * Clears both Better Auth session and Payload's JWT cookie to ensure
 * clean state when switching between users.
 */
export function LogoutButton() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  async function handleLogout() {
    if (isLoading) return
    setIsLoading(true)

    try {
      // Clear both sessions simultaneously while cookies are still valid.
      // - Better Auth: clears BA session cookie
      // - Payload: clears JWT cookie (payload-token) so useAuth() resets
      await Promise.allSettled([
        fetch('/api/auth/sign-out', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        fetch('/api/users/logout', {
          method: 'POST',
          credentials: 'include',
        }),
      ])

      router.push('/admin/login')
    } catch (error) {
      console.error('[better-auth] Logout error:', error)
      setIsLoading(false)
    }
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
