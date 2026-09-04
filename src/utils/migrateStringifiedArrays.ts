/**
 * One-time data migration for the `supportsArrays` correction in 0.12.0.
 *
 * Releases up to 0.11.3 reported `supportsArrays: false` to Better Auth's adapter
 * factory, so every `string[]` / `number[]` value was `JSON.stringify`'d on its way
 * into Payload. Those columns hold `'["a","b"]'` where an array belongs. From
 * 0.12.0 the adapter stores arrays natively, and Better Auth reads them back as
 * arrays — so rows written by an earlier release need converting once.
 *
 * Which fields those are comes from the Better Auth schema rather than a
 * hardcoded list, so this covers whatever plugins you actually run. In practice
 * every array-typed field in Better Auth today belongs to the oauth-provider
 * plugin (`redirectUris`, `scopes`, `grantTypes`, `responseTypes`, `contacts`,
 * `resources`, `requestedUserInfoClaims`, `allowedScopes`).
 *
 * @packageDocumentation
 */

import { getAuthTables } from 'better-auth/db'
import type { BetterAuthOptions } from 'better-auth'
import type { BasePayload, CollectionSlug } from 'payload'
import { pluralize } from '../adapter/collections.js'

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
   * Documents holding a string that did not parse to an array. These are left
   * untouched — the migration never guesses at a value it doesn't recognise.
   */
  skipped: number
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

/**
 * Convert every stringified `string[]` / `number[]` column written by an earlier
 * release into a real array.
 *
 * Safe to run more than once: a value that is already an array is left alone, so
 * a second run reports `converted: 0`. Run it once, after upgrading to 0.12.0 and
 * before serving traffic.
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
  const results: StringifiedArrayMigration[] = []

  for (const [modelKey, table] of Object.entries(tables)) {
    const baseName = table.modelName ?? modelKey
    const slug = (usePlural ? pluralize(baseName) : baseName) as CollectionSlug

    const arrayFields = Object.entries(table.fields)
      .filter(([, def]) => def.type === 'string[]' || def.type === 'number[]')
      .map(([fieldKey, def]) => def.fieldName ?? fieldKey)

    if (arrayFields.length === 0) continue

    // A collection the consumer skipped (or hasn't generated yet) isn't an error —
    // there's simply nothing of ours in it to migrate.
    if (!payload.collections?.[slug]) continue

    for (const field of arrayFields) {
      const result: StringifiedArrayMigration = {
        collection: slug,
        field,
        scanned: 0,
        converted: 0,
        skipped: 0,
      }

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
          if (typeof value !== 'string') continue

          let parsed: unknown
          try {
            parsed = JSON.parse(value)
          } catch {
            result.skipped++
            continue
          }

          if (!Array.isArray(parsed)) {
            result.skipped++
            continue
          }

          result.converted++
          onProgress?.({ collection: slug, field, id: doc.id })

          if (!dryRun) {
            await payload.update({
              collection: slug,
              id: doc.id,
              data: { [field]: parsed },
              depth: 0,
              overrideAccess: true,
            })
          }
        }

        hasNextPage = more
        page++
      }

      results.push(result)
    }
  }

  return results
}
