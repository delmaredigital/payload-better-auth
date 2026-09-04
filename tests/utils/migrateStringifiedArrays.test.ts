/**
 * The one-time data migration that pairs with the `supportsArrays` correction
 * (issue #34). Releases up to 0.11.3 wrote `'["a","b"]'` where an array belongs;
 * 0.12.0 stores arrays natively and does not translate on read, so those rows
 * are converted once rather than being reinterpreted forever.
 *
 * The Postgres cases matter most: drizzle's `PgJsonb.mapFromDriverValue` parses
 * any string it receives, and node-postgres has already parsed the jsonb, so a
 * stored jsonb *string* reaches the Local API as an array. 0.12.0 scanned that
 * laundered value and reported every database clean. The census now runs in SQL.
 */

import { describe, it, expect, vi } from 'vitest'
import { migrateStringifiedArrays } from '../../src/utils/migrateStringifiedArrays.js'
import { oauthProvider } from '@better-auth/oauth-provider'
import type { BetterAuthOptions } from 'better-auth'
import type { BasePayload } from 'payload'

const betterAuthOptions: BetterAuthOptions = {
  database: {} as never,
  baseURL: 'http://localhost:3000',
  secret: 'test-secret',
  advanced: { database: { generateId: 'serial' } },
  plugins: [oauthProvider({ loginPage: '/login' })],
}

type Doc = { id: number } & Record<string, unknown>

/**
 * Minimal Payload stand-in: only the surface the migration touches, with a
 * `collections` map so the "collection not generated" branch is reachable.
 */
function makePayload(store: Record<string, Doc[]>): BasePayload {
  return {
    db: { name: 'sqlite' },
    collections: Object.fromEntries(Object.keys(store).map((slug) => [slug, {}])),
    find: vi.fn(async ({ collection, limit = 100, page = 1 }) => {
      const docs = store[collection] ?? []
      const start = (page - 1) * limit
      const slice = docs.slice(start, start + limit)
      return { docs: slice, hasNextPage: start + limit < docs.length, totalDocs: docs.length }
    }),
    update: vi.fn(async ({ collection, id, data }) => {
      const doc = (store[collection] ?? []).find((d) => d.id === id)
      if (doc) Object.assign(doc, data)
      return doc
    }),
  } as unknown as BasePayload
}

describe('migrateStringifiedArrays', () => {
  it('converts a stringified array into a real array', async () => {
    const store = {
      oauthClients: [
        { id: 1, redirectUris: '["https://a.test/cb"]', scopes: '["openid","profile"]' },
      ],
    }
    const payload = makePayload(store)

    const results = await migrateStringifiedArrays({ payload, betterAuthOptions })

    expect(store.oauthClients[0].redirectUris).toEqual(['https://a.test/cb'])
    expect(store.oauthClients[0].scopes).toEqual(['openid', 'profile'])

    const redirect = results.find((r) => r.field === 'redirectUris')
    expect(redirect).toMatchObject({ collection: 'oauthClients', converted: 1, skipped: 0 })
  })

  it('leaves rows that already hold an array alone, so it is safe to re-run', async () => {
    const store = { oauthClients: [{ id: 1, redirectUris: ['https://a.test/cb'] }] }
    const payload = makePayload(store)

    const results = await migrateStringifiedArrays({ payload, betterAuthOptions })

    expect(payload.update).not.toHaveBeenCalled()
    expect(results.find((r) => r.field === 'redirectUris')?.converted).toBe(0)
    expect(store.oauthClients[0].redirectUris).toEqual(['https://a.test/cb'])
  })

  it('skips a string that does not parse to an array instead of guessing', async () => {
    const store = { oauthClients: [{ id: 1, redirectUris: 'https://a.test/cb' }] }
    const payload = makePayload(store)

    const results = await migrateStringifiedArrays({ payload, betterAuthOptions })

    expect(payload.update).not.toHaveBeenCalled()
    expect(results.find((r) => r.field === 'redirectUris')).toMatchObject({
      converted: 0,
      skipped: 1,
    })
    expect(store.oauthClients[0].redirectUris).toBe('https://a.test/cb')
  })

  it('reports without writing when dryRun is set', async () => {
    const store = { oauthClients: [{ id: 1, redirectUris: '["https://a.test/cb"]' }] }
    const payload = makePayload(store)

    const results = await migrateStringifiedArrays({
      payload,
      betterAuthOptions,
      dryRun: true,
    })

    expect(payload.update).not.toHaveBeenCalled()
    expect(results.find((r) => r.field === 'redirectUris')?.converted).toBe(1)
    expect(store.oauthClients[0].redirectUris).toBe('["https://a.test/cb"]')
  })

  it('pages through a collection larger than one batch', async () => {
    const store = {
      oauthClients: Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        redirectUris: `["https://a.test/${i}"]`,
      })),
    }
    const payload = makePayload(store)

    const results = await migrateStringifiedArrays({
      payload,
      betterAuthOptions,
      batchSize: 10,
    })

    expect(results.find((r) => r.field === 'redirectUris')).toMatchObject({
      scanned: 25,
      converted: 25,
    })
    expect(store.oauthClients[24].redirectUris).toEqual(['https://a.test/24'])
  })

  it('skips collections the consumer never generated', async () => {
    const payload = makePayload({})

    const results = await migrateStringifiedArrays({ payload, betterAuthOptions })

    expect(results).toEqual([])
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('finds nothing to do when no plugin contributes an array field', async () => {
    const payload = makePayload({ users: [{ id: 1, name: 'A' }], sessions: [] })

    const results = await migrateStringifiedArrays({
      payload,
      betterAuthOptions: { ...betterAuthOptions, plugins: [] },
    })

    expect(results).toEqual([])
  })
})

/**
 * A Payload stand-in wired like `@payloadcms/db-postgres`: the Local API launders
 * stored jsonb strings into arrays (the drizzle double-parse), while `db.execute`
 * reports what is genuinely stored. This is the exact discrepancy that made 0.12.0
 * a silent no-op.
 */
function makePostgresPayload(store: Record<string, Doc[]>, opts: { crippled?: boolean } = {}) {
  const execute = vi.fn(async ({ raw }: { raw?: string }) => {
    // Emulate `WHERE jsonb_typeof(col) = 'string'` plus `col #>> '{}'`.
    const m = /FROM "(\w+)" WHERE jsonb_typeof\("(\w+)"\)/.exec(raw ?? '')
    if (!m) return { rows: [] }
    const [, table, column] = m
    const slug = table === 'oauth_clients' ? 'oauthClients' : table
    const field = column === 'redirect_uris' ? 'redirectUris' : column
    const rows = (store[slug] ?? [])
      .filter((d) => typeof d[`__stored_${field}`] === 'string')
      .map((d) => ({ id: d.id, __raw: d[`__stored_${field}`] as string }))
    return { rows }
  })

  const payload = {
    db: {
      name: 'postgres',
      ...(opts.crippled
        ? {}
        : {
            drizzle: {},
            execute,
            tableNameMap: new Map([['oauth_clients', 'oauth_clients']]),
            tables: { oauth_clients: { redirectUris: { name: 'redirect_uris' } } },
          }),
    },
    collections: Object.fromEntries(Object.keys(store).map((slug) => [slug, {}])),
    count: vi.fn(async ({ collection }) => ({ totalDocs: (store[collection] ?? []).length })),
    // The laundering: whatever is stored, the Local API hands back an array.
    find: vi.fn(async ({ collection }) => ({ docs: store[collection] ?? [], hasNextPage: false })),
    update: vi.fn(async ({ collection, id, data }) => {
      const doc = (store[collection] ?? []).find((d) => d.id === id)
      if (doc) {
        Object.assign(doc, data)
        delete doc.__stored_redirectUris
      }
      return doc
    }),
  }
  return { payload: payload as unknown as BasePayload, execute }
}

describe('migrateStringifiedArrays on Postgres', () => {
  it('finds rows the Local API reports as clean (the 0.12.0 false negative)', async () => {
    // Stored as a jsonb *string*, but read back as an array — both shapes look
    // identical to payload.find(), which is why 0.12.0 converted nothing.
    const store = {
      oauthClients: [
        {
          id: 1,
          redirectUris: ['https://a.test/cb'],
          __stored_redirectUris: '["https://a.test/cb"]',
        },
      ],
    }
    const { payload } = makePostgresPayload(store)

    const results = await migrateStringifiedArrays({ payload, betterAuthOptions })
    const redirect = results.find((r) => r.field === 'redirectUris')

    expect(redirect).toMatchObject({ converted: 1, observedVia: 'stored-shape' })
    expect(payload.update).toHaveBeenCalled()
    expect(store.oauthClients[0].redirectUris).toEqual(['https://a.test/cb'])
    expect(store.oauthClients[0].__stored_redirectUris).toBeUndefined()
  })

  it('censuses stored shape rather than the value Payload returns', async () => {
    const store = { oauthClients: [{ id: 1, redirectUris: ['https://a.test/cb'] }] }
    const { payload, execute } = makePostgresPayload(store)

    const results = await migrateStringifiedArrays({ payload, betterAuthOptions })

    expect(execute).toHaveBeenCalled()
    expect(execute.mock.calls[0][0].raw).toContain("jsonb_typeof")
    expect(results.find((r) => r.field === 'redirectUris')).toMatchObject({
      converted: 0,
      observedVia: 'stored-shape',
    })
  })

  it('throws rather than reporting clean when it cannot see the stored shape', async () => {
    const { payload } = makePostgresPayload(
      { oauthClients: [{ id: 1, redirectUris: ['https://a.test/cb'] }] },
      { crippled: true }
    )

    await expect(migrateStringifiedArrays({ payload, betterAuthOptions })).rejects.toThrow(
      /cannot inspect stored shape on Postgres/
    )
  })

  it('marks the observation method so a zero is interpretable', async () => {
    const { payload } = makePostgresPayload({ oauthClients: [] })
    const pg = await migrateStringifiedArrays({ payload, betterAuthOptions })
    expect(pg.every((r) => r.observedVia === 'stored-shape')).toBe(true)

    const sqlite = await migrateStringifiedArrays({
      payload: makePayload({ oauthClients: [] }),
      betterAuthOptions,
    })
    expect(sqlite.every((r) => r.observedVia === 'local-api')).toBe(true)
  })
})
