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
function makePostgresPayload(
  store: Record<string, Doc[]>,
  opts: { crippled?: boolean; columns?: Record<string, string> } = {}
) {
  const columns = opts.columns ?? { redirectUris: 'redirect_uris' }
  const fieldByColumn = Object.fromEntries(Object.entries(columns).map(([f, c]) => [c, f]))
  const execute = vi.fn(async ({ raw }: { raw?: string }) => {
    const q = raw ?? ''
    const table = /FROM "(\w+)"/.exec(q)?.[1]
    if (!table) return { rows: [] }
    const slug = table === 'oauth_clients' ? 'oauthClients' : table

    // Projection aliases: CASE WHEN jsonb_typeof("col") = 'string' … AS "cN"
    const cols = [...q.matchAll(/jsonb_typeof\("(\w+)"\) = 'string' THEN "\w+" #>> '\{\}' END AS "(c\d+)"/g)]
      .map(([, column, alias]) => ({ alias, field: fieldByColumn[column] ?? column }))

    const cursor = /AND "id" > (\d+)/.exec(q)?.[1]
    const limit = Number(/LIMIT (\d+)/.exec(q)?.[1] ?? '100')

    // Emulate `jsonb_typeof(col) = 'string'` against the *stored* shape.
    const matching = (store[slug] ?? [])
      .filter((d) => cols.some((c) => typeof d[`__stored_${c.field}`] === 'string'))
      .filter((d) => (cursor === undefined ? true : Number(d.id) > Number(cursor)))
      .sort((a, b) => Number(a.id) - Number(b.id))
      .slice(0, limit)

    return {
      rows: matching.map((d) => {
        const row: Record<string, unknown> = { id: d.id }
        for (const c of cols) row[c.alias] = d[`__stored_${c.field}`] ?? null
        return row
      }),
    }
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
            tables: {
              oauth_clients: Object.fromEntries(
                Object.entries(columns).map(([field, name]) => [field, { name }])
              ),
            },
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
        for (const field of Object.keys(data)) delete doc[`__stored_${field}`]
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

describe('migrateStringifiedArrays paging on Postgres', () => {
  it('pages rather than materializing the whole table', async () => {
    // Worst case for a pre-0.12 database: every row stringified.
    const store = {
      oauthClients: Array.from({ length: 250 }, (_, i) => ({
        id: i + 1,
        redirectUris: [`https://a.test/${i}`],
        __stored_redirectUris: `["https://a.test/${i}"]`,
      })),
    }
    const { payload, execute } = makePostgresPayload(store)

    const results = await migrateStringifiedArrays({
      payload,
      betterAuthOptions,
      batchSize: 50,
    })

    expect(results.find((r) => r.field === 'redirectUris')?.converted).toBe(250)
    // 250 rows at 50 per page: 5 full pages plus a short one that ends the loop.
    expect(execute.mock.calls.length).toBe(6)
    for (const [{ raw }] of execute.mock.calls) expect(raw).toContain('LIMIT 50')
    expect(store.oauthClients[249].redirectUris).toEqual(['https://a.test/249'])
  })

  it('advances by keyset, not offset — a converted row leaves the result set', async () => {
    const store = {
      oauthClients: Array.from({ length: 6 }, (_, i) => ({
        id: i + 1,
        redirectUris: [`https://a.test/${i}`],
        __stored_redirectUris: `["https://a.test/${i}"]`,
      })),
    }
    const { payload, execute } = makePostgresPayload(store)

    await migrateStringifiedArrays({ payload, betterAuthOptions, batchSize: 2 })

    // Every row converted: an OFFSET walk would have skipped half of them.
    expect(store.oauthClients.every((d) => Array.isArray(d.redirectUris))).toBe(true)
    expect(store.oauthClients.every((d) => d.__stored_redirectUris === undefined)).toBe(true)
    const cursored = execute.mock.calls.filter(([{ raw }]) => /AND "id" > \d+/.test(raw ?? ''))
    expect(cursored.length).toBeGreaterThan(0)
    expect(execute.mock.calls.some(([{ raw }]) => /OFFSET/.test(raw ?? ''))).toBe(false)
  })

  it('does not loop forever when a row is skipped and stays matching', async () => {
    const store = {
      oauthClients: [
        { id: 1, redirectUris: [], __stored_redirectUris: 'not json' },
        { id: 2, redirectUris: [], __stored_redirectUris: '["https://a.test/cb"]' },
      ],
    }
    const { payload } = makePostgresPayload(store)

    const results = await migrateStringifiedArrays({
      payload,
      betterAuthOptions,
      batchSize: 1,
    })

    expect(results.find((r) => r.field === 'redirectUris')).toMatchObject({
      converted: 1,
      skipped: 1,
    })
  })

  it('censuses every array column of a table in one scan, not one per field', async () => {
    const store = {
      oauthClients: [
        {
          id: 1,
          __stored_redirectUris: '["https://a.test/cb"]',
          __stored_scopes: '["openid"]',
          __stored_grant_types: '["authorization_code"]',
        },
      ],
    }
    const { payload, execute } = makePostgresPayload(store, {
      columns: {
        redirectUris: 'redirect_uris',
        scopes: 'scopes',
        grantTypes: 'grant_types',
      },
    })

    await migrateStringifiedArrays({ payload, betterAuthOptions })

    // oauthClients carries seven string[] columns; they share a single scan.
    expect(execute.mock.calls.length).toBe(1)
    expect(execute.mock.calls[0][0].raw).toContain('"redirect_uris"')
    expect(execute.mock.calls[0][0].raw).toContain('"scopes"')
  })

  it('writes one update per row, not one per converted field', async () => {
    const store = {
      oauthClients: [
        {
          id: 1,
          __stored_redirectUris: '["https://a.test/cb"]',
          __stored_scopes: '["openid"]',
        },
      ],
    }
    const { payload } = makePostgresPayload(store, {
      columns: { redirectUris: 'redirect_uris', scopes: 'scopes' },
    })

    await migrateStringifiedArrays({ payload, betterAuthOptions })

    expect((payload.update as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1)
    const { data } = (payload.update as unknown as {
      mock: { calls: [{ data: Record<string, unknown> }][] }
    }).mock.calls[0][0]
    expect(data).toEqual({ redirectUris: ['https://a.test/cb'], scopes: ['openid'] })
  })
})
