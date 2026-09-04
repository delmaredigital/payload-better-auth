/**
 * The one-time data migration that pairs with the `supportsArrays` correction
 * (issue #34). Releases up to 0.11.3 wrote `'["a","b"]'` where an array belongs;
 * 0.12.0 stores arrays natively and does not translate on read, so those rows
 * are converted once rather than being reinterpreted forever.
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
