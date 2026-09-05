import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Config, Endpoint, PayloadRequest } from 'payload'
import { createBetterAuthPlugin } from '../../src/plugin/index.js'

/**
 * The plugin's api-key endpoints (`/api-key/list|create|update|delete`) check the
 * caller's session before doing anything. That check is read-only authorization:
 * the Response the client receives comes from Better Auth's own handler (or from
 * handleApiKeyCreate's JSON body), never from the guard, so any Set-Cookie Better
 * Auth attaches to the guard's getSession() is dropped on the floor. The guard
 * must therefore not refresh the session — otherwise the database expiry moves
 * while the browser's cookie does not. Better Auth's downstream handler runs its
 * own getSessionFromCtx and refreshes with cookies that DO reach the client.
 */

function makeConfig(): Config {
  return {
    collections: [{ slug: 'users', auth: { disableLocalStrategy: true }, fields: [] }],
    routes: { api: '/api', admin: '/admin' },
  } as unknown as Config
}

async function setup(getSession: ReturnType<typeof vi.fn>) {
  const createApiKey = vi.fn(async () => ({
    id: 'k1',
    key: 'sk_test_value',
    name: 'ci',
    userId: 'u1',
    expiresAt: null,
    createdAt: new Date(),
    metadata: null,
  }))
  const handler = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
  const auth = {
    options: { baseURL: 'https://example.com' },
    api: { getSession, createApiKey },
    handler,
  }
  const plugin = createBetterAuthPlugin({ createAuth: () => auth })
  const config = plugin(makeConfig())
  const payload = {
    config,
    findByID: vi.fn(async () => ({ id: 'u1', role: 'admin' })),
  } as Record<string, unknown>
  await config.onInit?.(payload as never)
  return { config, payload, createApiKey, handler }
}

function authEndpoint(config: Config, method: Endpoint['method']): Endpoint {
  const ep = (config.endpoints ?? []).find((e) => e.method === method && e.path.startsWith('/auth'))
  if (!ep) throw new Error(`no ${method} auth endpoint registered`)
  return ep
}

function request(
  payload: unknown,
  method: string,
  pathname: string,
  data?: Record<string, unknown>
): PayloadRequest {
  return {
    method,
    pathname,
    url: `https://example.com${pathname}`,
    headers: new Headers({ cookie: 'better-auth.session_token=abc', host: 'example.com' }),
    payload,
    data,
  } as unknown as PayloadRequest
}

const session = () => vi.fn(async () => ({ user: { id: 'u1' }, session: { id: 's1', userId: 'u1' } }))

describe('api-key endpoint guard — session reads are refresh-free', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('the list guard reads the session with disableRefresh and then forwards to Better Auth', async () => {
    const getSession = session()
    const { config, payload, handler } = await setup(getSession)

    const res = await authEndpoint(config, 'get').handler(
      request(payload, 'GET', '/api/auth/api-key/list')
    )

    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(getSession).toHaveBeenCalledTimes(1)
    expect(getSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableRefresh: true } })
    )
  })

  it('every session read on the create path is refresh-free (guard and handleApiKeyCreate)', async () => {
    const getSession = session()
    const { config, payload, createApiKey } = await setup(getSession)

    const res = await authEndpoint(config, 'post').handler(
      request(payload, 'POST', '/api/auth/api-key/create', { name: 'ci' })
    )

    expect(res.status).toBe(200)
    expect(createApiKey).toHaveBeenCalledTimes(1)
    expect(getSession.mock.calls.length).toBeGreaterThan(0)
    for (const [args] of getSession.mock.calls) {
      expect(args).toMatchObject({ query: { disableRefresh: true } })
    }
  })

  it('still rejects an unauthenticated caller before anything reaches Better Auth', async () => {
    const getSession = vi.fn(async () => null)
    const { config, payload, handler, createApiKey } = await setup(getSession)

    const res = await authEndpoint(config, 'get').handler(
      request(payload, 'GET', '/api/auth/api-key/list')
    )

    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    expect(createApiKey).not.toHaveBeenCalled()
  })
})
