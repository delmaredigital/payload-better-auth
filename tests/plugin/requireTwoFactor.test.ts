import { describe, it, expect, vi, afterEach } from 'vitest'
import { twoFactor } from 'better-auth/plugins'
import { requireTwoFactor } from '../../src/plugin/requireTwoFactor.js'
import type {
  Access,
  CollectionConfig,
  Config,
  GlobalConfig,
  PayloadRequest,
} from 'payload'

const reqWith = (user: Record<string, unknown> | null) =>
  ({ user }) as unknown as PayloadRequest

const enrolled = { id: '1', twoFactorEnabled: true }
const notEnrolled = { id: '2', twoFactorEnabled: false }

const allow: Access = () => true

function buildConfig(overrides: {
  collections?: Partial<CollectionConfig>[]
  globals?: Partial<GlobalConfig>[]
}): Config {
  return {
    collections: (overrides.collections ?? []) as CollectionConfig[],
    globals: (overrides.globals ?? []) as GlobalConfig[],
  } as unknown as Config
}

function accessOf(config: Config, slug: string) {
  const collection = config.collections?.find((c) => c.slug === slug)
  expect(collection, `collection ${slug}`).toBeDefined()
  return (collection?.access ?? {}) as Record<string, Access>
}

describe('requireTwoFactor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('denies a signed-in user without a second factor, passes one through with it', async () => {
    const config = requireTwoFactor()(
      buildConfig({ collections: [{ slug: 'pages', access: { read: allow }, fields: [] }] })
    )
    const { read } = accessOf(config, 'pages')

    expect(await read({ req: reqWith(notEnrolled) } as never)).toBe(false)
    expect(await read({ req: reqWith(enrolled) } as never)).toBe(true)
  })

  it('leaves anonymous requests to the original access control', async () => {
    const publicRead: Access = ({ req }) => Boolean(req.user) || 'public' in (req as never)
    const config = requireTwoFactor()(
      buildConfig({ collections: [{ slug: 'pages', access: { read: () => true }, fields: [] }] })
    )
    const { read } = accessOf(config, 'pages')

    // No user: the gate must not deny — the wrapped access decides.
    expect(await read({ req: reqWith(null) } as never)).toBe(true)
    void publicRead
  })

  it('never gates the admin access key', () => {
    const admin = vi.fn(() => true)
    const config = requireTwoFactor()(
      buildConfig({ collections: [{ slug: 'pages', access: { admin, read: allow }, fields: [] }] })
    )

    expect(accessOf(config, 'pages').admin).toBe(admin)
  })

  it('fails closed on operations with undefined access (default-equivalent when enrolled)', async () => {
    const config = requireTwoFactor()(
      buildConfig({ collections: [{ slug: 'pages', fields: [] }] })
    )
    const access = accessOf(config, 'pages')

    for (const key of ['create', 'read', 'update', 'delete', 'readVersions', 'unlock']) {
      expect(typeof access[key], `access.${key}`).toBe('function')
      expect(await access[key]({ req: reqWith(notEnrolled) } as never)).toBe(false)
      // Enrolled users get Payload's default: any authenticated user.
      expect(await access[key]({ req: reqWith(enrolled) } as never)).toBe(true)
      // Anonymous users get Payload's default too: denied.
      expect(await access[key]({ req: reqWith(null) } as never)).toBe(false)
    }
  })

  it('gates globals', async () => {
    const config = requireTwoFactor()(
      buildConfig({ globals: [{ slug: 'header', access: { read: allow }, fields: [] }] })
    )
    const header = config.globals?.find((g) => g.slug === 'header')
    const read = header?.access?.read as Access

    expect(await read({ req: reqWith(notEnrolled) } as never)).toBe(false)
    expect(await read({ req: reqWith(enrolled) } as never)).toBe(true)
  })

  it('respects excludeCollections and excludeGlobals', async () => {
    const config = requireTwoFactor({
      excludeCollections: ['open'],
      excludeGlobals: ['footer'],
    })(
      buildConfig({
        collections: [{ slug: 'open', access: { read: allow }, fields: [] }],
        globals: [{ slug: 'footer', access: { read: allow }, fields: [] }],
      })
    )

    expect(await accessOf(config, 'open').read({ req: reqWith(notEnrolled) } as never)).toBe(true)
    const footer = config.globals?.find((g) => g.slug === 'footer')
    expect(await (footer?.access?.read as Access)({ req: reqWith(notEnrolled) } as never)).toBe(true)
  })

  it('exempts machine credentials by default, gates them when disabled', async () => {
    const apiKeyUser = { id: '3', twoFactorEnabled: false, apiKeyScopes: ['pages:read'] }
    const collections = [{ slug: 'pages', access: { read: allow }, fields: [] }]

    const defaultConfig = requireTwoFactor()(buildConfig({ collections }))
    expect(
      await accessOf(defaultConfig, 'pages').read({ req: reqWith(apiKeyUser) } as never)
    ).toBe(true)

    const strictConfig = requireTwoFactor({ exemptMachineCredentials: false })(
      buildConfig({ collections })
    )
    expect(
      await accessOf(strictConfig, 'pages').read({ req: reqWith(apiKeyUser) } as never)
    ).toBe(false)
  })

  it('honors a custom exempt callback', async () => {
    const config = requireTwoFactor({
      exempt: (req) => (req.user as { id?: string } | null)?.id === '2',
    })(buildConfig({ collections: [{ slug: 'pages', access: { read: allow }, fields: [] }] }))

    expect(await accessOf(config, 'pages').read({ req: reqWith(notEnrolled) } as never)).toBe(true)
  })

  it('supports a custom fieldName', async () => {
    const config = requireTwoFactor({ fieldName: 'mfaEnrolled' })(
      buildConfig({ collections: [{ slug: 'pages', access: { read: allow }, fields: [] }] })
    )
    const { read } = accessOf(config, 'pages')

    expect(await read({ req: reqWith({ id: '4', mfaEnrolled: true }) } as never)).toBe(true)
    expect(await read({ req: reqWith({ id: '5', mfaEnrolled: false }) } as never)).toBe(false)
  })

  it('is a no-op when disabled', () => {
    const incoming = buildConfig({
      collections: [{ slug: 'pages', access: { read: allow }, fields: [] }],
    })
    expect(requireTwoFactor({ enabled: false })(incoming)).toBe(incoming)
  })

  it('warns when betterAuthOptions lacks the twoFactor plugin', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    requireTwoFactor({ betterAuthOptions: { plugins: [] } })(buildConfig({}))
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain('twoFactor()')

    warn.mockClear()
    requireTwoFactor({ betterAuthOptions: { plugins: [twoFactor()] } })(buildConfig({}))
    expect(warn).not.toHaveBeenCalled()
  })
})
