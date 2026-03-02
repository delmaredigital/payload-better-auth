/**
 * Payload CMS Adapter for Better Auth
 *
 * Uses Better Auth's createAdapterFactory for schema-aware transformations,
 * eliminating hardcoded field mappings and supporting all Better Auth plugins.
 *
 * @packageDocumentation
 */

import {
  createAdapterFactory,
  type AdapterFactoryConfig,
  type CustomAdapter,
} from 'better-auth/adapters'
import type { DBAdapter, BetterAuthOptions } from 'better-auth'
import type {
  BasePayload,
  Where as PayloadWhere,
  CollectionSlug,
} from 'payload'

/**
 * Database types supported by Payload CMS.
 */
export type DbType = 'postgres' | 'mongodb' | 'sqlite'

/**
 * Detect the database type from the Payload instance.
 */
export function detectDbType(payload: BasePayload): DbType {
  const dbName = (payload.db as unknown as Record<string, unknown>)?.name
  if (typeof dbName === 'string') {
    if (dbName.includes('mongo') || dbName.includes('mongoose')) return 'mongodb'
    if (dbName.includes('sqlite')) return 'sqlite'
  }
  return 'postgres'
}

/**
 * Determine ID type based on database type and Better Auth config.
 * MongoDB always uses text IDs (ObjectId strings).
 * Postgres defaults to 'number' (SERIAL) unless generateId indicates otherwise.
 */
export function resolveIdType(dbType: DbType, options: BetterAuthOptions, explicitIdType?: 'number' | 'text'): 'number' | 'text' {
  if (dbType === 'mongodb') return 'text'
  if (explicitIdType) return explicitIdType
  const generateId = options.advanced?.database?.generateId
  if (generateId !== undefined && generateId !== 'serial') {
    return 'text'
  }
  return 'number'
}

export type PayloadAdapterConfig = {
  /**
   * The Payload instance or a function that returns it.
   * Use a function for lazy initialization to avoid circular dependencies.
   */
  payloadClient: BasePayload | (() => Promise<BasePayload>)

  /**
   * Adapter configuration options
   */
  adapterConfig?: {
    /**
     * Enable debug logging for troubleshooting
     */
    enableDebugLogs?: boolean

    /**
     * Database type. Auto-detected from Payload's database adapter if not set.
     * Set explicitly if auto-detection doesn't work for your adapter.
     */
    dbType?: DbType

    /**
     * ID type used by Payload.
     * If not specified, auto-detects from Better Auth's generateId setting.
     * - 'number' for SERIAL/auto-increment (Payload default)
     * - 'text' for UUID
     */
    idType?: 'number' | 'text'
  }
}

/**
 * Creates a Better Auth adapter that uses Payload CMS as the database.
 *
 * Uses Better Auth's createAdapterFactory for proper schema-aware transformations,
 * automatically supporting all Better Auth plugins without hardcoded field mappings.
 *
 * @example Basic usage
 * ```ts
 * import { payloadAdapter } from '@delmaredigital/payload-better-auth/adapter'
 *
 * const auth = betterAuth({
 *   database: payloadAdapter({
 *     payloadClient: payload,
 *   }),
 *   // For serial IDs (Payload default), configure Better Auth:
 *   advanced: {
 *     database: {
 *       generateId: 'serial',
 *     },
 *   },
 * })
 * ```
 *
 * @example Custom collection names
 * ```ts
 * const auth = betterAuth({
 *   database: payloadAdapter({ payloadClient: payload }),
 *   // Use BetterAuthOptions to customize collection names.
 *   // Provide SINGULAR names - they get pluralized automatically:
 *   user: { modelName: 'member' },         // → 'members' collection
 *   session: { modelName: 'auth_session' }, // → 'auth_sessions' collection
 * })
 * ```
 */
export function payloadAdapter({
  payloadClient,
  adapterConfig = {},
}: PayloadAdapterConfig): (options: BetterAuthOptions) => DBAdapter {
  const { enableDebugLogs = false } = adapterConfig

  // Resolve payload client (supports lazy initialization)
  async function resolvePayloadClient(): Promise<BasePayload> {
    return typeof payloadClient === 'function'
      ? await payloadClient()
      : payloadClient
  }


  function convertOperator(
    operator: string,
    value: unknown,
    dbType: DbType
  ): Record<string, unknown> {
    switch (operator) {
      case 'eq':
        return { equals: value }
      case 'ne':
        return { not_equals: value }
      case 'gt':
        return { greater_than: value }
      case 'gte':
        return { greater_than_equal: value }
      case 'lt':
        return { less_than: value }
      case 'lte':
        return { less_than_equal: value }
      case 'in':
        return { in: value }
      case 'not_in':
        return { not_in: value }
      case 'contains':
        return { contains: value }
      case 'starts_with':
        if (dbType === 'mongodb') return { contains: value }
        return { like: `${value}%` }
      case 'ends_with':
        if (dbType === 'mongodb') return { contains: value }
        return { like: `%${value}` }
      default:
        return { equals: value }
    }
  }

  /**
   * Extract single ID from where clause for optimization
   */
  function extractSingleId(
    where: Array<{ field: string; value: unknown; operator: string }>
  ): string | number | null {
    if (where.length !== 1) return null
    const w = where[0]
    if (w.field === 'id' && w.operator === 'eq') {
      const value = w.value
      if (typeof value === 'string' || typeof value === 'number') {
        return value
      }
    }
    return null
  }

  // Return the adapter factory function
  return (options: BetterAuthOptions): DBAdapter => {
    // Determine ID type based on database type
    // If payloadClient is already resolved, detect dbType immediately
    // Otherwise default to 'postgres' (will be updated on first operation)
    const effectiveDbType = adapterConfig.dbType
      ?? (typeof payloadClient !== 'function' ? detectDbType(payloadClient) : 'postgres')
    const idType = resolveIdType(effectiveDbType, options, adapterConfig.idType)
    const generateId = options.advanced?.database?.generateId

    // Warn if using number IDs but Better Auth is explicitly configured to generate its own IDs
    // This would cause Better Auth to generate UUIDs which won't work with SERIAL columns
    // Don't warn if generateId is undefined - that's the expected default case
    if (idType === 'number' && generateId !== undefined && generateId !== 'serial') {
      console.warn(
        '[payload-adapter] Warning: Using SERIAL (number) IDs but `generateId` is set to a non-serial value. ' +
          'Either set `advanced: { database: { generateId: "serial" } }` to let Payload generate IDs, ' +
          'or set `adapterConfig: { idType: "text" }` if using UUIDs.'
      )
    }

    // Warn if modelName appears to be already plural (ends with 's')
    // With usePlural: true, providing 'users' would become 'userss'
    const coreModels = ['user', 'session', 'account', 'verification'] as const
    for (const model of coreModels) {
      const modelName = options[model]?.modelName
      if (modelName && modelName.endsWith('s')) {
        console.warn(
          `[payload-adapter] Warning: modelName '${modelName}' for '${model}' appears to be plural. ` +
            `Use singular form (e.g., '${modelName.slice(0, -1)}') - it gets pluralized automatically. ` +
            `Using plural names will result in double-pluralization (e.g., '${modelName}s').`
        )
      }
    }

    // Create adapter config for createAdapterFactory
    const factoryConfig: AdapterFactoryConfig = {
      adapterId: 'payload-adapter',
      adapterName: 'Payload CMS Adapter',
      // Payload collections are plural by default (users, sessions, etc.)
      // Users can customize via BetterAuthOptions: user: { modelName: 'custom_users' }
      usePlural: true,
      // Payload always generates IDs (SERIAL for postgres/sqlite, ObjectId for mongodb)
      disableIdGeneration: true,
      // MongoDB uses ObjectId strings, not numeric IDs
      supportsNumericIds: effectiveDbType !== 'mongodb',
      // Payload returns dates as ISO strings via its Local API, not Date objects.
      // Setting false tells the factory to convert string dates ↔ Date objects.
      supportsDates: false,
      supportsBooleans: true,
      supportsJSON: true,
      supportsArrays: false,
      // Payload doesn't expose transaction API at collection level
      transaction: false,
      // Enable debug logs if configured
      debugLogs: enableDebugLogs,
    }

    // We need to resolve the payload client before creating the adapter
    // The factory pattern requires we return an adapter synchronously,
    // so we'll resolve it lazily on first operation
    let resolvedPayload: BasePayload | null = null
    let resolvePromise: Promise<BasePayload> | null = null
    let resolvedDbType: DbType | null = adapterConfig.dbType ?? null

    const getPayload = async (): Promise<BasePayload> => {
      if (resolvedPayload) return resolvedPayload
      if (!resolvePromise) {
        resolvePromise = resolvePayloadClient().then((p) => {
          resolvedPayload = p
          if (!resolvedDbType) {
            resolvedDbType = detectDbType(p)
            if (enableDebugLogs) {
              console.log('[payload-adapter] Detected database type:', resolvedDbType)
            }
          }
          return p
        })
      }
      return resolvePromise
    }

    // Create the adapter using createAdapterFactory
    // The factory handles all schema-aware transformations for us
    const adapterFactory = createAdapterFactory({
      config: factoryConfig,
      adapter: ({
        schema,
        getModelName,
        debugLog,
      }) => {
        // Set fieldName on reference fields so the factory maps userId→user, etc.
        // Payload uses relationship fields without the Id suffix.
        for (const table of Object.values(schema)) {
          for (const [fieldKey, fieldDef] of Object.entries(table.fields)) {
            if (fieldDef.references) {
              const stripped = fieldKey.replace(/(_id|Id)$/, '');
              if (stripped !== fieldKey) fieldDef.fieldName = stripped;
            }
          }
        }

        // Log initialization
        if (enableDebugLogs) {
          debugLog('Adapter initialized', {
            idType,
            schema: Object.keys(schema),
          })
        }

        /**
         * Convert Better Auth where clause to Payload where clause.
         * The factory already handles field name transforms, so we just
         * convert to Payload's unique where format.
         */
        function convertWhereToPayload(
          where: Array<{
            field: string
            value: unknown
            operator: string
            connector?: string
          }>
        ): PayloadWhere {
          if (!where || where.length === 0) return {}

          if (where.length === 1) {
            const w = where[0]
            return {
              [w.field]: convertOperator(w.operator, w.value, resolvedDbType ?? 'postgres'),
            }
          }

          const andConditions = where.filter((w) => w.connector !== 'OR')
          const orConditions = where.filter((w) => w.connector === 'OR')

          const result: PayloadWhere = {}

          if (andConditions.length > 0) {
            result.and = andConditions.map((w) => ({
              [w.field]: convertOperator(w.operator, w.value, resolvedDbType ?? 'postgres'),
            }))
          }

          if (orConditions.length > 0) {
            result.or = orConditions.map((w) => ({
              [w.field]: convertOperator(w.operator, w.value, resolvedDbType ?? 'postgres'),
            }))
          }

          return result
        }

        // Get Payload collection slug from model name
        // Uses factory's getModelName which respects BetterAuthOptions.modelName config
        const getCollection = (model: string): CollectionSlug => {
          return getModelName(model) as CollectionSlug
        }

        // The CustomAdapter interface uses generics (T) for return types.
        // Payload returns concrete types (JsonObject & TypeWithID).
        // We cast at the interface boundary - this is standard practice
        // when implementing generic interfaces with concrete implementations.
        // The official Better Auth adapters do the same (visible in compiled .mjs).
        return {
          create: async ({ model, data }) => {
            const payload = await getPayload()
            const collection = getCollection(model)

            if (enableDebugLogs) {
              debugLog('create', { collection, model, data })
            }

            try {
              const result = await payload.create({
                collection,
                data: data as Record<string, unknown>,
                depth: 0,
                // Bypass access control - Better Auth handles its own auth
                overrideAccess: true,
              })
              // Merge with input data for Better Auth
              // Database result takes precedence (handles hooks that modify data like firstUserAdmin)
              const merged = { ...data, ...result }
              if (enableDebugLogs) {
                debugLog('create result', { collection, resultId: (result as Record<string, unknown>).id, mergedKeys: Object.keys(merged as Record<string, unknown>) })
              }
              return merged as typeof data
            } catch (error) {
              console.error('[payload-adapter] create failed:', {
                collection,
                model,
                error: error instanceof Error ? error.message : error,
              })
              throw error
            }
          },

          findOne: async ({ model, where, select, join }) => {
            const payload = await getPayload()
            const collection = getCollection(model)

            if (enableDebugLogs) {
              debugLog('findOne', { collection, model, where, join })
            }

            try {
              // Optimize for single ID queries
              const id = extractSingleId(where)
              if (id !== null) {
                try {
                  const result = await payload.findByID({
                    collection,
                    id,
                    depth: join ? 1 : 0,
                    overrideAccess: true,
                  })
                  if (enableDebugLogs) {
                    debugLog('findOne result (byID)', { collection, id, found: true })
                  }
                  return result
                } catch (error) {
                  if (
                    error instanceof Error &&
                    'status' in error &&
                    (error as Error & { status: number }).status === 404
                  ) {
                    if (enableDebugLogs) {
                      debugLog('findOne result (byID)', { collection, id, found: false })
                    }
                    return null
                  }
                  throw error
                }
              }

              const payloadWhere = convertWhereToPayload(where)

              if (enableDebugLogs) {
                debugLog('findOne query', { collection, payloadWhere: JSON.stringify(payloadWhere), resolvedDbType, idType })
              }

              const result = await payload.find({
                collection,
                where: payloadWhere,
                limit: 1,
                depth: join ? 1 : 0,
                overrideAccess: true,
              })

              if (enableDebugLogs) {
                debugLog('findOne result', { collection, totalDocs: result.totalDocs, found: result.docs.length > 0 })
              }

              if (!result.docs[0]) return null
              return result.docs[0]
            } catch (error) {
              console.error('[payload-adapter] findOne failed:', {
                model,
                where,
                error,
              })
              throw error
            }
          },

          findMany: async ({ model, where, limit, offset, sortBy, join }) => {
            const payload = await getPayload()
            const collection = getCollection(model)

            if (enableDebugLogs) {
              debugLog('findMany', {
                collection,
                model,
                where,
                limit,
                offset,
                sortBy,
              })
            }

            const payloadWhere = where ? convertWhereToPayload(where) : {}

            const result = await payload.find({
              collection,
              where: payloadWhere,
              limit: limit ?? 100,
              page: offset ? Math.floor(offset / (limit ?? 100)) + 1 : 1,
              sort: sortBy
                ? `${sortBy.direction === 'desc' ? '-' : ''}${sortBy.field}`
                : undefined,
              depth: join ? 1 : 0,
              overrideAccess: true,
            })

            return result.docs
          },

          update: async ({ model, where, update: data }) => {
            const payload = await getPayload()
            const collection = getCollection(model)

            if (enableDebugLogs) {
              debugLog('update', { collection, model, where, data })
            }

            // Optimize for single ID queries
            const id = extractSingleId(where)
            if (id !== null) {
              const result = await payload.update({
                collection,
                id,
                data: data as Record<string, unknown>,
                depth: 0,
                overrideAccess: true,
              })
              return { ...data, ...result } as typeof data
            }

            const payloadWhere = convertWhereToPayload(where)
            const result = await payload.update({
              collection,
              where: payloadWhere,
              data: data as Record<string, unknown>,
              depth: 0,
              overrideAccess: true,
            })

            if (!result.docs[0]) return null
            return { ...data, ...result.docs[0] } as typeof data
          },

          updateMany: async ({ model, where, update: data }) => {
            const payload = await getPayload()
            const collection = getCollection(model)

            if (enableDebugLogs) {
              debugLog('updateMany', { collection, model, where, data })
            }

            const payloadWhere = convertWhereToPayload(where)

            const result = await payload.update({
              collection,
              where: payloadWhere,
              data: data as Record<string, unknown>,
              depth: 0,
              overrideAccess: true,
            })

            return result.docs.length
          },

          delete: async ({ model, where }) => {
            const payload = await getPayload()
            const collection = getCollection(model)

            if (enableDebugLogs) {
              debugLog('delete', { collection, model, where })
            }

            // Optimize for single ID queries
            const id = extractSingleId(where)
            if (id !== null) {
              await payload.delete({
                collection,
                id,
                overrideAccess: true,
              })
              return
            }

            const payloadWhere = convertWhereToPayload(where)
            await payload.delete({ collection, where: payloadWhere, overrideAccess: true })
          },

          deleteMany: async ({ model, where }) => {
            const payload = await getPayload()
            const collection = getCollection(model)

            if (enableDebugLogs) {
              debugLog('deleteMany', { collection, model, where })
            }

            const payloadWhere = convertWhereToPayload(where)

            const result = await payload.delete({
              collection,
              where: payloadWhere,
              overrideAccess: true,
            })

            return result.docs.length
          },

          count: async ({ model, where }) => {
            const payload = await getPayload()
            const collection = getCollection(model)

            if (enableDebugLogs) {
              debugLog('count', { collection, model, where })
            }

            const payloadWhere = where ? convertWhereToPayload(where) : {}

            const result = await payload.count({
              collection,
              where: payloadWhere,
              overrideAccess: true,
            })

            return result.totalDocs
          },
        } as CustomAdapter
      },
    })

    return adapterFactory(options)
  }
}

export type { DBAdapter, BetterAuthOptions }
