'use client'

import { NavGroup } from '@payloadcms/ui'

export type SecurityNavLinksProps = {
  /** Base path for security views. Default: '/admin/security' */
  basePath?: string
  /** Show API Keys link. Default: true */
  showApiKeys?: boolean
}

/**
 * Navigation links for security management features.
 * Rendered in admin sidebar via afterNavLinks injection.
 * Uses Payload's NavGroup and nav CSS classes for native styling.
 *
 * Currently only renders API Keys link — 2FA and Passkeys
 * are now embedded as ui fields on the user document.
 */
export function SecurityNavLinks({
  basePath = '/admin/security',
  showApiKeys = true,
}: SecurityNavLinksProps = {}) {
  if (!showApiKeys) {
    return null
  }

  return (
    <NavGroup label="Security">
      <a
        href={`${basePath}/api-keys`}
        className="nav__link"
      >
        <span className="nav__link-label">API Keys</span>
      </a>
    </NavGroup>
  )
}

export default SecurityNavLinks
