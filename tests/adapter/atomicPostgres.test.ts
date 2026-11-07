import * as orm from 'drizzle-orm'
import { pgTable, uuid, numeric, text, timestamp, boolean, PgDialect } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { describe, expect, it, vi } from 'vitest'
import type { BasePayload } from 'payload'
import type { BetterAuthOptions } from 'better-auth'
import * as mod from '../../src/adapter/atomic-postgres.js'
import { payloadAdapter } from '../../src/adapter/index.js'
import { createMockPayload } from './mocks.js'

const table = pgTable('custom_auth_counters', {
  id: uuid('id'), count: numeric('failed_verification_count', { mode: 'number' }),
  label: text('display_label'), user: uuid('user_id'), lockedUntil: timestamp('locked_until', { mode: 'string', withTimezone: true }),
  enabled: boolean('enabled'), updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }),
})
const fields = Object.fromEntries([
  ['count', 'number'], ['label', 'text'], ['user', 'relationship'], ['lockedUntil', 'date'], ['enabled', 'checkbox'], ['updatedAt', 'date'],
].map(([name, type]) => [name, { name, type }]))
type Clause = { field: string; value: unknown; operator?: string; connector?: string; mode?: string }
const translate = (where: Clause[] | undefined) => mod.translateAtomicWhere({ where, fields, orm, columnFor: field => orm.getTableColumns(table)[field as keyof typeof table.$inferSelect] })
const compile = (where: Clause[] | undefined) => { const predicate = translate(where); return predicate && new PgDialect().sqlToQuery(predicate) }

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
    const query = compile([{ field: 'id', value: 'id' }, { field: 'count', value: 1, connector: 'OR' }, { field: 'count', value: 2, connector: 'OR' }])!
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
  ])('falls back for an unsupported write %j', async (write) => {
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
  function adapterFixture(rows: Record<string, unknown>[] = []) {
    const f = fixture(rows)
    const payload = createMockPayload({ documents: { sessions: [{ id, count: 1, label: 'safe' }] } })
    const config = { ...f.payload.collections.twoFactors.config, slug: 'sessions' }
    Object.assign(payload, {
      db: { ...f.payload.db, tableNameMap: new Map([['sessions', 'custom_auth_counters']]) },
      collections: { sessions: { config } },
    })
    return { ...f, payload, adapter: payloadAdapter({ payloadClient: payload })(options) }
  }
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
