import type { BasePayload, CollectionSlug } from 'payload'
import { sql, and, or, eq, ne, lt, lte, gt, gte, inArray, isNull, isNotNull, getTableColumns, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgDatabase, PgQueryResultHKT, PgTable } from 'drizzle-orm/pg-core'

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
  drizzle?: PgDatabase<PgQueryResultHKT, Record<string, unknown>>
  tables?: Record<string, PgTable>
  tableNameMap?: Map<string, string>
}

export type AtomicWrites = 'auto' | 'always' | 'never'

/** Detect hooks on every field shape, including unnamed tabs/rows and blocks. */
function hasFieldHooks(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some(field => hasFieldHooks(field, seen))
  const field = value as Record<string, unknown>
  return hasHooks(field.hooks, true) || ['fields', 'flattenedFields', 'tabs', 'blocks']
    .some(key => hasFieldHooks(field[key], seen))
}

function hasHooks(hooks: unknown, field = false): boolean {
  return !!hooks && typeof hooks === 'object' && Object.entries(hooks)
    // Payload installs this on unique fields; duplicate never runs on update/delete.
    .some(([key, value]) => !(field && key === 'beforeDuplicate') &&
      (Array.isArray(value) ? value.length > 0 : typeof value === 'function'))
}

/** Payload's to-snake-case 1.x → to-space-case → to-no-case rules, including
 * separator precedence over camel case and splitting consecutive capitals.
 * Keep in sync with @payloadcms/drizzle/createTableName.
 */
export function payloadTableName(slug: string): string {
  const unseparate = (value: string) => value.replace(/[\W_]+(.|$)/g, (_, next: string) => next ? ` ${next}` : '')
  let name: string
  if (/\s/.test(slug)) name = slug.toLowerCase()
  else if (/(_|-|\.|:)/.test(slug)) name = (unseparate(slug) || slug).toLowerCase()
  else if (/([a-z][A-Z]|[A-Z][a-z])/.test(slug)) {
    name = slug.replace(/(.)([A-Z]+)/g, (_, previous: string, uppers: string) =>
      `${previous} ${uppers.toLowerCase().split('').join(' ')}`).toLowerCase()
  } else name = slug.toLowerCase()
  return unseparate(name).trim().replace(/\s/g, '_')
}

/** One policy decision per collection and Payload instance, shared by both writes. */
export function createPostgresAtomic({ atomicWrites = 'auto', enableDebugLogs = false }: {
  atomicWrites?: AtomicWrites
  enableDebugLogs?: boolean
} = {}) {
  type Decision = { atomic: boolean; reason: string; loggedAtomic?: boolean; loggedFallback?: boolean; failures: Set<string> }
  const decisions = new WeakMap<BasePayload, Map<CollectionSlug, Decision>>()
  return async (args: Parameters<typeof executePostgresAtomic>[0]) => {
    const { payload, collection } = args
    if (payload.db?.name !== 'postgres') return undefined
    let collections = decisions.get(payload)
    if (!collections) {
      collections = new Map()
      decisions.set(payload, collections)
    }
    if (!collections.has(collection)) {
      const config = payload.collections?.[collection]?.config
      const reasons: string[] = []
      if (atomicWrites === 'never') reasons.push('atomicWrites is never')
      else if (config) {
        if (config.trash) reasons.push('trash is enabled')
        if (config.versions) reasons.push('versions/drafts are enabled')
        if (atomicWrites === 'auto') {
          if (hasHooks(config.hooks)) reasons.push('collection hooks are configured')
          if (hasFieldHooks(config.fields) || hasFieldHooks(config.flattenedFields)) reasons.push('field hooks are configured')
        }
      }
      const atomic = reasons.length === 0
      // Set before logging or awaiting so concurrent calls share the decision.
      const reason = reasons.join('; ') || (atomicWrites === 'always'
        ? 'atomicWrites is always; hooks are bypassed'
        : 'no trash, versions, or update/delete/read hooks')
      collections.set(collection, { atomic, reason, failures: new Set() })
      if (!atomic && atomicWrites !== 'never') {
        for (const refusal of reasons) {
          const guidance = refusal.includes('hooks')
            ? "Review the hooks before opting into adapterConfig.atomicWrites: 'always' to bypass them."
            : "Trash and versions/drafts require Payload's lifecycle operations; 'always' does not bypass this policy."
          console.warn(`[payload-adapter] atomicWrites '${atomicWrites}' on '${collection}' uses the non-atomic Local API path: ${refusal}. ${guidance}`)
        }
      }
    }
    const decision = collections.get(collection)!
    const fallback = (reason: string) => {
      if (enableDebugLogs && !decision.loggedFallback) {
        decision.loggedFallback = true
        console.debug(`[payload-adapter] atomicWrites '${collection}': Local API: ${reason}`)
      }
      return undefined
    }
    if (!decision.atomic) return fallback(decision.reason)
    const unsupported = (reason: string) => {
      const message = `[payload-adapter] atomicWrites '${collection}': cannot run atomically: ${reason}`
      if (!decision.failures.has(reason)) {
        decision.failures.add(reason)
        console.error(`${message}. ${atomicWrites === 'always' ? "atomicWrites 'always' requires atomic execution." : 'Falling back to the Local API; concurrency guarantees are lost.'}`)
      }
      if (atomicWrites === 'always') throw new Error(`${message} (atomicWrites 'always')`)
      return fallback(reason)
    }
    const result = await executePostgresAtomic(args, unsupported)
    if (result !== undefined && enableDebugLogs && !decision.loggedAtomic) {
      decision.loggedAtomic = true
      console.debug(`[payload-adapter] atomicWrites '${collection}': atomic Postgres: ${decision.reason}`)
    }
    return result
  }
}

export const postgresAtomic = createPostgresAtomic()

/**
 * `undefined` means unsupported: use the original Local API fallback. A supported
 * statement returns a Payload-shaped document or null, never a pre-read.
 */
async function executePostgresAtomic({
  payload, collection, where, increment, set, consume = false,
}: {
  payload: BasePayload
  collection: CollectionSlug
  where?: AtomicWhere[]
  increment?: Record<string, number>
  set?: Record<string, unknown>
  consume?: boolean
}, fallback: (reason: string) => undefined): Promise<Record<string, unknown> | null | undefined> {
  const { name, tables, tableNameMap, drizzle } = (payload.db ?? {}) as unknown as PostgresAdapter
  if (name !== 'postgres') return undefined
  if (!drizzle) return fallback('Postgres connection is unavailable')
  const config = payload.collections?.[collection]?.config
  if (!config) return fallback('collection config is unavailable')
  const defaultName = payloadTableName(config.slug)
  const tableName = tableNameMap?.get(defaultName) ?? (typeof config.dbName === 'string' ? config.dbName : undefined)
  const table = tableName === undefined ? undefined : tables?.[tableName]
  if (!table) return fallback('table is missing')

  const columns = getTableColumns(table)
  if (!columns?.id) return fallback('table columns are unavailable')
  const fields: AtomicFields = Object.fromEntries(
    (config.flattenedFields ?? config.fields)
      .filter((field) => 'name' in field && field.name)
      .map((field) => [(field as AtomicField).name, field as AtomicField])
  )
  // Only flat documents can be returned exactly without Payload's join/read pipeline.
  const supportedTypes = new Set(['text', 'textarea', 'email', 'number', 'checkbox', 'date', 'json', 'select', 'radio', 'relationship', 'upload'])
  for (const field of Object.values(fields)) {
    if (isNonStoredField(field)) continue
    if (!supportedTypes.has(field.type) || field.localized || field.hasMany || Array.isArray(field.relationTo) || !columns[field.name]) return fallback(`unsupported field '${field.name}'`)
  }
  const columnFor = (field: string): AnyPgColumn | undefined =>
    Object.hasOwn(columns, field) && (field === 'id' || fields[field] && !isNonStoredField(fields[field]))
      ? columns[field] : undefined
  const predicate = translateAtomicWhere({ where, columnFor, fields })
  if (!predicate) return fallback('untranslatable where')

  const data: Record<string, unknown> = {}
  if (!consume) {
    for (const [field, value] of Object.entries(set ?? {})) {
      if (field === 'id' || !columnFor(field) || value === undefined || !validValue(value, fields[field], true)) return fallback(`unsupported set field/value '${field}'`)
      data[field] = value
    }
    for (const [field, delta] of Object.entries(increment ?? {})) {
      const column = columnFor(field)
      if (!column || field === 'id' || fields[field]?.type !== 'number' || typeof delta !== 'number' || !Number.isFinite(delta)) return fallback(`unsupported increment field/value '${field}'`)
      // Increment wins over `set` for overlapping fields, like the original CAS implementation.
      data[field] = sql`COALESCE(${column}, 0) + ${delta}`
    }
    if (!Object.keys(data).length) return fallback('empty update')
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

// Payload's schema traversal gives join/ui/virtual fields no stored columns.
// Groups/tabs/arrays are different: they contain stored data and still require
// the read pipeline, so they must not be treated as non-stored fields here.
function isNonStoredField(field: AtomicField): boolean {
  return !!field.virtual || field.type === 'join' || field.type === 'ui'
}

// Intentionally stricter than Payload's sanitizeQueryValue: the query builder
// validates primary-key UUIDs, while relationship IDs are passed through. Check
// the real column type here, including custom primary-key types and NIL/MAX.
const uuidPattern = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i
const invalidID = Symbol('invalid ID')
function normalizeID(value: unknown, column: AnyPgColumn, field: string, fields: AtomicFields): unknown {
  if (value === null || !(field === 'id' || ['relationship', 'upload'].includes(fields[field]?.type))) return value
  if (column.columnType === 'PgUUID') return typeof value === 'string' && uuidPattern.test(value) ? value : invalidID
  if (column.dataType === 'number') {
    const number = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
    return Number.isFinite(number) ? number : invalidID
  }
  return value
}

/** Match convertWhereToPayload's connector and NULL semantics exactly. */
export function translateAtomicWhere({ where, columnFor, fields }: {
  where?: AtomicWhere[]
  columnFor: (field: string) => AnyPgColumn | undefined
  fields: AtomicFields
}): SQL | undefined {
  if (!Array.isArray(where) || !where.length) return undefined
  const all: (SQL | undefined)[] = []
  const any: (SQL | undefined)[] = []
  for (const clause of where) {
    const { field, operator = 'eq', connector = 'AND', mode } = clause
    let { value } = clause
    const column = typeof field === 'string' && !field.includes('.') && columnFor(field)
    if (!column || mode && mode !== 'sensitive' || !['AND', 'OR'].includes(connector) || fields[field]?.type === 'json') return undefined
    let condition: SQL | undefined
    if (operator === 'in') {
      if (!Array.isArray(value)) return undefined
      const values: unknown[] = []
      for (const item of value) {
        const normalized = normalizeID(item, column, field, fields)
        if (!scalar(item) && !(typeof item === 'number' && normalized === invalidID)) return undefined
        if (normalized !== null && normalized !== invalidID) values.push(normalized)
      }
      condition = values.length ? inArray(column, values) : sql`false`
      if (value.includes(null)) condition = or(condition, isNull(column))
    } else {
      const normalized = normalizeID(value, column, field, fields)
      // The Better Auth factory coerces malformed serial IDs to NaN before
      // calling us. That is still an ID miss, not an unsupported predicate.
      if (!scalar(value) && !(typeof value === 'number' && normalized === invalidID)) return undefined
      if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(operator)) return undefined
      value = normalized
      // Fail closed for every malformed ID operator, including ne. Payload's
      // invalid PK UUID ne becomes IS NOT NULL; here that would broaden a bad
      // credential guard to every non-null row. Never let an invalid exclusion
      // authorize a write or turn an invalid equality into a nullable FK lookup.
      if (value === invalidID) condition = sql`false`
      else if (operator === 'eq') condition = value === null ? isNull(column) : eq(column, value)
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
