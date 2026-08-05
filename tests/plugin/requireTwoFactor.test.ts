import { describe, it, expect, vi, afterEach } from 'vitest'
import { applyRequireTwoFactorGate } from '../../src/plugin/requireTwoFactor.js'
import { createBetterAuthPlugin } from '../../src/plugin/index.js'
import type {
  Access,
  BasePayload,
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

function makePayload(overrides: {
  collections?: Partial<CollectionConfig>[]
  globals?: Partial<GlobalConfig>[]
}): BasePayload {
  return {
    config: {
      collections: (overrides.collections ?? []) as CollectionConfig[],
      globals: (overrides.globals ?? []) as GlobalConfig[],
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as BasePayload
}

function accessOf(payload: BasePayload, slug: string) {
  const collection = payload.config.collections.find((c) => c.slug === slug)
  expect(collection, `collection ${slug}`).toBeDefined()
  return (collection?.access ?? {}) as Record<string, Access>
}

describe('applyRequireTwoFactorGate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('denies a signed-in user without a second factor, passes one through with it', async () => {
    const payload = makePayload({
      collections: [{ slug: 'pages', access: { read: allow }, fields: [] }],
    })
    applyRequireTwoFactorGate(payload)
    const { read } = accessOf(payload, 'pages')

    expect(await read({ req: reqWith(notEnrolled) } as never)).toBe(false)
    expect(await read({ req: reqWith(enrolled) } as never)).toBe(true)
  })

  it('leaves anonymous requests to the original access control', async () => {
    const payload = makePayload({
      collections: [{ slug: 'pages', access: { read: () => true }, fields: [] }],
    })
    applyRequireTwoFactorGate(payload)

    // No user: the gate must not deny — the wrapped (public) access decides.
    expect(await accessOf(payload, 'pages').read({ req: reqWith(null) } as never)).toBe(true)
  })

  it('never gates the admin access key', () => {
    const admin = vi.fn(() => true)
    const payload = makePayload({
      collections: [{ slug: 'pages', access: { admin, read: allow }, fields: [] }],
    })
    applyRequireTwoFactorGate(payload)

    expect(accessOf(payload, 'pages').admin).toBe(admin)
  })

  it('skips Payload internal collections', () => {
    const read = vi.fn(() => true)
    const payload = makePayload({
      collections: [{ slug: 'payload-preferences', access: { read }, fields: [] }],
    })
    applyRequireTwoFactorGate(payload)

    expect(accessOf(payload, 'payload-preferences').read).toBe(read)
  })

  it('fails closed on operations with undefined access (default-equivalent when enrolled)', async () => {
    const payload = makePayload({ collections: [{ slug: 'pages', fields: [] }] })
    applyRequireTwoFactorGate(payload)
    const access = accessOf(payload, 'pages')

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
    const payload = makePayload({
      globals: [{ slug: 'header', access: { read: allow }, fields: [] }],
    })
    applyRequireTwoFactorGate(payload)
    const header = payload.config.globals.find((g) => g.slug === 'header')
    const read = header?.access?.read as Access

    expect(await read({ req: reqWith(notEnrolled) } as never)).toBe(false)
    expect(await read({ req: reqWith(enrolled) } as never)).toBe(true)
  })

  it('respects excludeCollections and excludeGlobals', async () => {
    const payload = makePayload({
      collections: [{ slug: 'open', access: { read: allow }, fields: [] }],
      globals: [{ slug: 'footer', access: { read: allow }, fields: [] }],
    })
    applyRequireTwoFactorGate(payload, {
      excludeCollections: ['open'],
      excludeGlobals: ['footer'],
    })

    expect(await accessOf(payload, 'open').read({ req: reqWith(notEnrolled) } as never)).toBe(true)
    const footer = payload.config.globals.find((g) => g.slug === 'footer')
    expect(await (footer?.access?.read as Access)({ req: reqWith(notEnrolled) } as never)).toBe(true)
  })

  it('exempts machine credentials by default, gates them when disabled', async () => {
    const apiKeyUser = { id: '3', twoFactorEnabled: false, apiKeyScopes: ['pages:read'] }
    const collections = () => [{ slug: 'pages', access: { read: allow }, fields: [] }]

    const defaultPayload = makePayload({ collections: collections() })
    applyRequireTwoFactorGate(defaultPayload)
    expect(
      await accessOf(defaultPayload, 'pages').read({ req: reqWith(apiKeyUser) } as never)
    ).toBe(true)

    const strictPayload = makePayload({ collections: collections() })
    applyRequireTwoFactorGate(strictPayload, { exemptMachineCredentials: false })
    expect(
      await accessOf(strictPayload, 'pages').read({ req: reqWith(apiKeyUser) } as never)
    ).toBe(false)
  })

  it('honors a custom exempt callback', async () => {
    const payload = makePayload({
      collections: [{ slug: 'pages', access: { read: allow }, fields: [] }],
    })
    applyRequireTwoFactorGate(payload, {
      exempt: (req) => (req.user as { id?: string } | null)?.id === '2',
    })

    expect(await accessOf(payload, 'pages').read({ req: reqWith(notEnrolled) } as never)).toBe(true)
  })

  it('supports a custom fieldName', async () => {
    const payload = makePayload({
      collections: [{ slug: 'pages', access: { read: allow }, fields: [] }],
    })
    applyRequireTwoFactorGate(payload, { fieldName: 'mfaEnrolled' })
    const { read } = accessOf(payload, 'pages')

    expect(await read({ req: reqWith({ id: '4', mfaEnrolled: true }) } as never)).toBe(true)
    expect(await read({ req: reqWith({ id: '5', mfaEnrolled: false }) } as never)).toBe(false)
  })
})

describe('createBetterAuthPlugin requireTwoFactor option', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const fakeAuth = (pluginIds: string[]) => ({
    options: { plugins: pluginIds.map((id) => ({ id })) },
    api: {},
    handler: async () => new Response(null),
  })

  /** Build the plugin config, then run onInit against a payload whose config is the built one. */
  async function initWithOption(
    requireTwoFactor: boolean | { enabled?: boolean },
    authPluginIds: string[] = ['two-factor']
  ) {
    const built = createBetterAuthPlugin({
      createAuth: () => fakeAuth(authPluginIds),
      requireTwoFactor: requireTwoFactor as never,
    })({
      collections: [
        { slug: 'pages', access: { read: allow }, fields: [] },
      ] as unknown as Config['collections'],
      globals: [] as unknown as Config['globals'],
    } as Config)

    const payload = {
      config: built,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as BasePayload

    await built.onInit?.(payload)
    return payload
  }

  it('applies the gate through onInit', async () => {
    const payload = await initWithOption(true)
    const { read } = accessOf(payload, 'pages')

    expect(await read({ req: reqWith(notEnrolled) } as never)).toBe(false)
    expect(await read({ req: reqWith(enrolled) } as never)).toBe(true)
  })

  it('does nothing when the option is absent or disabled', async () => {
    for (const option of [false, { enabled: false }] as const) {
      const payload = await initWithOption(option as never)
      expect(accessOf(payload, 'pages').read).toBe(allow)
    }
  })

  it('warns when the twoFactor plugin is missing from the auth instance', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await initWithOption(true, [])
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('twoFactor()'))).toBe(true)

    warn.mockClear()
    await initWithOption(true, ['two-factor'])
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('twoFactor()'))).toBe(false)
  })
})
