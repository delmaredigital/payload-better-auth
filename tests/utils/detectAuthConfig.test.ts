import { describe, it, expect } from 'vitest'
import { detectAuthConfig } from '../../src/utils/detectAuthConfig.js'

function config(collections: any[]) {
  return { collections } as any
}

describe('detectAuthConfig', () => {
  it('detects disableLocalStrategy via the object form', () => {
    const result = detectAuthConfig(
      config([{ slug: 'users', auth: { disableLocalStrategy: true } }])
    )
    expect(result.hasDisableLocalStrategy).toBe(true)
    expect(result.authCollectionSlug).toBe('users')
  })

  // H3: `auth: true` ENABLES Payload's local strategy — it is not
  // disableLocalStrategy. Misreading it hijacked working local logins.
  it('does NOT treat `auth: true` as disableLocalStrategy', () => {
    const result = detectAuthConfig(config([{ slug: 'users', auth: true }]))
    expect(result.hasDisableLocalStrategy).toBe(false)
    expect(result.authCollectionSlug).toBeNull()
    expect(result.authCollectionConfig).toBeNull()
  })

  it('ignores a plain auth: true collection preceding the real disableLocalStrategy collection', () => {
    const result = detectAuthConfig(
      config([
        { slug: 'customers', auth: true },
        { slug: 'users', auth: { disableLocalStrategy: true } },
      ])
    )
    expect(result.hasDisableLocalStrategy).toBe(true)
    expect(result.authCollectionSlug).toBe('users')
  })

  it('returns a clean result when no auth collection exists', () => {
    const result = detectAuthConfig(config([{ slug: 'posts' }]))
    expect(result.hasDisableLocalStrategy).toBe(false)
    expect(result.authCollectionSlug).toBeNull()
  })

  it('handles an object auth without disableLocalStrategy as local-enabled', () => {
    const result = detectAuthConfig(
      config([{ slug: 'users', auth: { tokenExpiration: 7200 } }])
    )
    expect(result.hasDisableLocalStrategy).toBe(false)
  })
})
