'use client'

import { NavGroup } from '@payloadcms/ui'

export type SecurityNavLinksProps = {
  /** Base path for security views. Default: '/admin/security' */
  basePath?: string
  /** Show Two-Factor Auth link. Default: true */
  showTwoFactor?: boolean
  /** Show API Keys link. Default: true */
  showApiKeys?: boolean
  /** Show Passkeys link. Default: true */
  showPasskeys?: boolean
}

type NavLink = {
  href: string
  label: string
}

/**
 * Navigation links for security management features.
 * Rendered in admin sidebar via afterNavLinks injection.
 * Uses Payload's NavGroup and nav CSS classes for native styling.
 *
 * Links are conditionally shown based on which Better Auth plugins are enabled.
 */
export function SecurityNavLinks({
  basePath = '/admin/security',
  showTwoFactor = true,
  showApiKeys = true,
  showPasskeys = true,
}: SecurityNavLinksProps = {}) {
  const links: NavLink[] = []

  if (showTwoFactor) {
    links.push({
      href: `${basePath}/two-factor`,
      label: 'Two-Factor Auth',
    })
  }

  if (showApiKeys) {
    links.push({
      href: `${basePath}/api-keys`,
      label: 'API Keys',
    })
  }

  if (showPasskeys) {
    links.push({
      href: `${basePath}/passkeys`,
      label: 'Passkeys',
    })
  }

  if (links.length === 0) {
    return null
  }

  return (
    <NavGroup label="Security">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          className="nav__link"
        >
          <span className="nav__link-label">{link.label}</span>
        </a>
      ))}
    </NavGroup>
  )
}

export default SecurityNavLinks
