'use client'

import { useRouter } from 'next/navigation.js'
import { useCallback } from 'react'
import { TwoFactorManagementClient } from '../TwoFactorManagementClient.js'

/**
 * Wrapper around TwoFactorManagementClient for use as a Payload `ui` field.
 *
 * After 2FA is enabled or disabled, triggers a Next.js router refresh so that
 * the document form re-fetches from the DB and picks up the `twoFactorEnabled`
 * value that Better Auth wrote. Without this, navigating away without clicking
 * Save would overwrite the change.
 */
export function TwoFactorField() {
  const router = useRouter()

  const handleComplete = useCallback(() => {
    router.refresh()
  }, [router])

  return <TwoFactorManagementClient onComplete={handleComplete} />
}

export default TwoFactorField
