import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// H9: the auto-injected LoginView must NOT import optional peer clients
// (@better-auth/passkey, @better-auth/api-key). Bundlers resolve the import
// specifier at build time, so any reference breaks the build of consumers who
// haven't installed the optional peer — even when they don't use it. Passkey/
// api-key capability comes from a consumer-injected `authClient` instead.
describe('LoginView optional-peer imports (H9 regression guard)', () => {
  const path = fileURLToPath(
    new URL('../../src/components/LoginView.tsx', import.meta.url)
  )
  const src = readFileSync(path, 'utf8')

  // Match real import statements only (static `from '...'` or dynamic
  // `import('...')`), not mentions in comments/docs.
  const importsPeer = (pkg: string) => {
    const p = pkg.replace(/[/-]/g, '\\$&')
    return new RegExp(`(from|import\\s*\\()\\s*['"\`]${p}`).test(src)
  }

  it('does not import @better-auth/passkey', () => {
    expect(importsPeer('@better-auth/passkey')).toBe(false)
  })

  it('does not import @better-auth/api-key', () => {
    expect(importsPeer('@better-auth/api-key')).toBe(false)
  })

  it('still builds its default client from core plugins', () => {
    expect(src).toMatch(/twoFactorClient\(\)/)
    expect(src).toMatch(/magicLinkClient\(\)/)
    expect(src).toMatch(/emailOTPClient\(\)/)
  })
})
