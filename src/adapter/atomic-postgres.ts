import type { BasePayload, CollectionSlug } from 'payload'
import type { AnyPgColumn, PgDatabase, PgQueryResultHKT, PgTable } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

type AtomicField = {
  name: string
  type: string
  virtual?: unknown
  localized?: boolean
  hasMany?: boolean
  relationTo?: string | string[]
}
type AtomicFields = Record<string, AtomicField>
type AtomicWhere = {
  field: string
  value: unknown
  operator?: string
  connector?: string
  mode?: string
}
type PostgresAdapter = {
  name?: string
  drizzle?: PgDatabase<PgQueryResultHKT>
  tables?: Record<string, PgTable>
  tableNameMap?: Map<string, string>
}

/**
 * `undefined` means unsupported: use the original Local API fallback. A supported
 * statement returns a Payload-shaped document or null, never a pre-read.
 */
export async function postgresAtomic({
  payload, collection, where, increment, set, consume = false,
}: {
  payload: BasePayload
  collection: CollectionSlug
  where?: AtomicWhere[]
  increment?: Record<string, number>
  set?: Record<string, unknown>
  consume?: boolean
}): Promise<Record<string, unknown> | null | undefined> {
  const { name, tables, tableNameMap, drizzle } = (payload.db ?? {}) as PostgresAdapter
  if (name !== 'postgres' || !drizzle) return undefined
  const config = payload.collections[collection]?.config
  if (!config) return undefined
  const defaultName = config.slug.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/-/g, '_')
  const tableName = tableNameMap?.get(defaultName) ?? (typeof config.dbName === 'string' ? config.dbName : undefined)
  const table = tableName === undefined ? undefined : tables?.[tableName]
  if (!table) return undefined

  // Load Drizzle only for SQL stores. The package declares it as a runtime dependency.
  const orm = await import('drizzle-orm')
  const columns = orm.getTableColumns(table)
  const fields: AtomicFields = Object.fromEntries(
    (config.flattenedFields ?? config.fields)
      .filter((field) => 'name' in field && field.name)
      .map((field) => [(field as AtomicField).name, field as AtomicField])
  )
  // Only flat documents can be returned exactly without Payload's join/read pipeline.
  const supportedTypes = new Set(['text', 'textarea', 'email', 'number', 'checkbox', 'date', 'json', 'select', 'radio', 'relationship', 'upload'])
  for (const field of Object.values(fields)) {
    if (field.virtual) continue
    if (!supportedTypes.has(field.type) || field.localized || field.hasMany || Array.isArray(field.relationTo) || !columns[field.name]) return undefined
  }
  const columnFor = (field: string): AnyPgColumn | undefined =>
    Object.hasOwn(columns, field) && (field === 'id' || fields[field] && !fields[field].virtual)
      ? columns[field] : undefined
  const predicate = translateAtomicWhere({ where, columnFor, fields, orm })
  if (!predicate) return undefined

  const { sql, and, eq } = orm
  const data: Record<string, unknown> = {}
  if (!consume) {
    for (const [field, value] of Object.entries(set ?? {})) {
      if (field === 'id' || !columnFor(field) || value === undefined || !validValue(value, fields[field], true)) return undefined
      data[field] = value
    }
    for (const [field, delta] of Object.entries(increment ?? {})) {
      const column = columnFor(field)
      if (!column || field === 'id' || fields[field]?.type !== 'number' || typeof delta !== 'number' || !Number.isFinite(delta)) return undefined
      // Increment wins over `set` for overlapping fields, like the original CAS implementation.
      data[field] = sql`COALESCE(${column}, 0) + ${delta}`
    }
    if (!Object.keys(data).length) return undefined
    if (columns.updatedAt && !Object.hasOwn(data, 'updatedAt')) data.updatedAt = new Date().toISOString()
  }

  // Select ONE identity even for a non-unique guard. The OUTER guard is essential:
  // Postgres rechecks it after waiting for a concurrent writer. No transaction,
  // pre-read, explicit lock, or separate connection is introduced.
  const candidate = drizzle.select({ id: columns.id }).from(table).where(predicate).orderBy(columns.id).limit(1)
  const guard = and(eq(columns.id, candidate), predicate)
  const rows = consume
    ? await drizzle.delete(table).where(guard).returning()
    : await drizzle.update(table).set(data).where(guard).returning()
  return rows[0] ? mapAtomicRow(rows[0], fields) : null
}

const scalar = (value: unknown): boolean =>
  value === null || typeof value === 'string' || typeof value === 'boolean' ||
  typeof value === 'number' && Number.isFinite(value) ||
  value instanceof Date && Number.isFinite(value.getTime())

function validValue(value: unknown, field?: AtomicField, allowJSON = false): boolean {
  if (value === null) return true
  if (field?.type === 'json') return allowJSON
  return scalar(value)
}

/** Match convertWhereToPayload's connector and NULL semantics exactly. */
export function translateAtomicWhere({ where, columnFor, fields, orm }: {
  where?: AtomicWhere[]
  columnFor: (field: string) => AnyPgColumn | undefined
  fields: AtomicFields
  orm: typeof import('drizzle-orm')
}): SQL | undefined {
  if (!Array.isArray(where) || !where.length) return undefined
  const { sql, and, or, eq, ne, lt, lte, gt, gte, inArray, isNull, isNotNull } = orm
  const all: (SQL | undefined)[] = []
  const any: (SQL | undefined)[] = []
  for (const clause of where) {
    const { field, value, operator = 'eq', connector = 'AND', mode } = clause
    const column = typeof field === 'string' && !field.includes('.') && columnFor(field)
    if (!column || mode && mode !== 'sensitive' || !['AND', 'OR'].includes(connector) || fields[field]?.type === 'json') return undefined
    let condition: SQL | undefined
    if (operator === 'in') {
      if (!Array.isArray(value) || !value.every(scalar)) return undefined
      const values = value.filter((v) => v !== null)
      condition = values.length ? inArray(column, values) : sql`false`
      if (value.includes(null)) condition = or(condition, isNull(column))
    } else {
      if (!scalar(value)) return undefined
      if (operator === 'eq') condition = value === null ? isNull(column) : eq(column, value)
      else if (operator === 'ne') condition = value === null ? isNotNull(column) : or(isNull(column), ne(column, value))
      else {
        const comparisons = { lt, lte, gt, gte }
        const comparison = Object.hasOwn(comparisons, operator) ? comparisons[operator as keyof typeof comparisons] : undefined
        if (!comparison || value === null) return undefined
        condition = comparison(column, value)
      }
    }
    ;(connector === 'OR' && where.length > 1 ? any : all).push(condition)
  }
  return and(...all, ...(any.length ? [or(...any)] : []))
}

/** Drizzle returning() uses Payload keys, including relationship FK keys.
 * Normalize dates to ISO as the Local API does, before the factory transforms them.
 */
export function mapAtomicRow(row: Record<string, unknown>, fields: AtomicFields): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    fields[key]?.type === 'date' && value !== null ? new Date(value as string | number | Date).toISOString() : value,
  ]))
}
