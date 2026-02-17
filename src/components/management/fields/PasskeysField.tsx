'use client'

import { PasskeysManagementClient } from '../PasskeysManagementClient.js'

/**
 * Thin wrapper around PasskeysManagementClient for use as a Payload `ui` field.
 */
export function PasskeysField() {
  return <PasskeysManagementClient />
}

export default PasskeysField
