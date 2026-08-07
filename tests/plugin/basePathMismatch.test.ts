import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Config } from 'payload'
import { createBetterAuthPlugin, type BetterAuthPluginOptions } from '../../src/plugin/index.js'

// Issue: with a non-default `routes.api`, the plugin mounts endpoints at
// `<routes.api><authBasePath>` while Better Auth's router 404s anything outside
// its own `basePath` (default '/api/auth'). The plugin can't set `basePath`
// (createAuth is consumer-supplied), so it must (a) expose the mount segment to
// components and (b) loudly flag the mismatch at init.

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    collections: [],
    routes: { api: '/api', admin: '/admin' },
    ...overrides,
  } as unknown as Config
}

function makeAuth(basePath?: string) {
  return {
    options: basePath ? { basePath } : {},
    api: {},
    handler: async () => new Response(null),
  }
}

async function initPlugin(
  pluginOptions: Partial<BetterAuthPluginOptions> & { basePath?: string },
  configOverrides: Partial<Config> = {}
) {
  const { basePath, ...rest } = pluginOptions
  const plugin = createBetterAuthPlugin({
    createAuth: () => makeAuth(basePath),
    ...rest,
  })
  const config = plugin(makeConfig(configOverrides))
  const payload = { config } as never
  await config.onInit?.(payload)
  return config
}

describe('authBasePath exposure on the config', () => {
  it('stores authBasePath in both custom and admin.custom (client-visible)', () => {
    const plugin = createBetterAuthPlugin({ createAuth: () => makeAuth() })
    const config = plugin(makeConfig())
    expect((config.custom?.betterAuth as { authBasePath?: string }).authBasePath).toBe('/auth')
    expect(
      (config.admin?.custom?.betterAuth as { authBasePath?: string }).authBasePath
    ).toBe('/auth')
  })

  it('respects a custom authBasePath option', () => {
    const plugin = createBetterAuthPlugin({
      createAuth: () => makeAuth(),
      authBasePath: '/better-auth',
    })
    const config = plugin(makeConfig())
    expect((config.custom?.betterAuth as { authBasePath?: string }).authBasePath).toBe(
      '/better-auth'
    )
  })

  it('preserves existing custom keys', () => {
    const plugin = createBetterAuthPlugin({ createAuth: () => makeAuth() })
    const config = plugin(
      makeConfig({
        custom: { other: 1, betterAuth: { existing: true } },
        admin: { custom: { theirs: 2 } },
      } as unknown as Partial<Config>)
    )
    expect(config.custom?.other).toBe(1)
    expect((config.custom?.betterAuth as { existing?: boolean }).existing).toBe(true)
    expect(config.admin?.custom?.theirs).toBe(2)
  })
})

describe('basePath mismatch validation at init', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('logs an error naming the expected basePath when routes.api is non-default', async () => {
    await initPlugin({}, { routes: { api: '/api/payload', admin: '/admin' } })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const message = String(errorSpy.mock.calls[0][0])
    expect(message).toContain('basePath mismatch')
    expect(message).toContain("basePath: '/api/payload/auth'")
  })

  it('is silent with the default routes.api and default basePath', async () => {
    await initPlugin({})
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('is silent when the consumer set the matching basePath', async () => {
    await initPlugin(
      { basePath: '/api/payload/auth' },
      { routes: { api: '/api/payload', admin: '/admin' } }
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('tolerates a trailing slash on the configured basePath', async () => {
    await initPlugin(
      { basePath: '/api/payload/auth/' },
      { routes: { api: '/api/payload', admin: '/admin' } }
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('accounts for a custom authBasePath', async () => {
    await initPlugin({ authBasePath: '/better-auth' })
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0][0])).toContain("basePath: '/api/better-auth'")
  })

  it('skips validation when autoRegisterEndpoints is false (consumer owns the mount)', async () => {
    await initPlugin(
      { autoRegisterEndpoints: false },
      { routes: { api: '/api/payload', admin: '/admin' } }
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
