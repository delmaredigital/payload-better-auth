/**
 * One-time data migration for the `supportsArrays` correction in 0.12.0.
 *
 * Releases up to 0.11.3 reported `supportsArrays: false` to Better Auth's adapter
 * factory, so every `string[]` / `number[]` value was `JSON.stringify`'d on its
 * way into Payload. Those columns hold a JSON string where an array belongs.
 *
 * ## Why this can't just read the value back
 *
 * On Postgres the stored shape is invisible through the Local API. Payload writes
 * these to a `jsonb` column, so a stringified value is stored as a *jsonb string*.
 * On read, node-postgres parses the jsonb and hands drizzle a JS string — and
 * drizzle's `PgJsonb.mapFromDriverValue` then runs `JSON.parse` on any string it
 * receives (a guard for drivers that return raw text). That second parse turns the
 * stored string back into an array before Payload ever sees it, so a stringified
 * row and a native one are indistinguishable to `payload.find()`.
 *
 * So on Postgres the census runs in SQL against `jsonb_typeof`, which reports what
 * is actually stored. SQLite and MongoDB don't launder: SQLite stores json as TEXT
 * and drizzle parses it exactly once, MongoDB stores the value as-is, so on those
 * the value Payload returns is faithful and is used directly.
 *
 * When the stored shape cannot be observed, this throws rather than reporting a
 * clean database — "we looked and found nothing" and "we couldn't look" are
 * different facts and must not print the same.
 *
 * @packageDocumentation
 */

import { getAuthTables } from 'better-auth/db'
import type { BetterAuthOptions } from 'better-auth'
import type { BasePayload, CollectionSlug } from 'payload'
import { pluralize } from '../adapter/collections.js'
import { detectDbType } from '../adapter/index.js'

/** How the stored shape was determined for a field. */
export type ObservationMethod =
  /** Read from the database's own type info (Postgres `jsonb_typeof`). */
  | 'stored-shape'
  /** Read from the value Payload returned, which is faithful on this backend. */
  | 'local-api'

/** What the migration did to one collection field. */
export type StringifiedArrayMigration = {
  /** Payload collection slug. */
  collection: string
  /** Payload field name. */
  field: string
  /** Documents examined. */
  scanned: number
  /** Documents holding a stringified array, converted (or that would be, when `dryRun`). */
  converted: number
  /**
   * Documents holding a string that did not parse to an array. Left untouched —
   * the migration never guesses at a value it doesn't recognise.
   */
  skipped: number
  /**
   * How the stored shape was determined. A `converted: 0` only means "clean" in
   * combination with this — see the module docs.
   */
  observedVia: ObservationMethod
}

export type MigrateStringifiedArraysOptions = {
  /** The Payload instance. */
  payload: BasePayload
  /** The same options you pass to `betterAuth()`, so plugin tables are included. */
  betterAuthOptions: BetterAuthOptions
  /** Must match the adapter's setting. Default `true`, as the adapter uses. */
  usePlural?: boolean
  /** Report what would change without writing. Default `false`. */
  dryRun?: boolean
  /** Documents read per page. Default `100`. */
  batchSize?: number
  /** Called once per converted document, for progress output. */
  onProgress?: (progress: { collection: string; field: string; id: string | number }) => void
}

/** Payload's own convention for turning a collection slug into a table name. */
function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

/** Identifiers come from Payload's own maps; refuse anything that isn't a plain one. */
function assertSafeIdentifier(value: string, what: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(
      `[migrateStringifiedArrays] refusing to build SQL with an unexpected ${what}: ${JSON.stringify(value)}`
    )
  }
  return value
}

type DrizzleAdapterish = {
  drizzle?: unknown
  execute?: (args: { drizzle?: unknown; raw?: string }) => Promise<unknown>
  tableNameMap?: Map<string, string>
  tables?: Record<string, Record<string, { name?: string }>>
}

/**
 * Rows whose stored jsonb is a *string*, with the string's contents extracted.
 * `#>> '{}'` returns the scalar's text without the surrounding JSON quoting.
 */
async function censusPostgres(
  payload: BasePayload,
  slug: string,
  field: string
): Promise<Array<{ id: string | number; raw: string }>> {
  const db = payload.db as unknown as DrizzleAdapterish

  if (typeof db.execute !== 'function' || !db.drizzle || !db.tables || !db.tableNameMap) {
    throw new Error(
      `[migrateStringifiedArrays] cannot inspect stored shape on Postgres: the Payload database ` +
        `adapter does not expose drizzle (needed because the ORM parses stored strings into arrays ` +
        `on read, hiding what is actually in the column). Upgrade @payloadcms/db-postgres, or ` +
        `migrate '${slug}.${field}' by hand — see the 0.12.1 CHANGELOG for the SQL.`
    )
  }

  const tableName = db.tableNameMap.get(toSnakeCase(slug))
  const table = tableName ? db.tables[tableName] : undefined
  if (!tableName || !table) {
    throw new Error(
      `[migrateStringifiedArrays] cannot resolve a database table for collection '${slug}'. ` +
        `Reporting it as clean would be a false negative, so refusing to continue.`
    )
  }

  // The drizzle column knows its real database name; fall back to Payload's convention.
  const columnName = table[field]?.name ?? toSnakeCase(field)

  const t = assertSafeIdentifier(tableName, 'table name')
  const c = assertSafeIdentifier(columnName, 'column name')

  const result = (await db.execute({
    drizzle: db.drizzle,
    raw: `SELECT "id", "${c}" #>> '{}' AS "__raw" FROM "${t}" WHERE jsonb_typeof("${c}") = 'string'`,
  })) as { rows?: Array<{ id: string | number; __raw: string }> } | Array<{ id: string | number; __raw: string }>

  const rows = Array.isArray(result) ? result : (result?.rows ?? [])
  return rows.map((r) => ({ id: r.id, raw: r.__raw }))
}

/**
 * Convert every stringified `string[]` / `number[]` column written by an earlier
 * release into a real array.
 *
 * Safe to run more than once: a value that is already an array is left alone, so a
 * second run reports `converted: 0`. Run it once, after upgrading and before
 * serving traffic.
 *
 * Read `observedVia` on each result alongside `converted`. On Postgres it must say
 * `stored-shape`; a `converted: 0` from the Local API on Postgres would be a false
 * negative, which is why this throws instead of producing one.
 *
 * ```ts
 * import { migrateStringifiedArrays } from '@delmaredigital/payload-better-auth'
 *
 * const results = await migrateStringifiedArrays({
 *   payload,
 *   betterAuthOptions,
 *   dryRun: true, // drop this once the report looks right
 * })
 * console.table(results)
 * ```
 */
export async function migrateStringifiedArrays({
  payload,
  betterAuthOptions,
  usePlural = true,
  dryRun = false,
  batchSize = 100,
  onProgress,
}: MigrateStringifiedArraysOptions): Promise<StringifiedArrayMigration[]> {
  const tables = getAuthTables(betterAuthOptions)
  const dbType = detectDbType(payload)
  // Only Postgres launders the stored shape on read. SQLite parses TEXT json exactly
  // once and MongoDB stores the value verbatim, so there the Local API is faithful.
  const observedVia: ObservationMethod = dbType === 'postgres' ? 'stored-shape' : 'local-api'

  const results: StringifiedArrayMigration[] = []

  for (const [modelKey, table] of Object.entries(tables)) {
    const baseName = table.modelName ?? modelKey
    const slug = (usePlural ? pluralize(baseName) : baseName) as CollectionSlug

    const arrayFields = Object.entries(table.fields)
      .filter(([, def]) => def.type === 'string[]' || def.type === 'number[]')
      .map(([fieldKey, def]) => def.fieldName ?? fieldKey)

    if (arrayFields.length === 0) continue

    // A collection the consumer skipped (or hasn't generated) has nothing of ours in it.
    if (!payload.collections?.[slug]) continue

    for (const field of arrayFields) {
      const result: StringifiedArrayMigration = {
        collection: slug,
        field,
        scanned: 0,
        converted: 0,
        skipped: 0,
        observedVia,
      }

      const convert = async (id: string | number, raw: string) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          result.skipped++
          return
        }
        if (!Array.isArray(parsed)) {
          result.skipped++
          return
        }

        result.converted++
        onProgress?.({ collection: slug, field, id })

        if (!dryRun) {
          await payload.update({
            collection: slug,
            id,
            data: { [field]: parsed },
            depth: 0,
            overrideAccess: true,
          })
        }
      }

      if (observedVia === 'stored-shape') {
        const total = await payload.count({ collection: slug, overrideAccess: true })
        result.scanned = total.totalDocs

        for (const { id, raw } of await censusPostgres(payload, slug, field)) {
          await convert(id, raw)
        }
      } else {
        let page = 1
        let hasNextPage = true

        while (hasNextPage) {
          const { docs, hasNextPage: more } = await payload.find({
            collection: slug,
            limit: batchSize,
            page,
            depth: 0,
            sort: 'id',
            overrideAccess: true,
            pagination: true,
          })

          for (const doc of docs as Array<Record<string, unknown> & { id: string | number }>) {
            result.scanned++
            const value = doc[field]
            if (typeof value === 'string') await convert(doc.id, value)
          }

          hasNextPage = more
          page++
        }
      }

      results.push(result)
    }
  }

  return results
}
