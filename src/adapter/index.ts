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
import type { Adapter, BetterAuthOptions } from 'better-auth'
import type {
  BasePayload,
  Where as PayloadWhere,
  CollectionSlug,
} from 'payload'


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
     * ID type used by Payload.
     * If not specified, auto-detects from Better Auth's generateId setting.
     * - 'number' for SERIAL/auto-increment (Payload default)
     * - 'text' for UUID
     */
    idType?: 'number' | 'text'

    /**
     * Additional fields to convert to numeric IDs beyond the *Id heuristic.
     * Use when you have ID fields that don't follow the naming convention.
     * @example ['customOrgRef', 'legacyIdentifier']
     */
    idFieldsAllowlist?: string[]

    /**
     * Fields to exclude from numeric ID conversion.
     * Use when a field ends in 'Id' but isn't actually an ID reference.
     * @example ['visitorId', 'correlationId']
     */
    idFieldsBlocklist?: string[]
  }
}

/**
 * Detect ID type from Better Auth options.
 * Defaults to 'number' (SERIAL) since Payload uses SERIAL IDs by default.
 */
function detectIdType(options: BetterAuthOptions): 'number' | 'text' {
  const generateId = options.advanced?.database?.generateId
  // If explicitly set to something other than 'serial', use text (UUID)
  if (generateId !== undefined && generateId !== 'serial') {
    return 'text'
  }
  // Default to number (SERIAL) - Payload's default
  return 'number'
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
}: PayloadAdapterConfig): (options: BetterAuthOptions) => Adapter {
  const { enableDebugLogs = false, idFieldsAllowlist = [], idFieldsBlocklist = [] } = adapterConfig
  const idFieldsAllowlistSet = new Set(idFieldsAllowlist)
  const idFieldsBlocklistSet = new Set(idFieldsBlocklist)

  // Resolve payload client (supports lazy initialization)
  async function resolvePayloadClient(): Promise<BasePayload> {
    return typeof payloadClient === 'function'
      ? await payloadClient()
      : payloadClient
  }


  function convertOperator(
    operator: string,
    value: unknown
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
      case 'contains':
        return { contains: value }
      case 'starts_with':
        return { like: `${value}%` }
      case 'ends_with':
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
  return (options: BetterAuthOptions): Adapter => {
    // Determine ID type: explicit config > auto-detect
    // Defaults to 'number' (SERIAL) since Payload uses SERIAL IDs by default
    const idType = adapterConfig.idType ?? detectIdType(options)
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
      // Let Payload generate IDs when using serial/auto-increment
      disableIdGeneration: idType === 'number',
      // Payload supports these features
      supportsNumericIds: true,
      supportsDates: true,
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

    const getPayload = async (): Promise<BasePayload> => {
      if (resolvedPayload) return resolvedPayload
      if (!resolvePromise) {
        resolvePromise = resolvePayloadClient().then((p) => {
          resolvedPayload = p
          return p
        })
      }
      return resolvePromise
    }

    // Helper to convert ID based on type
    const convertId = (id: string | number): string | number => {
      if (idType === 'number' && typeof id === 'string') {
        const num = parseInt(id, 10)
        return isNaN(num) ? id : num
      }
      if (idType === 'text' && typeof id === 'number') {
        return String(id)
      }
      return id
    }

    // Create the adapter using createAdapterFactory
    // The factory handles all schema-aware transformations for us
    const adapterFactory = createAdapterFactory({
      config: factoryConfig,
      adapter: ({
        schema,
        getModelName,
        getFieldName,
        debugLog,
      }) => {
        // Log initialization
        if (enableDebugLogs) {
          debugLog('Adapter initialized', {
            idType,
            schema: Object.keys(schema),
          })
        }

        /**
         * Get the schema for a model, handling plural/singular lookups.
         * Better Auth queries with plural names when usePlural is true,
         * but schema keys are singular.
         */
        function getModelSchema(model: string) {
          // First try direct lookup
          if (schema[model]) return schema[model]

          // Try singular form (strip trailing 's') for plural model names
          const singular = model.endsWith('s') ? model.slice(0, -1) : model
          if (schema[singular]) return schema[singular]

          // Try without 'ies' → 'y' conversion (e.g., 'verifications' → 'verification')
          // This handles edge cases but 'verifications' → 'verification' works with simple 's' strip

          return undefined
        }

        /**
         * Transform a Better Auth field name to a Payload field name.
         *
         * For reference fields (those with `references` in schema), Payload collections
         * use the field name without the `Id`/`_id` suffix (e.g., `userId` → `user`).
         * This matches how betterAuthCollections() generates relationship fields.
         */
        function getPayloadFieldName(model: string, field: string): string {
          // First apply any custom field name mappings from BetterAuthOptions
          const mappedField = getFieldName({ model, field })

          // Check if this field is a reference field in the schema
          const modelSchema = getModelSchema(model)

          if (modelSchema?.fields?.[field]?.references) {
            // Strip _id or Id suffix for reference fields
            // This matches betterAuthCollections() which does: fieldName.replace(/(_id|Id)$/, '')
            return mappedField.replace(/(_id|Id)$/, '')
          }

          return mappedField
        }

        /**
         * Transform input data from Better Auth format to Payload format.
         * Converts reference field names (e.g., `userId` → `user`) and
         * converts reference field values to the correct ID type.
         */
        function transformDataForPayload(
          model: string,
          data: Record<string, unknown>
        ): Record<string, unknown> {
          const modelSchema = getModelSchema(model)
          if (!modelSchema?.fields) return data

          const transformed: Record<string, unknown> = {}

          for (const [key, value] of Object.entries(data)) {
            const payloadKey = getPayloadFieldName(model, key)
            let transformedValue = value

            // If this is a reference field, convert the ID to the correct type
            const fieldDef = modelSchema.fields[key]
            if (fieldDef?.references && value !== null && value !== undefined) {
              // Convert reference ID to the correct type (number for SERIAL, string for UUID)
              if (idType === 'number' && typeof value === 'string') {
                const numValue = parseInt(value as string, 10)
                if (!isNaN(numValue)) {
                  transformedValue = numValue
                }
              } else if (idType === 'text' && typeof value === 'number') {
                transformedValue = String(value)
              }
            }

            transformed[payloadKey] = transformedValue
          }

          if (enableDebugLogs) {
            console.log('[payload-adapter] transformDataForPayload:', {
              model,
              inputKeys: Object.keys(data),
              outputKeys: Object.keys(transformed),
              transformedData: transformed,
            })
          }

          return transformed
        }

        /**
         * Transform output data from Payload format to Better Auth format.
         * Converts reference field names back (e.g., `user` → `userId`).
         */
        function transformDataFromPayload(
          model: string,
          data: Record<string, unknown>
        ): Record<string, unknown> {
          const modelSchema = getModelSchema(model)
          if (!modelSchema?.fields || !data) return data

          const transformed: Record<string, unknown> = { ...data }

          // For each field in the schema that has references,
          // check if Payload returned the stripped name and map it back
          for (const [fieldKey, fieldDef] of Object.entries(modelSchema.fields)) {
            if ((fieldDef as { references?: unknown }).references) {
              const payloadFieldName = fieldKey.replace(/(_id|Id)$/, '')
              if (payloadFieldName in data && !(fieldKey in transformed)) {
                transformed[fieldKey] = data[payloadFieldName]
                // Keep both for compatibility - Better Auth expects userId
              }
            }
            // Convert date strings to Date objects based on schema type
            // Better Auth expects Date objects for expiresAt comparisons
            if (
              fieldDef.type === 'date' &&
              fieldKey in transformed &&
              typeof transformed[fieldKey] === 'string'
            ) {
              const dateValue = new Date(transformed[fieldKey] as string)
              if (!isNaN(dateValue.getTime())) {
                transformed[fieldKey] = dateValue
              }
            }
          }

          // Convert semantic ID fields to numbers when using serial IDs
          // Heuristic: fields ending in 'Id' or '_id' containing numeric strings
          // Modified by allowlist (add) and blocklist (exclude)
          if (idType === 'number') {
            for (const [key, value] of Object.entries(transformed)) {
              // Skip if not a string or already processed as a reference
              if (typeof value !== 'string') continue

              // Check if field should be converted
              const matchesHeuristic = /(?:Id|_id)$/.test(key)
              const inAllowlist = idFieldsAllowlistSet.has(key)
              const inBlocklist = idFieldsBlocklistSet.has(key)

              if ((matchesHeuristic || inAllowlist) && !inBlocklist) {
                // Only convert if it's a pure numeric string
                if (/^\d+$/.test(value)) {
                  transformed[key] = parseInt(value, 10)
                }
              }
            }
          }

          return transformed
        }

        /**
         * Convert Better Auth where clause to Payload where clause.
         * Handles field name transformations for reference fields.
         */
        function convertWhereToPayload(
          model: string,
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
              [getPayloadFieldName(model, w.field)]: convertOperator(w.operator, w.value),
            }
          }

          const andConditions = where.filter((w) => w.connector !== 'OR')
          const orConditions = where.filter((w) => w.connector === 'OR')

          const result: PayloadWhere = {}

          if (andConditions.length > 0) {
            result.and = andConditions.map((w) => ({
              [getPayloadFieldName(model, w.field)]: convertOperator(w.operator, w.value),
            }))
          }

          if (orConditions.length > 0) {
            result.or = orConditions.map((w) => ({
              [getPayloadFieldName(model, w.field)]: convertOperator(w.operator, w.value),
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
            const payloadData = transformDataForPayload(model, data as Record<string, unknown>)

            if (enableDebugLogs) {
              debugLog('create', { collection, model, data, payloadData })
            }

            try {
              const result = await payload.create({
                collection,
                data: payloadData,
                depth: 0,
                // Bypass access control - Better Auth handles its own auth
                overrideAccess: true,
              })
              // Transform back and merge with input data for Better Auth
              // Database result takes precedence (handles hooks that modify data like firstUserAdmin)
              const transformed = transformDataFromPayload(model, result as Record<string, unknown>)
              return { ...data, ...transformed } as typeof data
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
                    id: convertId(id),
                    depth: join ? 1 : 0,
                    overrideAccess: true,
                  })
                  return transformDataFromPayload(model, result as Record<string, unknown>)
                } catch (error) {
                  if (
                    error instanceof Error &&
                    'status' in error &&
                    (error as Error & { status: number }).status === 404
                  ) {
                    return null
                  }
                  throw error
                }
              }

              const payloadWhere = convertWhereToPayload(model, where)
              const result = await payload.find({
                collection,
                where: payloadWhere,
                limit: 1,
                depth: join ? 1 : 0,
                overrideAccess: true,
              })

              if (!result.docs[0]) return null
              return transformDataFromPayload(model, result.docs[0] as Record<string, unknown>)
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

            const payloadWhere = where ? convertWhereToPayload(model, where) : {}

            const result = await payload.find({
              collection,
              where: payloadWhere,
              limit: limit ?? 100,
              page: offset ? Math.floor(offset / (limit ?? 100)) + 1 : 1,
              sort: sortBy
                ? `${sortBy.direction === 'desc' ? '-' : ''}${getPayloadFieldName(model, sortBy.field)}`
                : undefined,
              depth: join ? 1 : 0,
              overrideAccess: true,
            })

            return result.docs.map((doc) =>
              transformDataFromPayload(model, doc as Record<string, unknown>)
            )
          },

          update: async ({ model, where, update: data }) => {
            const payload = await getPayload()
            const collection = getCollection(model)
            const payloadData = transformDataForPayload(model, data as Record<string, unknown>)

            if (enableDebugLogs) {
              debugLog('update', { collection, model, where, data, payloadData })
            }

            // Optimize for single ID queries
            const id = extractSingleId(where)
            if (id !== null) {
              const result = await payload.update({
                collection,
                id: convertId(id),
                data: payloadData,
                depth: 0,
                overrideAccess: true,
              })
              const transformed = transformDataFromPayload(model, result as Record<string, unknown>)
              return { ...data, ...transformed } as typeof data
            }

            const payloadWhere = convertWhereToPayload(model, where)
            const result = await payload.update({
              collection,
              where: payloadWhere,
              data: payloadData,
              depth: 0,
              overrideAccess: true,
            })

            if (!result.docs[0]) return null
            const transformed = transformDataFromPayload(model, result.docs[0] as Record<string, unknown>)
            return { ...data, ...transformed } as typeof data
          },

          updateMany: async ({ model, where, update: data }) => {
            const payload = await getPayload()
            const collection = getCollection(model)
            const payloadData = transformDataForPayload(model, data as Record<string, unknown>)

            if (enableDebugLogs) {
              debugLog('updateMany', { collection, model, where, data, payloadData })
            }

            const payloadWhere = convertWhereToPayload(model, where)

            const result = await payload.update({
              collection,
              where: payloadWhere,
              data: payloadData,
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
                id: convertId(id),
                overrideAccess: true,
              })
              return
            }

            const payloadWhere = convertWhereToPayload(model, where)
            await payload.delete({ collection, where: payloadWhere, overrideAccess: true })
          },

          deleteMany: async ({ model, where }) => {
            const payload = await getPayload()
            const collection = getCollection(model)

            if (enableDebugLogs) {
              debugLog('deleteMany', { collection, model, where })
            }

            const payloadWhere = convertWhereToPayload(model, where)

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

            const payloadWhere = where ? convertWhereToPayload(model, where) : {}

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

export type { Adapter, BetterAuthOptions }
