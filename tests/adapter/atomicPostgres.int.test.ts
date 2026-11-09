/**
 * Opt in with ATOMIC_PG_URL=postgres://postgres@localhost:55441/atomic_test
 * pnpm vitest run tests/adapter/atomicPostgres.int.test.ts
 * Uses a fresh schema, a real connection pool, real Payload sanitization/schema
 * push, and Better Auth's initialized adapter. No database calls are mocked.
 */
import { randomUUID } from 'node:crypto'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { oauthProvider } from '@better-auth/oauth-provider'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { buildConfig, getPayload, type BasePayload } from 'payload'
import { jwt, twoFactor } from 'better-auth/plugins'
import { symmetricEncrypt } from 'better-auth/crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { betterAuthCollections } from '../../src/adapter/collections.js'
import { payloadAdapter, type PayloadAdapterConfig } from '../../src/adapter/index.js'
import { createPostgresAtomic } from '../../src/adapter/atomic-postgres.js'

const pgURL = process.env.ATOMIC_PG_URL

describe.skipIf(!process.env.ATOMIC_PG_URL).each(['uuid', 'serial'] as const)('atomic writes against real Postgres (%s IDs)', (idType) => {
  const schemaName = `atomic_${randomUUID().replaceAll('-', '')}`
  let payload: BasePayload | undefined
  let adapter: Awaited<ReturnType<typeof initAdapter>>
  let local: Awaited<ReturnType<typeof initAdapter>>
  let userId: string
  let auth: ReturnType<typeof createAuth>
  const expiresAt = new Date('2099-01-01T00:00:00.000Z')
  const authOptions = {
    baseURL: 'http://localhost:3000',
    secret: 'atomic-integration-test-secret-at-least-32-characters',
    advanced: { database: { generateId: idType } },
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    session: { additionalFields: { count: { type: 'number', defaultValue: 0 } } },
    plugins: [jwt(), oauthProvider({ loginPage: '/login', consentPage: '/consent' }), twoFactor({
      accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
    })],
  } satisfies BetterAuthOptions

  function createAuth(atomicWrites?: NonNullable<PayloadAdapterConfig['adapterConfig']>['atomicWrites']) {
    return betterAuth({
      ...authOptions,
      database: payloadAdapter({ payloadClient: payload!, adapterConfig: { atomicWrites, enableDebugLogs: true } }),
    })
  }

  async function initAdapter(atomicWrites?: NonNullable<PayloadAdapterConfig['adapterConfig']>['atomicWrites']) {
    return (await createAuth(atomicWrites).$context).adapter
  }

  async function createCounter(count = 0) {
    return adapter.create<Record<string, unknown> & { id: string }>({ model: 'session', data: {
      userId, token: randomUUID(), expiresAt, count,
    } })
  }

  beforeAll(async () => {
    const config = await buildConfig({
      secret: 'atomic-payload-integration-secret',
      telemetry: false,
      admin: { user: 'admins', disable: true, importMap: { autoGenerate: false } },
      typescript: { autoGenerate: false },
      db: postgresAdapter({
        pool: { connectionString: pgURL, max: 25 },
        ...(idType === 'uuid' ? { idType: 'uuid' } : {}), schemaName, push: true,
      }),
      collections: [{ slug: 'admins', auth: true, fields: [] }],
      plugins: [betterAuthCollections({
        betterAuthOptions: authOptions, skipCollections: [], firstUserAdmin: false,
        acknowledgeRoleGuardDisabled: true,
      })],
    })
    payload = await getPayload({ config, key: schemaName, disableDBConnect: true })
    // Own the pool so teardown can close it. Payload 3.92's automatic connect
    // reserves an unreleased startup client; supplying its public pool avoids it.
    payload.db.pool = new payload.db.pg!.Pool(payload.db.poolOptions)
    await payload.db.connect!()
    auth = createAuth() // Leave the atomic policy at its default ('auto').
    adapter = (await auth.$context).adapter
    local = await initAdapter('never')
    const user = await adapter.create<{ id: string }>({ model: 'user', data: {
      name: 'Atomic test', email: `${randomUUID()}@example.test`, emailVerified: true,
    } })
    userId = user.id
  }, 120_000)

  afterEach(() => vi.restoreAllMocks())
  afterAll(async () => {
    if (!payload) return
    const pool = payload.db.pool
    try {
      // schemaName contains only our fixed prefix and a generated hex UUID.
      await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    } finally {
      await payload.destroy()
      await pool.end()
    }
  }, 30_000)

  it('accumulates 20 parallel increments exactly under default auto', async () => {
    const row = await createCounter()
    const find = vi.spyOn(payload!, 'find')
    const findByID = vi.spyOn(payload!, 'findByID')
    const update = vi.spyOn(payload!, 'update')
    const results = await Promise.all(Array.from({ length: 20 }, () => adapter.incrementOne({
      model: 'session', where: [{ field: 'id', value: row.id }], increment: { count: 1 },
    })))
    expect(results.filter(Boolean)).toHaveLength(20)
    expect(find).not.toHaveBeenCalled()
    expect(findByID).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(await local.findOne({ model: 'session', where: [{ field: 'id', value: row.id }] })).toMatchObject({ count: 20 })
  })

  it('allows exactly one of 10 parallel consumers to remove a single-use verification', async () => {
    const row = await adapter.create<{ id: string }>({ model: 'verification', data: {
      identifier: randomUUID(), value: 'single-use', expiresAt,
    } })
    const remove = vi.spyOn(payload!, 'delete')
    const results = await Promise.all(Array.from({ length: 10 }, () => adapter.consumeOne({
      model: 'verification', where: [{ field: 'id', value: row.id }],
    })))
    expect(results.filter(result => result !== null)).toHaveLength(1)
    expect(results.filter(result => result === null)).toHaveLength(9)
    expect(remove).not.toHaveBeenCalled()
    expect(await local.findOne({ model: 'verification', where: [{ field: 'id', value: row.id }] })).toBeNull()
  })

  it('returns null without a write for a guard miss', async () => {
    const row = await createCounter(3)
    expect(await adapter.incrementOne({ model: 'session', where: [
      { field: 'id', value: row.id }, { field: 'count', operator: 'lt', value: 3 },
    ], increment: { count: 1 } })).toBeNull()
    expect(await local.findOne({ model: 'session', where: [{ field: 'id', value: row.id }] })).toEqual(row)
  })

  it('uses atomic auto on real oauthRefreshTokens despite the sanitized unique token hook', async () => {
    const tokenField = payload!.collections.oauthRefreshTokens.config.flattenedFields.find(field => field.name === 'token')!
    expect('hooks' in tokenField && tokenField.hooks?.beforeDuplicate?.length).toBeGreaterThan(0)
    const clientId = randomUUID()
    await adapter.create({ model: 'oauthClient', data: { clientId, redirectUris: ['http://localhost/callback'] } })
    const row = await adapter.create<{ id: string }>({ model: 'oauthRefreshToken', data: {
      token: randomUUID(), clientId, userId, expiresAt, scopes: ['openid'], revoked: null,
    } })
    const update = vi.spyOn(payload!, 'update')
    const revoked = new Date()
    const results = await Promise.all(Array.from({ length: 10 }, () => adapter.incrementOne({
      model: 'oauthRefreshToken', where: [{ field: 'id', value: row.id }, { field: 'revoked', value: null }],
      increment: {}, set: { revoked },
    })))
    expect(results.filter(result => result !== null)).toHaveLength(1)
    expect(results.filter(result => result === null)).toHaveLength(9)
    expect(update).not.toHaveBeenCalled()
    expect(await local.findOne({ model: 'oauthRefreshToken', where: [{ field: 'id', value: row.id }] })).toMatchObject({ revoked })
  })

  it('switches the same counter to the Local API in never mode', async () => {
    const row = await createCounter()
    const update = vi.spyOn(payload!, 'update')
    expect(await adapter.incrementOne({ model: 'session', where: [{ field: 'id', value: row.id }], increment: { count: 1 } })).toMatchObject({ count: 1 })
    expect(update).not.toHaveBeenCalled()
    expect(await local.incrementOne({ model: 'session', where: [{ field: 'id', value: row.id }], increment: { count: 1 } })).toMatchObject({ count: 2 })
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('returns null for malformed primary/relationship IDs without writes or Local API fallback', async () => {
    const row = await createCounter(3)
    const update = vi.spyOn(payload!, 'update')
    const remove = vi.spyOn(payload!, 'delete')
    for (const field of ['id', 'userId']) {
      const where = [{ field, value: 'not-an-id' }]
      expect(await adapter.incrementOne({ model: 'session', where, increment: { count: 1 } })).toBeNull()
      expect(await adapter.consumeOne({ model: 'session', where })).toBeNull()
    }
    expect(update).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(await local.findOne({ model: 'session', where: [{ field: 'id', value: row.id }] })).toEqual(row)
  })

  it('locks an account for 900 seconds after 10 parallel wrong TOTP codes through Better Auth', async () => {
    const email = `${randomUUID()}@example.test`
    const password = 'Atomic-integration-password-123!'
    const signup = await auth.api.signUpEmail({ body: { email, password, name: 'TOTP lockout' } })
    const context = await auth.$context
    const factor = await adapter.create<{ id: string }>({ model: 'twoFactor', data: {
      userId: signup.user.id, verified: true,
      secret: await symmetricEncrypt({ key: context.secretConfig, data: 'atomic-totp-test-secret-32-characters' }),
      backupCodes: '[]', failedVerificationCount: 0, lockedUntil: null,
    } })
    await adapter.update({ model: 'user', where: [{ field: 'id', value: signup.user.id }], update: { twoFactorEnabled: true } })
    // Each login gets its own challenge/attempt token. Sharing a challenge would
    // test challenge consumption (only one winner), not the account counter.
    const challenges = await Promise.all(Array.from({ length: 10 }, async () => {
      const response = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true })
      expect(response.response).toMatchObject({ twoFactorRedirect: true })
      return new Headers({ cookie: response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ') })
    }))
    const update = vi.spyOn(payload!, 'update')
    const start = Date.now()
    const failures = await Promise.all(challenges.map(headers => auth.api.verifyTOTP({
      // Seven digits cannot match a six-digit TOTP; the endpoint accepts a string.
      headers, body: { code: '0000000' }, asResponse: true,
    })))
    for (const response of failures) {
      expect(response.status).toBe(401)
      expect(await response.json()).toMatchObject({ code: 'INVALID_CODE' })
    }
    expect(update).not.toHaveBeenCalled()
    const stored = await payload!.findByID({ collection: 'twoFactors', id: factor.id, depth: 0, overrideAccess: true })
    expect(stored.failedVerificationCount).toBe(10)
    const lockedUntil = new Date(stored.lockedUntil as string).getTime()
    expect(lockedUntil).toBeGreaterThanOrEqual(start + 900_000)
    expect(lockedUntil).toBeLessThanOrEqual(Date.now() + 900_000)
    const locked = await auth.api.verifyTOTP({ headers: challenges[0], body: { code: '0000000' }, asResponse: true })
    expect(locked.status).toBe(429)
    expect(await locked.json()).toMatchObject({ code: 'ACCOUNT_TEMPORARILY_LOCKED' })
  }, 60_000)

  it('returns the same dates, relationship ids, numbers and keys as Local API reads', async () => {
    const row = await createCounter()
    const atomic = createPostgresAtomic()
    const returned = await atomic({ payload: payload!, collection: 'sessions',
      where: [{ field: 'id', value: row.id }], increment: { count: 1 } })
    const found = await payload!.findByID({ collection: 'sessions', id: row.id, depth: 0, overrideAccess: true })
    expect(returned).toEqual(found)
    expect(returned).toMatchObject({ count: 1, user: idType === 'serial' ? Number(userId) : userId, expiresAt: expiresAt.toISOString() })
    expect(typeof returned!.createdAt).toBe('string')
    expect(typeof returned!.updatedAt).toBe('string')
    const transformed = await adapter.incrementOne({ model: 'session', where: [{ field: 'id', value: row.id }], increment: { count: 1 } })
    expect(transformed).toEqual(await local.findOne({ model: 'session', where: [{ field: 'id', value: row.id }] }))
    expect(transformed).toMatchObject({ count: 2, userId, expiresAt })
  })
})
