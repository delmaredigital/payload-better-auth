import * as orm from 'drizzle-orm'
import { pgTable, uuid, numeric, text, timestamp, boolean, integer, PgDialect } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildConfig, type BasePayload } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BetterAuthOptions } from 'better-auth'
import * as mod from '../../src/adapter/atomic-postgres.js'
import { payloadAdapter, type PayloadAdapterConfig } from '../../src/adapter/index.js'
import { createMockPayload } from './mocks.js'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const table = pgTable('custom_auth_counters', {
  id: uuid('id'), count: numeric('failed_verification_count', { mode: 'number' }),
  label: text('display_label'), user: uuid('user_id'), lockedUntil: timestamp('locked_until', { mode: 'string', withTimezone: true }),
  enabled: boolean('enabled'), updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }),
})
const fields = Object.fromEntries([
  ['count', 'number'], ['label', 'text'], ['user', 'relationship'], ['lockedUntil', 'date'], ['enabled', 'checkbox'], ['updatedAt', 'date'],
].map(([name, type]) => [name, { name, type }]))
const livePostgres = postgresAdapter({ pool: {}, push: false }).init({ payload: {} as BasePayload })
type Clause = { field: string; value: unknown; operator?: string; connector?: string; mode?: string }
const translate = (where: Clause[] | undefined) => mod.translateAtomicWhere({ where, fields, columnFor: field => orm.getTableColumns(table)[field as keyof typeof table.$inferSelect] })
const compile = (where: Clause[] | undefined) => { const predicate = translate(where); return predicate && new PgDialect().sqlToQuery(predicate as orm.SQL) }

describe('where translation preserves the Local API predicate', () => {
  it.each([['eq', '='], ['ne', '<>'], ['lt', '<'], ['lte', '<='], ['gt', '>'], ['gte', '>=']])('%s binds a scalar', (operator, sqlOperator) => {
    const query = compile([{ field: 'count', operator, value: 7 }])!
    expect(query.sql).toContain(`"failed_verification_count" ${sqlOperator} $1`)
    expect(query.params).toEqual(['7'])
    if (operator === 'ne') expect(query.sql).toContain('is null or')
  })
  it('defaults to equality and binds malicious text without using it as SQL', () => {
    const value = "x'; DROP TABLE users; --"
    const query = compile([{ field: 'label', value }])!
    expect(query.sql).not.toContain(value)
    expect(query.params).toEqual([value])
  })
  it.each([['eq', 'is null'], ['ne', 'is not null']])('%s NULL', (operator, fragment) => {
    expect(compile([{ field: 'lockedUntil', operator, value: null }])).toMatchObject({ sql: expect.stringContaining(fragment), params: [] })
  })
  it.each([[[1, 2], [1, 2]], [[1, null], [1]], [[null], []], [[], []]])('in %j', (value, params) => {
    const query = compile([{ field: 'count', operator: 'in', value }])!
    expect(query.params).toEqual(params.map(String))
    if (value.includes(null)) expect(query.sql).toContain('is null')
    if (!value.length) expect(query.sql).toContain('false')
  })
  it('groups the existing AND conditions and OR conditions, including a sole OR', () => {
    const query = compile([{ field: 'id', value: '00000000-0000-4000-8000-000000000001' }, { field: 'count', value: 1, connector: 'OR' }, { field: 'count', value: 2, connector: 'OR' }])!
    expect(query.sql).toMatch(/"id" = \$1 and \(.* = \$2 or .* = \$3\)/)
    expect(compile([{ field: 'count', value: 1, connector: 'OR' }])?.params).toEqual(['1'])
    expect(compile([{ field: 'count', value: 1, connector: 'OR' }, { field: 'count', value: 2, connector: 'OR' }])?.sql).toContain(' or ')
  })
  it('binds dates and booleans in sensitive mode', () => {
    const date = new Date('2026-11-06T12:00:00Z')
    expect(compile([{ field: 'lockedUntil', value: date, mode: 'sensitive' }])?.params).toEqual([date])
    expect(compile([{ field: 'enabled', value: false }])?.params).toEqual([false])
  })
  it.each([
    [], undefined, [{ field: 'count', value: 1, operator: 'contains' }], [{ field: 'label', value: 'x', operator: 'starts_with' }],
    [{ field: 'label', value: 'x', operator: 'ends_with' }], [{ field: 'count', value: [1], operator: 'not_in' }],
    [{ field: 'count', value: null, operator: 'lt' }], [{ field: 'count', value: {} }], [{ field: 'count', value: undefined }],
    [{ field: 'count', value: NaN }], [{ field: 'count', value: [1, {}], operator: 'in' }], [{ field: 'unknown', value: 1 }],
    [{ field: 'user.id', value: 1 }], [{ field: 'label', value: 'x', mode: 'insensitive' }],
    [{ field: 'count', value: 1, connector: 'XOR' }], [{ field: 'count', value: 1, operator: 'toString' }],
    [{ field: 'count', value: Infinity }], [{ field: 'lockedUntil', value: new Date(NaN) }],
  ].map(where => ({ where })))('unsupported shape $where returns the fallback sentinel', ({ where }) => { expect(translate(where)).toBeUndefined() })
})

const id = '00000000-0000-4000-8000-000000000001'
function fixture(rows: Record<string, unknown>[] = []) {
  const statements: { sql: string; params: unknown[] }[] = []
  // Real Drizzle query builders and returning-row decoding, with only the wire
  // driver replaced. No Postgres infrastructure exists in this package's suite.
  const db = drizzle(async (sql, params) => {
    statements.push({ sql, params })
    return { rows: rows.map(row => Object.keys(orm.getTableColumns(table)).map(key => row[key])) }
  })
  const find = vi.fn(() => { throw new Error('atomic path must never pre-read') })
  const payload = { find, db: { name: 'postgres', tables: { custom_auth_counters: table }, tableNameMap: new Map([['two_factors', 'custom_auth_counters']]),
    drizzle: db },
    collections: { twoFactors: { config: { slug: 'twoFactors', flattenedFields: Object.values(fields) } } } }
  return { payload, statements, find }
}

describe('one guarded write and Payload-shaped returning row', () => {
  it('increments COALESCE in SQL, repeats the guard outside the one-row identity subquery, and maps all returned keys', async () => {
    const f = fixture([{ id, count: 10, user: id, lockedUntil: '2026-11-06 12:00:00+00', updatedAt: null, label: 'safe', enabled: true }])
    const result = await mod.postgresAtomic({ payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'id', value: id }, { field: 'count', operator: 'lt', value: 10 }], increment: { count: 1 }, set: { label: 'changed' } })
    expect(result).toEqual({ id, count: 10, user: id, lockedUntil: '2026-11-06T12:00:00.000Z', updatedAt: null, label: 'safe', enabled: true })
    expect(f.statements).toHaveLength(1)
    const q = f.statements[0]
    expect(q.sql).toContain('COALESCE("custom_auth_counters"."failed_verification_count", 0) +')
    expect(q.sql.match(/"failed_verification_count" < /g)).toHaveLength(2)
    expect(q.sql).toContain('limit $')
    expect(q.sql).toContain('returning')
    expect(q.sql).not.toMatch(/for update|for no key update/i)
    expect(q.params).toContain('changed')
    expect(f.find).not.toHaveBeenCalled()
  })
  it('a supported miss returns null (never fallback) and consume uses one guarded DELETE RETURNING', async () => {
    for (const consume of [false, true]) {
      const f = fixture()
      expect(await mod.postgresAtomic({ payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'id', value: id }], increment: { count: 1 }, consume })).toBeNull()
      expect(f.statements).toHaveLength(1)
      expect(f.statements[0].sql).toMatch(consume ? /^delete from/ : /^update/)
      expect(f.statements[0].sql.match(/"id" = /g)).toHaveLength(3)
      expect(f.statements[0].sql).toContain('order by')
      expect(f.statements[0].sql).toContain('limit $')
      expect(f.statements[0].params.at(-1)).toBe(id)
    }
  })
  it('unsupported predicates and non-Postgres adapters never issue SQL', async () => {
    const f = fixture()
    expect(await mod.postgresAtomic({ payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'label', operator: 'contains', value: 'x' }], increment: { count: 1 } })).toBeUndefined()
    f.payload.db.name = 'sqlite'
    expect(await mod.postgresAtomic({ payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'id', value: id }], increment: { count: 1 } })).toBeUndefined()
    expect(f.statements).toEqual([])
  })
  it('date normalization preserves null, numbers, booleans, JSON and relationship field names', () => {
    const row = { user: id, count: 3, enabled: false, lockedUntil: new Date('2026-11-06T12:00:00Z'), updatedAt: null, metadata: { roles: ['reader'] } }
    expect(mod.mapAtomicRow(row, fields)).toEqual({ ...row, lockedUntil: '2026-11-06T12:00:00.000Z' })
  })
  it('increment overrides set, while explicit updatedAt is preserved', async () => {
    const f = fixture()
    const updatedAt = '2026-11-06T12:00:00.000Z'
    await mod.postgresAtomic({
      payload: f.payload as unknown as BasePayload, collection: 'twoFactors',
      where: [{ field: 'id', value: id }], increment: { count: -1 },
      set: { count: 100, updatedAt },
    })
    expect(f.statements[0].sql).toContain('COALESCE(')
    expect(f.statements[0].params).not.toContain('100')
    expect(f.statements[0].params).toContain(-1)
    expect(f.statements[0].params).toContain(updatedAt)
  })
  it('uses collection dbName when there is no tableNameMap entry', async () => {
    const f = fixture()
    f.payload.db.tableNameMap.clear()
    Reflect.set(f.payload.collections.twoFactors.config, 'dbName', 'custom_auth_counters')
    await mod.postgresAtomic({ payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'id', value: id }], consume: true })
    expect(f.statements).toHaveLength(1)
  })
  it.each([
    { type: 'group' }, { localized: true }, { hasMany: true },
    { relationTo: ['users', 'teams'] }, { name: 'missing' },
  ])('falls back for a complex or unmapped field %j', async (shape) => {
    const f = fixture()
    f.payload.collections.twoFactors.config.flattenedFields.push({ ...fields.label, ...shape })
    expect(await mod.postgresAtomic({ payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'id', value: id }], consume: true })).toBeUndefined()
    expect(f.statements).toEqual([])
  })
  it.each([
    { increment: { id: 1 } }, { increment: { label: 1 } }, { increment: { missing: 1 } },
    { increment: { count: Infinity } }, { increment: {} },
    { set: { id } }, { set: { missing: 1 } }, { set: { label: undefined } },
    { set: { label: {} } },
  ] as { increment?: Record<string, number>; set?: Record<string, unknown> }[])('falls back for an unsupported write %j', async (write) => {
    const f = fixture()
    expect(await mod.postgresAtomic({ payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'id', value: id }], ...write })).toBeUndefined()
    expect(f.statements).toEqual([])
  })
  it('does not translate JSON predicates or virtual fields', async () => {
    for (const field of [{ ...fields.label, type: 'json' }, { ...fields.label, virtual: true }]) {
      const f = fixture()
      f.payload.collections.twoFactors.config.flattenedFields.push(field)
      expect(await mod.postgresAtomic({ payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'label', value: 'x' }], consume: true })).toBeUndefined()
      expect(f.statements).toEqual([])
    }
  })
})

describe('Postgres selection through the Better Auth adapter factory', () => {
  const options: BetterAuthOptions = {
    database: {} as never, baseURL: 'http://localhost:3000', secret: 'test-secret',
    advanced: { database: { generateId: 'uuid' } },
    session: { additionalFields: {
      count: { type: 'number' }, label: { type: 'string' },
      lockedUntil: { type: 'date' }, enabled: { type: 'boolean' },
    } },
  }
  function adapterFixture(
    rows: Record<string, unknown>[] = [],
    adapterConfig: PayloadAdapterConfig['adapterConfig'] = {},
    configOverrides: Record<string, unknown> = {},
  ) {
    const f = fixture(rows)
    const payload = createMockPayload({ documents: { sessions: [{ id, count: 1, label: 'safe' }] } })
    const config = { ...f.payload.collections.twoFactors.config, slug: 'sessions', ...configOverrides }
    Object.assign(payload, {
      db: { ...f.payload.db, tableNameMap: new Map([['sessions', 'custom_auth_counters']]) },
      collections: { sessions: { config } },
    })
    return { ...f, payload, config, adapter: payloadAdapter({ payloadClient: payload, adapterConfig })(options) }
  }

  const hook = () => undefined
  const shapes = [
    { shape: 'no hooks', config: {}, safe: true },
    { shape: 'empty sanitized hooks', config: { hooks: { beforeChange: [] }, fields: [{ ...fields.count, hooks: { afterRead: [] } }] }, safe: true },
    { shape: 'collection hook', config: { hooks: { beforeChange: [hook] } }, safe: false },
    { shape: 'field hook', config: { flattenedFields: [{ ...fields.count, hooks: { beforeChange: [hook] } }] }, safe: false },
    { shape: 'trash', config: { trash: true }, safe: false },
    { shape: 'versions', config: { versions: { drafts: false } }, safe: false },
    { shape: 'drafts', config: { versions: { drafts: {} } }, safe: false },
    { shape: 'base filter', config: { admin: { baseFilter: hook } }, safe: true },
    { shape: 'legacy base filter', config: { admin: { baseListFilter: hook } }, safe: true },
  ]
  describe.each(['auto', 'always', 'never'] as const)('atomicWrites %s', (atomicWrites) => {
    it.each(shapes)('selects the right path for $shape for both primitives', async ({ config, shape, safe }) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const atomic = atomicWrites !== 'never' && (safe || atomicWrites === 'always' && ['collection hook', 'field hook'].includes(shape))
      for (const method of ['incrementOne', 'consumeOne'] as const) {
        const f = adapterFixture([{ id, count: 2, lockedUntil: null, updatedAt: null }], { atomicWrites }, config)
        const result = await f.adapter[method]({ model: 'session', where: [{ field: 'id', value: id }], increment: { count: 1 } })
        expect(result).toMatchObject({ id, count: atomic || method === 'incrementOne' ? 2 : 1 })
        expect(f.statements).toHaveLength(atomic ? 1 : 0)
        expect(f.payload.findByID).toHaveBeenCalledTimes(atomic ? 0 : 1)
        expect(method === 'incrementOne' ? f.payload.update : f.payload.delete).toHaveBeenCalledTimes(atomic ? 0 : 1)
      }
      expect(warn).toHaveBeenCalledTimes(atomicWrites !== 'never' && !atomic ? 2 : 0)
    })
  })

  it('defaults to auto and preserves hook-bearing collections through the Local API', async () => {
    const f = adapterFixture([], {}, { hooks: { beforeValidate: [hook] } })
    await f.adapter.consumeOne({ model: 'session', where: [{ field: 'id', value: id }] })
    expect(f.statements).toEqual([])
    expect(f.payload.delete).toHaveBeenCalledTimes(1)
  })

  it.each(['auto', 'always', 'never'] as const)('handles unavailable collection metadata in %s mode', async (atomicWrites) => {
    const f = adapterFixture([], { atomicWrites })
    Reflect.deleteProperty(f.payload, 'collections')
    const result = f.adapter.consumeOne({ model: 'session', where: [{ field: 'id', value: id }] })
    if (atomicWrites === 'always') {
      await expect(result).rejects.toThrow('collection config is unavailable')
      expect(f.payload.delete).not.toHaveBeenCalled()
    } else {
      await result
      expect(f.payload.delete).toHaveBeenCalledTimes(1)
    }
    expect(f.statements).toEqual([])
    expect(console.error).toHaveBeenCalledTimes(atomicWrites === 'never' ? 0 : 1)
  })

  it.each([
    'beforeValidate', 'beforeChange', 'afterChange', 'beforeDelete', 'afterDelete',
    'beforeOperation', 'afterOperation', 'beforeRead', 'afterRead', 'afterError',
    'afterForgotPassword', 'beforeLogin', 'afterLogin', 'afterLogout', 'afterMe',
    'afterRefresh', 'me', 'refresh',
  ])('auto rejects collection %s hooks', async (name) => {
    const f = adapterFixture([], {}, { hooks: { [name]: [hook] } })
    await f.adapter.consumeOne({ model: 'session', where: [{ field: 'id', value: id }] })
    expect(f.statements).toEqual([])
    expect(f.payload.delete).toHaveBeenCalledTimes(1)
  })

  it.each(['beforeValidate', 'beforeChange', 'afterChange', 'afterRead'])('auto rejects field %s hooks', async (name) => {
    const f = adapterFixture([], {}, { fields: [{ ...fields.count, hooks: { [name]: [hook] } }] })
    await f.adapter.consumeOne({ model: 'session', where: [{ field: 'id', value: id }] })
    expect(f.statements).toEqual([])
    expect(f.payload.delete).toHaveBeenCalledTimes(1)
  })

  it('auto ignores field beforeDuplicate hooks, including Payload defaults on sanitized unique fields', async () => {
    const sanitized = await buildConfig({
      secret: 'atomic-sanitization-test-secret',
      db: postgresAdapter({ pool: {}, idType: 'uuid', push: false }),
      // Payload 4 defaults versions and authorship (createdBy/updatedBy hooks) on; opt out of both.
      collections: [{ slug: 'sessions', timestamps: false, versions: false, authorship: false, fields: [
        { name: 'count', type: 'number' },
        { name: 'label', type: 'text', unique: true },
      ] }],
    })
    const config = sanitized.collections.find(collection => collection.slug === 'sessions')!
    const label = config.flattenedFields.find(field => field.name === 'label')!
    expect('hooks' in label && label.hooks?.beforeDuplicate?.length).toBeGreaterThan(0)
    for (const method of ['consumeOne', 'incrementOne'] as const) {
      const f = adapterFixture([], {}, { ...config })
      await f.adapter[method]({ model: 'session', where: [{ field: 'id', value: id }], increment: { count: 1 } })
      expect(f.statements).toHaveLength(1)
      expect(f.payload.findByID).not.toHaveBeenCalled()
      expect(f.payload.delete).not.toHaveBeenCalled()
      expect(f.payload.update).not.toHaveBeenCalled()
    }
  })

  it('auto ignores custom beforeDuplicate hooks but still detects other hooks on the same field', async () => {
    for (const afterRead of [[], [hook]]) {
      const f = adapterFixture([], {}, { fields: [{ ...fields.count, hooks: { beforeDuplicate: [hook], afterRead } }] })
      await f.adapter.consumeOne({ model: 'session', where: [{ field: 'id', value: id }] })
      expect(f.statements).toHaveLength(afterRead.length ? 0 : 1)
    }
  })

  it.each(['fields', 'tabs', 'blocks', 'flattenedFields'])('auto finds hooks nested under %s', async (key) => {
    const f = adapterFixture([], {}, { fields: [{ [key]: [{ fields: [{ ...fields.count, hooks: { afterRead: [hook] } }] }] }] })
    await f.adapter.consumeOne({ model: 'session', where: [{ field: 'id', value: id }] })
    expect(f.statements).toEqual([])
    expect(f.payload.delete).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('caches the %s hook decision across both primitives and logs it once', async (withHooks) => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const f = adapterFixture([{ id, count: 2, lockedUntil: null, updatedAt: null }], { enableDebugLogs: true })
    const inspectHooks = vi.fn(() => ({ afterRead: withHooks ? [hook] : [] }))
    Object.defineProperty(f.config, 'hooks', { get: inspectHooks })
    await Promise.all([
      f.adapter.incrementOne({ model: 'session', where: [{ field: 'id', value: id }], increment: { count: 1 } }),
      f.adapter.consumeOne({ model: 'session', where: [{ field: 'id', value: id }] }),
    ])
    expect(inspectHooks).toHaveBeenCalledTimes(1)
    expect(f.statements).toHaveLength(withHooks ? 0 : 2)
    expect(debug).toHaveBeenCalledTimes(1)
    expect(debug).toHaveBeenCalledWith(expect.stringContaining(withHooks ? 'Local API: collection hooks' : 'atomic Postgres: no trash'))
  })

  it('caches decisions separately per collection', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const f = adapterFixture([{ id, count: 2, lockedUntil: null, updatedAt: null }], { enableDebugLogs: true })
    const inspectHooks = vi.fn(() => ({ beforeDelete: [hook] }))
    const config = { ...f.config, slug: 'accounts' }
    Object.defineProperty(config, 'hooks', { get: inspectHooks })
    Object.assign(f.payload.collections, { accounts: { config } })
    for (const model of ['session', 'account', 'session', 'account']) {
      await f.adapter.consumeOne({ model, where: [{ field: 'id', value: id }] })
    }
    expect(f.statements).toHaveLength(2)
    expect(inspectHooks).toHaveBeenCalledTimes(1)
    expect(debug).toHaveBeenCalledTimes(2)
    expect(debug).toHaveBeenCalledWith(expect.stringContaining("'accounts': Local API: collection hooks"))
  })

  it.each([
    { trash: true }, { versions: { drafts: true } }, { trash: true, versions: { drafts: true } },
  ])('always warns once per collection/reason when lifecycle policy forces fallback: %j', async (config) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = adapterFixture([], { atomicWrites: 'always' }, config)
    for (let i = 0; i < 2; i++) {
      await f.adapter.incrementOne({ model: 'session', where: [{ field: 'id', value: id }], increment: { count: 1 } })
      await f.adapter.consumeOne({ model: 'session', where: [{ field: 'id', value: id }] })
    }
    expect(f.statements).toEqual([])
    expect(warn).toHaveBeenCalledTimes(Number(!!config.trash) + Number(!!config.versions))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("atomicWrites 'always' on 'sessions' uses the non-atomic Local API path"))
  })
  it('auto warns once per collection/reason across concurrent writes and names the hook opt-in', async () => {
    const atomic = mod.createPostgresAtomic()
    const f = fixture()
    const config = { ...f.payload.collections.twoFactors.config, trash: true, versions: { drafts: true }, hooks: { beforeChange: [hook] } }
    Reflect.set(f.payload, 'collections', { teams: { config }, accounts: { config } })
    for (let i = 0; i < 2; i++) await Promise.all(['teams', 'accounts'].flatMap(collection => [true, false].map(consume => atomic({ payload: f.payload as unknown as BasePayload, collection, where: [{ field: 'id', value: id }], increment: { count: 1 }, consume }))))
    expect(console.warn).toHaveBeenCalledTimes(6)
    for (const collection of ['teams', 'accounts']) for (const reason of ['trash is enabled', 'versions/drafts are enabled', 'collection hooks are configured']) {
      const calls = vi.mocked(console.warn).mock.calls.filter(([message]) => String(message).includes(`'${collection}'`) && String(message).includes(reason))
      expect(calls).toHaveLength(1)
      expect(calls[0][0]).toContain('non-atomic Local API path')
      if (reason.includes('hooks')) expect(calls[0][0]).toContain("Review the hooks before opting into adapterConfig.atomicWrites: 'always'")
    }
    expect(console.error).not.toHaveBeenCalled()
    expect(f.statements).toEqual([])
  })

  it.each(['incrementOne', 'consumeOne'] as const)('%s returns the SQL row with relationship and date transforms', async (method) => {
    const f = adapterFixture([{ id, count: '3', label: 'returned', user: id, lockedUntil: '2026-11-06 12:00:00+00', enabled: false, updatedAt: null }])
    const result = await f.adapter[method]({ model: 'session', where: [{ field: 'userId', value: id }], increment: { count: 1 } })
    expect(result).toMatchObject({ id, count: 3, label: 'returned', userId: id, lockedUntil: new Date('2026-11-06T12:00:00Z'), enabled: false, updatedAt: null })
    expect(result).not.toHaveProperty('user')
    expect(f.statements).toHaveLength(1)
    expect(f.statements[0].sql.match(/"user_id" = /g)).toHaveLength(2)
    expect(f.payload.find).not.toHaveBeenCalled()
    expect(f.payload.findByID).not.toHaveBeenCalled()
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(f.payload.delete).not.toHaveBeenCalled()
  })
  it.each(['incrementOne', 'consumeOne'] as const)('%s treats a supported SQL miss as final', async (method) => {
    const f = adapterFixture()
    expect(await f.adapter[method]({ model: 'session', where: [{ field: 'id', value: id }], increment: { count: 1 } })).toBeNull()
    expect(f.statements).toHaveLength(1)
    expect(f.payload.findByID).not.toHaveBeenCalled()
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(f.payload.delete).not.toHaveBeenCalled()
  })
  it.each(['incrementOne', 'consumeOne'] as const)('%s sends unsupported predicates to the Local API', async (method) => {
    const f = adapterFixture()
    const result = await f.adapter[method]({ model: 'session', where: [{ field: 'label', operator: 'contains', value: 'safe' }], increment: { count: 1 } })
    expect(result).toMatchObject({ id, count: method === 'incrementOne' ? 2 : 1 })
    expect(f.statements).toEqual([])
    expect(f.payload.find).toHaveBeenCalled()
    expect(method === 'incrementOne' ? f.payload.update : f.payload.delete).toHaveBeenCalledTimes(1)
  })
  it.each(['mongodb', 'sqlite'])('keeps the Local API for %s', async (name) => {
    const f = adapterFixture()
    Reflect.set(f.payload.db, 'name', name)
    await f.adapter.incrementOne({ model: 'session', where: [{ field: 'id', value: id }], increment: { count: 1 } })
    await f.adapter.consumeOne({ model: 'session', where: [{ field: 'id', value: id }] })
    expect(f.statements).toEqual([])
    expect(f.payload.update).toHaveBeenCalledTimes(1)
    expect(f.payload.delete).toHaveBeenCalledTimes(1)
  })
  it('propagates driver failures without falling back', async () => {
    const f = adapterFixture()
    Reflect.set(f.payload.db, 'drizzle', drizzle(async () => { throw new Error('connection reset') }))
    for (const method of ['incrementOne', 'consumeOne'] as const) {
      await expect(f.adapter[method]({ model: 'session', where: [{ field: 'id', value: id }], increment: { count: 1 } })).rejects.toThrow()
    }
    expect(f.payload.findByID).not.toHaveBeenCalled()
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(f.payload.delete).not.toHaveBeenCalled()
  })
})

describe('loud SQL compatibility failures', () => {
  it.each(['table is missing', "unsupported field 'label'", 'untranslatable where'])('logs the actual %s fallback once without claiming an atomic write', async (reason) => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const f = fixture()
    if (reason === 'table is missing') f.payload.db.tableNameMap.clear()
    if (reason.startsWith('unsupported field')) f.payload.collections.twoFactors.config.flattenedFields.push({ ...fields.label, type: 'group' })
    const atomic = mod.createPostgresAtomic({ enableDebugLogs: true })
    const args = { payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'id', value: id, ...(reason === 'untranslatable where' && { operator: 'contains' }) }], consume: true }
    await Promise.all([atomic(args), atomic(args)])
    expect(debug).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(`Local API: ${reason}`))
    expect(console.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(reason))
    expect(f.statements).toEqual([])
  })

  it.each(['auto', 'always'] as const)('%s reports each collection/reason once even without debug logs', async (atomicWrites) => {
    const f = fixture()
    const atomic = mod.createPostgresAtomic({ atomicWrites })
    const args = { payload: f.payload as unknown as BasePayload, collection: 'twoFactors', consume: true }
    for (let i = 0; i < 2; i++) {
      for (const where of [[{ field: 'label', value: 'x', operator: 'contains' }], undefined]) {
        const result = atomic({ ...args, where })
        if (atomicWrites === 'always') await expect(result).rejects.toThrow(/cannot run atomically: untranslatable where/)
        else expect(await result).toBeUndefined()
      }
      f.payload.db.tableNameMap.clear()
      const result = atomic({ ...args, where: [{ field: 'id', value: id }] })
      if (atomicWrites === 'always') await expect(result).rejects.toThrow(/cannot run atomically: table is missing/)
      else expect(await result).toBeUndefined()
      f.payload.db.tableNameMap.set('two_factors', 'custom_auth_counters')
    }
    expect(console.error).toHaveBeenCalledTimes(2)
    expect(f.statements).toEqual([])
  })

  it.each(['table', 'columns', 'connection', 'field'] as const)('always throws for missing/unsupported %s instead of falling back to the Local API', async (missing) => {
    const f = fixture()
    if (missing === 'table') f.payload.db.tableNameMap.clear()
    if (missing === 'columns') Reflect.set(f.payload.db.tables, 'custom_auth_counters', {})
    if (missing === 'connection') Reflect.deleteProperty(f.payload.db, 'drizzle')
    if (missing === 'field') f.payload.collections.twoFactors.config.flattenedFields.push({ name: 'group', type: 'group' })
    const atomic = mod.createPostgresAtomic({ atomicWrites: 'always' })
    for (let i = 0; i < 2; i++) await expect(atomic({ payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'id', value: id }], consume: true })).rejects.toThrow(/atomicWrites 'always'/)
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(f.statements).toEqual([])
  })

  it('reports the same incompatibility separately for each collection', async () => {
    const f = fixture()
    f.payload.db.tableNameMap.clear()
    Object.assign(f.payload.collections, { accounts: { config: { ...f.payload.collections.twoFactors.config, slug: 'accounts' } } })
    const atomic = mod.createPostgresAtomic()
    for (let i = 0; i < 2; i++) {
      for (const collection of ['twoFactors', 'accounts']) await atomic({ payload: f.payload as unknown as BasePayload, collection, where: [{ field: 'id', value: id }], consume: true })
    }
    expect(console.error).toHaveBeenCalledTimes(2)
    for (const collection of ['twoFactors', 'accounts']) expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`'${collection}': cannot run atomically: table is missing`))
  })

  it('configured policies warn without debug logging, while never stays quiet', async () => {
    for (const atomicWrites of ['auto', 'always', 'never'] as const) {
      const f = fixture()
      Object.assign(f.payload.collections.twoFactors.config, atomicWrites === 'auto' ? { hooks: { beforeRead: [() => {}] } } : { trash: true })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {}).mockClear()
      await mod.createPostgresAtomic({ atomicWrites })({ payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'id', value: id }], consume: true })
      expect(warn).toHaveBeenCalledTimes(atomicWrites === 'never' ? 0 : 1)
    }
    expect(console.error).not.toHaveBeenCalled()
  })

  it('reports a later unsupported predicate after an earlier atomic write', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const f = fixture()
    const atomic = mod.createPostgresAtomic({ enableDebugLogs: true })
    const args = { payload: f.payload as unknown as BasePayload, collection: 'twoFactors', consume: true }
    await atomic({ ...args, where: [{ field: 'id', value: id }] })
    for (let i = 0; i < 2; i++) await atomic({ ...args, where: [{ field: 'label', value: 'x', operator: 'contains' }] })
    expect(debug).toHaveBeenCalledTimes(2)
    expect(debug).toHaveBeenLastCalledWith(expect.stringContaining('Local API: untranslatable where'))
  })
})

describe('Payload table naming', () => {
  // Execute the exact dependency installed with Payload; do not use it at runtime.
  const require = createRequire(import.meta.url)
  const payloadRequire = createRequire(createRequire(require.resolve('@payloadcms/db-postgres')).resolve('@payloadcms/drizzle'))
  const toSnakeCase = payloadRequire('to-snake-case') as (slug: string) => string
  it.each(['auth-twoFactors', 'oauthClientIDs', 'twoFactors', 'oauthRefreshTokens', 'some.URL', 'some:URL', 'XMLHttpRequest', ' words With Spaces ', '__', 'ABC', 'foo42Bar'])('matches Payload for %s and resolves its mapped table', async (slug) => {
    const name = toSnakeCase(slug)
    expect(mod.payloadTableName(slug)).toBe(name)
    const f = fixture()
    f.payload.collections.twoFactors.config.slug = slug
    f.payload.db.tableNameMap = new Map([[name, 'custom_auth_counters']])
    expect(await mod.postgresAtomic({ payload: f.payload as unknown as BasePayload, collection: 'twoFactors', where: [{ field: 'id', value: id }], consume: true })).toBeNull()
    expect(f.statements).toHaveLength(1)
  })
})


describe('non-stored fields', () => {
  it('auto uses atomic SQL for real sanitized teams with a join and ui field', async () => {
    const { getPayload } = await import('payload')
    const sanitized = await buildConfig({
      secret: 'atomic-join-test', telemetry: false,
      typescript: { autoGenerate: false }, admin: { importMap: { autoGenerate: false } },
      db: postgresAdapter({ pool: {}, push: false, idType: 'uuid' }),
      collections: [
        { slug: 'teams', versions: false, authorship: false, fields: [
          { name: 'count', type: 'number' },
          { name: 'members', type: 'join', collection: 'members', on: 'team' },
          { name: 'notice', type: 'ui', admin: {} },
        ] },
        { slug: 'members', fields: [{ name: 'team', type: 'relationship', relationTo: 'teams' }] },
      ],
    })
    const payload = await getPayload({ config: sanitized, key: 'atomic-teams-join-test', disableDBConnect: true })
    try {
      const columns = orm.getTableColumns(payload.db.tables.teams)
      expect(columns).not.toHaveProperty('members')
      expect(columns).not.toHaveProperty('notice')
      const queries: string[] = []
      Reflect.set(payload.db, 'drizzle', drizzle(async sql => { queries.push(sql); return { rows: [] } }))
      const atomic = mod.createPostgresAtomic()
      expect(await atomic({ payload, collection: 'teams', where: [{ field: 'id', value: id }], increment: { count: 1 } })).toBeNull()
      expect(queries).toHaveLength(1)
      expect(console.warn).not.toHaveBeenCalled()
      expect(console.error).not.toHaveBeenCalled()
      // Non-stored fields still cannot become SQL predicates or write targets.
      expect(await atomic({ payload, collection: 'teams', where: [{ field: 'members', value: id }], consume: true })).toBeUndefined()
    } finally { await payload.destroy() }
  })
})

describe('pinned Drizzle compatibility', () => {
  const require = createRequire(import.meta.url)
  const adapterRequire = createRequire(require.resolve('@payloadcms/db-postgres'))
  const entry = adapterRequire.resolve('@payloadcms/drizzle')
  it('pins exactly the ORM version installed Payload uses', () => {
    const payloadManifest = JSON.parse(readFileSync(resolve(dirname(entry), '../package.json'), 'utf8'))
    const ours = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(payloadManifest.name).toBe('@payloadcms/drizzle')
    expect(ours.dependencies['drizzle-orm']).toBe('0.45.2')
    expect(payloadManifest.dependencies['drizzle-orm']).toBe(ours.dependencies['drizzle-orm'])
    expect(ours.devDependencies).not.toHaveProperty('drizzle-orm')
  })
  it('executes the same predicates as the installed Payload operator map', () => {
    for (const [key, name] of Object.entries({ equals: 'eq', not_equals: 'ne', exists: 'isNotNull', isNull: 'isNull', in: 'inArray', less_than: 'lt', less_than_equal: 'lte', greater_than: 'gt', greater_than_equal: 'gte', and: 'and', or: 'or' })) {
      const args = ['and', 'or'].includes(key) ? [orm.eq(table.count, 1), orm.eq(table.count, 2)] : ['isNull', 'exists'].includes(key) ? [table.count] : [table.count, key === 'in' ? [1, 2] : 1]
      const fromPayload = Reflect.get(livePostgres.operators, key)(...args)
      const fromORM = Reflect.get(orm, name)(...args)
      expect(new PgDialect().sqlToQuery(fromORM)).toEqual(new PgDialect().sqlToQuery(fromPayload))
    }
  })
})

describe('malformed typed identifiers', () => {
  const serialTable = pgTable('serial_counters', { id: integer('id'), user: integer('user_id'), count: integer('count') })
  const compileID = (columnTable: typeof table | typeof serialTable, where: Clause[]) => {
    const columns = orm.getTableColumns(columnTable)
    const predicate = mod.translateAtomicWhere({ where, fields, columnFor: field => Reflect.get(columns, field) })!
    return new PgDialect().sqlToQuery(predicate)
  }
  it.each(['id', 'user'])('makes malformed uuid/serial %s clauses nonmatching without sending an invalid value to Postgres', (field) => {
    for (const t of [table, serialTable]) {
      expect(compileID(t, [{ field, value: 'not-an-id' }])).toMatchObject({ sql: expect.stringContaining('false'), params: [] })
      expect(compileID(t, [{ field, value: ['not-an-id'], operator: 'in' }])).toMatchObject({ sql: expect.stringContaining('false'), params: [] })
    }
  })
  it.each(['id', 'user'])('fails closed for malformed ne on %s instead of matching every non-null row', (field) => {
    for (const t of [table, serialTable]) expect(compileID(t, [{ field, value: 'invalid', operator: 'ne' }])).toMatchObject({ sql: expect.stringContaining('false'), params: [] })
  })
  it.each([NaN, Infinity, -Infinity])('treats a nonfinite numeric identifier (%s) as a nonmatch', (value) => {
    for (const field of ['id', 'user']) {
      expect(compileID(serialTable, [{ field, value }])).toMatchObject({ sql: expect.stringContaining('false'), params: [] })
      expect(compileID(serialTable, [{ field, value: [value], operator: 'in' }])).toMatchObject({ sql: expect.stringContaining('false'), params: [] })
    }
  })
  it('handles malformed serial IDs after the Better Auth factory coerces them to NaN', async () => {
    const f = fixture()
    Reflect.set(f.payload.db.tables, 'custom_auth_counters', serialTable)
    f.payload.db.tableNameMap = new Map([['sessions', 'custom_auth_counters']])
    Reflect.set(f.payload, 'collections', { sessions: { config: { slug: 'sessions', fields: [fields.count, fields.user] } } })
    const adapter = payloadAdapter({ payloadClient: f.payload as unknown as BasePayload, adapterConfig: { atomicWrites: 'always' } })({
      baseURL: 'http://localhost:3000', secret: 'test-secret', advanced: { database: { generateId: 'serial' } },
      session: { additionalFields: { count: { type: 'number' } } },
    })
    for (const field of ['id', 'userId']) for (const method of ['incrementOne', 'consumeOne'] as const) {
      expect(await adapter[method]({ model: 'session', where: [{ field, value: 'not-a-number' }], increment: { count: 1 } })).toBeNull()
      expect(f.statements.at(-1)?.sql).toContain('false')
      expect(f.statements.at(-1)?.params).not.toContain(NaN)
    }
    expect(f.statements).toHaveLength(4)
    expect(console.error).not.toHaveBeenCalled()
  })
  it('retains valid IN members and explicit NULLs, and keeps OR branches separate', () => {
    expect(compileID(table, [{ field: 'user', operator: 'in', value: ['invalid', id, null] }])).toMatchObject({ sql: expect.stringContaining('is null'), params: [id] })
    expect(compileID(serialTable, [{ field: 'user', operator: 'in', value: ['invalid', '2', null] }])).toMatchObject({ sql: expect.stringContaining('is null'), params: [2] })
    expect(compileID(table, [{ field: 'id', value: 'invalid', connector: 'OR' }, { field: 'user', value: id, connector: 'OR' }])).toMatchObject({ sql: expect.stringContaining('false or'), params: [id] })
    expect(compileID(serialTable, [{ field: 'id', value: '2' }]).params).toEqual([2])
  })
  it('matches the installed Payload UUID validator, including NIL/MAX and version 7/8 UUIDs', async () => {
    const req = createRequire(createRequire(createRequire(import.meta.url).resolve('@payloadcms/db-postgres')).resolve('@payloadcms/drizzle'))
    const { validate } = await import(pathToFileURL(req.resolve('uuid')).href)
    for (const value of [id, '00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '00000000-0000-7000-8000-000000000001', '00000000-0000-8000-8000-000000000001', '00000000-0000-0000-8000-000000000001', 'invalid']) {
      expect(compileID(table, [{ field: 'id', value }]).params).toEqual(validate(value) ? [value] : [])
    }
  })
})
