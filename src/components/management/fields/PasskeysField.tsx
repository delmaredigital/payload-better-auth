'use client'

import { useAuth, useDocumentInfo } from '@payloadcms/ui'
import { PasskeysManagementClient } from '../PasskeysManagementClient.js'

/**
 * Thin wrapper around PasskeysManagementClient for use as a Payload `ui` field.
 *
 * Better Auth's passkey APIs are session-based (always operate on the logged-in user).
 * When viewing another user's document, we show an info message instead of the
 * management UI to avoid displaying the admin's own passkeys on someone else's page.
 *
 * While auth context is hydrating (user is null), we show the management UI since
 * the API is session-based and will only ever return the logged-in user's passkeys —
 * no other user's data can be leaked.
 */
export function PasskeysField() {
  const { id: documentId } = useDocumentInfo()
  const { user } = useAuth()

  // Only block when we KNOW it's a different user.
  // While auth is loading (user is null), show the UI — it's session-based
  // and only returns the logged-in user's own passkeys regardless.
  if (user && String(documentId) !== String(user.id)) {
    return (
      <div className="field-type">
        <p className="field-description">Passkeys can only be managed by the account owner.</p>
      </div>
    )
  }

  return <PasskeysManagementClient />
}

export default PasskeysField
