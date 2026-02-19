'use client'

import { useRouter } from 'next/navigation.js'
import { useCallback } from 'react'
import { useAuth, useDocumentInfo } from '@payloadcms/ui'
import { TwoFactorManagementClient } from '../TwoFactorManagementClient.js'

/**
 * Wrapper around TwoFactorManagementClient for use as a Payload `ui` field.
 *
 * Better Auth's 2FA APIs are session-based (always operate on the logged-in user).
 * When viewing another user's document, we show an info message instead of the
 * management UI to avoid the admin accidentally modifying their own 2FA settings
 * while on someone else's page.
 *
 * While auth context is hydrating (user is null), we show the management UI since
 * the API is session-based and will only ever operate on the logged-in user's own
 * 2FA settings — no other user's data can be leaked or modified.
 *
 * After 2FA is enabled or disabled, triggers a Next.js router refresh so that
 * the document form re-fetches from the DB and picks up the `twoFactorEnabled`
 * value that Better Auth wrote. Without this, navigating away without clicking
 * Save would overwrite the change.
 */
export function TwoFactorField() {
  const router = useRouter()
  const { id: documentId } = useDocumentInfo()
  const { user } = useAuth()

  const handleComplete = useCallback(() => {
    router.refresh()
  }, [router])

  // Only block when we KNOW it's a different user.
  // While auth is loading (user is null), show the UI — it's session-based
  // and only operates on the logged-in user's own 2FA regardless.
  if (user && String(documentId) !== String(user.id)) {
    return (
      <div className="field-type">
        <p className="field-description">Two-factor authentication can only be managed by the account owner.</p>
      </div>
    )
  }

  return <TwoFactorManagementClient onComplete={handleComplete} />
}

export default TwoFactorField
