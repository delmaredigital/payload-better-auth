/**
 * Better Auth 1.7 split `supportsArrays` out of `supportsJSON`. Reporting
 * `supportsArrays: false` makes the factory JSON.stringify every
 * `string[]`/`number[]` value on the way into Payload, which Payload rejects
 * ("data must be array") whenever the target field validates its shape.
 *
 * Payload's `json` field stores arrays natively, so the adapter reports
 * `supportsArrays: true` and keeps a read-side shim for rows written by earlier
 * releases, which still hold a JSON string where an array belongs. (Issue #34)
 */

import { describe, it, expect } from 'vitest'
import { payloadAdapter } from '../../src/adapter/index.js'
import { betterAuthCollections } from '../../src/adapter/collections.js'
import { createMockPayload, type MockDocument } from './mocks.js'
import { oauthProvider } from '@better-auth/oauth-provider'
import type { BetterAuthOptions } from 'better-auth'
import type { Config, CollectionConfig } from 'payload'

const betterAuthOptions: BetterAuthOptions = {
  database: {} as never,
  baseURL: 'http://localhost:3000',
  secret: 'test-secret',
  advanced: { database: { generateId: 'serial' } },
  user: {
    additionalFields: {
      roles: { type: 'string[]', required: false },
      scores: { type: 'number[]', required: false },
    },
  },
}

function makeAdapter(documents: Record<string, MockDocument[]> = {}) {
  const payload = createMockPayload({ documents })
  const adapter = payloadAdapter({ payloadClient: payload })(betterAuthOptions)
  return { payload, adapter }
}

describe('array fields on the write path', () => {
  it('hands Payload a real array on create, not a JSON string', async () => {
    const { payload, adapter } = makeAdapter({ users: [] })

    await adapter.create({
      model: 'user',
      data: { email: 'a@example.com', name: 'A', roles: ['wst'], scores: [1, 2] },
    })

    const { data } = (payload.create as unknown as { mock: { calls: [{ data: Record<string, unknown> }][] } })
      .mock.calls[0][0]

    expect(data.roles).toEqual(['wst'])
    expect(data.scores).toEqual([1, 2])
  })

  it('hands Payload a real array on update too', async () => {
    const { payload, adapter } = makeAdapter({
      users: [{ id: 1, email: 'a@example.com', name: 'A', roles: [] }],
    })

    await adapter.update({
      model: 'user',
      where: [{ field: 'id', value: '1', operator: 'eq' }],
      update: { roles: ['admin', 'editor'] },
    })

    const { data } = (payload.update as unknown as { mock: { calls: [{ data: Record<string, unknown> }][] } })
      .mock.calls[0][0]

    expect(data.roles).toEqual(['admin', 'editor'])
  })

  it('leaves an empty array as an array', async () => {
    const { payload, adapter } = makeAdapter({ users: [] })

    await adapter.create({
      model: 'user',
      data: { email: 'b@example.com', name: 'B', roles: [] },
    })

    const { data } = (payload.create as unknown as { mock: { calls: [{ data: Record<string, unknown> }][] } })
      .mock.calls[0][0]

    expect(data.roles).toEqual([])
  })
})

describe('array fields on the read path', () => {
  it('returns arrays stored natively', async () => {
    const { adapter } = makeAdapter({
      users: [{ id: 1, email: 'a@example.com', name: 'A', roles: ['wst'], scores: [1, 2] }],
    })

    const user = await adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'id', value: '1', operator: 'eq' }],
    })

    expect(user?.roles).toEqual(['wst'])
    expect(user?.scores).toEqual([1, 2])
  })

  it('parses rows written by releases that stringified arrays', async () => {
    const { adapter } = makeAdapter({
      users: [{ id: 1, email: 'a@example.com', name: 'A', roles: '["wst"]', scores: '[1,2]' }],
    })

    const user = await adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'id', value: '1', operator: 'eq' }],
    })

    expect(user?.roles).toEqual(['wst'])
    expect(user?.scores).toEqual([1, 2])
  })

  it('leaves a string that is not a serialized array alone rather than nulling it', async () => {
    const { adapter } = makeAdapter({
      users: [{ id: 1, email: 'a@example.com', name: 'A', roles: 'not json' }],
    })

    const user = await adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'id', value: '1', operator: 'eq' }],
    })

    expect(user?.roles).toBe('not json')
  })

  it('does not touch a plain string field that happens to hold JSON', async () => {
    const { adapter } = makeAdapter({
      users: [{ id: 1, email: 'a@example.com', name: '["not","an","array"]' }],
    })

    const user = await adapter.findOne<Record<string, unknown>>({
      model: 'user',
      where: [{ field: 'id', value: '1', operator: 'eq' }],
    })

    expect(user?.name).toBe('["not","an","array"]')
  })
})

describe('generated collections for array fields', () => {
  function build(options: Parameters<typeof betterAuthCollections>[0]): CollectionConfig[] {
    const config = betterAuthCollections(options)({ collections: [] } as unknown as Config) as Config
    return (config.collections ?? []) as CollectionConfig[]
  }

  function fieldOf(collections: CollectionConfig[], slug: string, name: string) {
    const collection = collections.find((c) => c.slug === slug)
    return (collection?.fields ?? []).find((f) => 'name' in f && f.name === name) as
      | { name: string; type: string }
      | undefined
  }

  it("maps the oauth client's string[] fields to json, the only Payload type that stores arrays", () => {
    const collections = build({
      betterAuthOptions: { ...betterAuthOptions, plugins: [oauthProvider({ loginPage: '/login' })] },
    })

    expect(fieldOf(collections, 'oauthClients', 'redirectUris')?.type).toBe('json')
    expect(fieldOf(collections, 'oauthClients', 'scopes')?.type).toBe('json')
    expect(fieldOf(collections, 'oauthClients', 'grantTypes')?.type).toBe('json')
  })

  it('maps number[] to json as well — it fell through to text before #34', () => {
    const collections = build({
      betterAuthOptions,
      skipCollections: [],
    })

    expect(fieldOf(collections, 'users', 'scores')?.type).toBe('json')
    expect(fieldOf(collections, 'users', 'roles')?.type).toBe('json')
  })
})
