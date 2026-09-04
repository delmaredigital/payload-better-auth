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
 * How many times `incrementOne` re-reads and retries when its compare-and-swap
 * guard loses to a concurrent writer. Contention on these counters (API-key
 * quota, rate limits, team member counts) is short-lived, so a small bound
 * converges without turning a hot row into an unbounded retry loop.
 */
const INCREMENT_ONE_MAX_ATTEMPTS = 5

/** Methods the Payload adapter implements against Better Auth's `CustomAdapter`. */
type ImplementedAdapterMethods =
  | 'create'
  | 'findOne'
  | 'findMany'
  | 'update'
  | 'updateMany'
  | 'delete'
  | 'deleteMany'
  | 'consumeOne'
  | 'incrementOne'
  | 'count'

/**
 * The adapter object is returned through `as CustomAdapter` to reconcile the
 * interface's generic (`<T>`) return types with Payload's concrete ones — but a
 * cast also silently accepts an object that is *missing* methods. That is how
 * Better Auth 1.7's new required `consumeOne`/`incrementOne` cleared the build
 * while the factory would have thrown at runtime.
 *
 * This check closes that gap: if Better Auth adds a required `CustomAdapter`
 * method that isn't listed above, the assignment fails and the build breaks
 * with a pointer to here.
 */
const _adapterImplementsCustomAdapter: Exclude<
  keyof CustomAdapter,
  ImplementedAdapterMethods | 'createSchema' | 'options'
> extends never
  ? true
  : never = true
void _adapterImplementsCustomAdapter

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
      case 'ends_with':
        // Payload's `like`/`contains` are NOT anchored — they match words/
        // substrings anywhere and are case-insensitive, so `${value}%` is not a
        // prefix anchor. There is no anchored operator in Payload's where DSL.
        // We narrow at the DB with `contains` and then anchor the match exactly
        // in a post-filter (see applyAnchorFilter in findOne/findMany).
        return { contains: value }
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

    // Warn if using number IDs but generateId is not set to 'serial'.
    // Without this, Better Auth's factory won't coerce relationship field values to numbers,
    // causing Payload ValidationErrors on create/update (e.g. user: '1' instead of user: 1).
    if (idType === 'number' && generateId !== 'serial') {
      console.warn(
        `[payload-adapter] Warning: Using SERIAL (number) IDs but \`generateId\` is ${generateId === undefined ? 'not set' : `set to "${generateId}"`}. ` +
          'You must set `advanced: { database: { generateId: "serial" } }` in your Better Auth config ' +
          'so that relationship field values are correctly coerced to numbers. ' +
          'Without this, create/update operations will fail with ValidationErrors.'
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
      // Payload's `json` field stores arrays natively, on every database adapter —
      // the Local API is the boundary here, not a SQL driver. Reporting false makes
      // the factory JSON.stringify `string[]`/`number[]` values on the way in, which
      // Payload rejects whenever the target field validates its shape.
      supportsArrays: true,
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
        // Only do this for references to 'id' (primary key). Non-PK references
        // (e.g., oauthRefreshToken.clientId → oauthClient.clientId) stay as plain
        // text fields and should keep their original name.
        //
        // We also record each rename in `fieldRenameByModel` so sortBy fields can
        // be mapped the same way (the factory maps `where` but not `sortBy`).
        // It's keyed by BOTH the singular schema key AND the resolved model name
        // the factory passes to adapter methods (plural when usePlural is on).
        const fieldRenameByModel = new Map<string, Record<string, string>>()
        for (const [modelKey, table] of Object.entries(schema)) {
          const renames: Record<string, string> = {}
          for (const [fieldKey, fieldDef] of Object.entries(table.fields)) {
            if (fieldDef.references && (!fieldDef.references.field || fieldDef.references.field === 'id')) {
              const stripped = fieldKey.replace(/(_id|Id)$/, '');
              if (stripped !== fieldKey) {
                fieldDef.fieldName = stripped;
                renames[fieldKey] = stripped;
              }
            }
          }
          fieldRenameByModel.set(modelKey, renames)
          try {
            fieldRenameByModel.set(getModelName(modelKey), renames)
          } catch {
            // getModelName may throw for unknown keys; the singular key is enough.
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
        // Fix: Better Auth's getModelName blindly appends 's' even when name already ends in 's'
        // (e.g., 'jwks' becomes 'jwkss'). We normalize to prevent double-s slugs.
        const getCollection = (model: string): CollectionSlug => {
          const name = getModelName(model)
          // Fix double-s from naive pluralization (e.g., jwkss → jwks)
          if (name.endsWith('ss') && !model.endsWith('ss')) {
            return name.slice(0, -1) as CollectionSlug
          }
          return name as CollectionSlug
        }

        // Payload throws a 404 APIError when an id-targeted op finds no doc.
        // Better Auth's reference adapters treat delete/update-not-found as a
        // silent no-op, so we normalize 404 to "not found" rather than letting
        // it surface as a 500.
        const isNotFoundError = (error: unknown): boolean =>
          error instanceof Error &&
          'status' in error &&
          (error as Error & { status: number }).status === 404

        // Map a Better Auth field name to its Payload field name using the
        // renames captured above (e.g. userId → user). The factory applies this
        // to `where` but NOT to `sortBy`, so we do it here.
        const mapSortField = (model: string, field: string): string =>
          fieldRenameByModel.get(model)?.[field] ?? field

        // starts_with/ends_with are narrowed to `contains` at the DB (Payload has
        // no anchored operator). Anchor them precisely here on the fetched rows.
        // `where` field names are already mapped to Payload names by the factory,
        // so `field` matches the doc keys. Matching is case-insensitive to mirror
        // Payload's like/contains behavior.
        type WhereClause = { field: string; value: unknown; operator: string }
        const getAnchorClauses = (where?: WhereClause[]): WhereClause[] =>
          (where ?? []).filter(
            (w) => w.operator === 'starts_with' || w.operator === 'ends_with'
          )
        const matchesAnchors = (
          doc: Record<string, unknown>,
          anchors: WhereClause[]
        ): boolean =>
          anchors.every((a) => {
            const v = doc[a.field]
            if (typeof v !== 'string' || typeof a.value !== 'string') return false
            const hay = v.toLowerCase()
            const needle = a.value.toLowerCase()
            return a.operator === 'starts_with'
              ? hay.startsWith(needle)
              : hay.endsWith(needle)
          })

        // Fetch the single row a `where` selects, honoring the id fast-path and
        // the anchored-operator post-filter. Shared by consumeOne/incrementOne,
        // which need the row (and its id) before they can write.
        const findOneDoc = async (
          model: string,
          where: WhereClause[]
        ): Promise<Record<string, unknown> | null> => {
          const payload = await getPayload()
          const collection = getCollection(model)

          const id = extractSingleId(where)
          if (id !== null) {
            try {
              return (await payload.findByID({
                collection,
                id,
                depth: 0,
                overrideAccess: true,
              })) as Record<string, unknown>
            } catch (error) {
              if (isNotFoundError(error)) return null
              throw error
            }
          }

          const anchors = getAnchorClauses(where)
          const result = await payload.find({
            collection,
            where: convertWhereToPayload(where),
            limit: anchors.length > 0 ? 100 : 1,
            depth: 0,
            overrideAccess: true,
          })
          const docs =
            anchors.length > 0
              ? result.docs.filter((d) => matchesAnchors(d as Record<string, unknown>, anchors))
              : result.docs
          return (docs[0] as Record<string, unknown>) ?? null
        }

        // Warn when input fields don't survive the write — i.e. Payload silently
        // stripped a column that doesn't exist on the collection (usually a
        // plugin field added without regenerating collections). Rename-aware so
        // reference fields (userId → user) aren't flagged. We return the raw
        // Payload result (the factory maps field names back to Better Auth), so
        // these fields would otherwise vanish with no signal.
        const warnDroppedKeys = (
          op: string,
          model: string,
          collection: string,
          data: Record<string, unknown>,
          result: Record<string, unknown>
        ): void => {
          const renames = fieldRenameByModel.get(model) ?? {}
          const resultKeys = new Set(Object.keys(result))
          const dropped = Object.keys(data).filter((k) => {
            if (k === 'id' || k === 'createdAt' || k === 'updatedAt') return false
            const payloadKey = renames[k] ?? k
            return !resultKeys.has(payloadKey) && !resultKeys.has(k)
          })
          if (dropped.length > 0) {
            console.warn(
              `[payload-adapter] ${op} on '${collection}': input field(s) not stored ` +
                `(missing column — regenerate collections?): ${dropped.join(', ')}`
            )
          }
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
              // Return the raw Payload result (the DB truth) rather than merging
              // input over it. The factory maps Payload field names back to
              // Better Auth names on output; merging input back would re-inject
              // keys Payload stripped, making BA believe a field persisted when
              // it did not (silent data loss). Surface any such drops instead.
              warnDroppedKeys('create', model, collection, data as Record<string, unknown>, result as Record<string, unknown>)
              if (enableDebugLogs) {
                debugLog('create result', { collection, resultId: (result as Record<string, unknown>).id, resultKeys: Object.keys(result as Record<string, unknown>) })
              }
              return result as unknown as typeof data
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

              // With anchored operators, over-fetch and post-filter: a plain
              // limit:1 on the `contains` narrowing could return a substring
              // match that doesn't actually start/end with the value (false
              // negative for findOne).
              const anchors = getAnchorClauses(where as WhereClause[] | undefined)
              const result = await payload.find({
                collection,
                where: payloadWhere,
                limit: anchors.length > 0 ? 100 : 1,
                depth: join ? 1 : 0,
                overrideAccess: true,
              })

              if (enableDebugLogs) {
                debugLog('findOne result', { collection, totalDocs: result.totalDocs, found: result.docs.length > 0 })
              }

              const docs =
                anchors.length > 0
                  ? result.docs.filter((d) => matchesAnchors(d as Record<string, unknown>, anchors))
                  : result.docs
              if (!docs[0]) return null
              return docs[0]
            } catch (error) {
              // Do NOT log `where` values here: findOne on sessions is keyed by
              // raw session token, verifications by OTP, apikeys by key hash —
              // logging values would leak live credentials. Log field names only;
              // full where is available under enableDebugLogs.
              const whereFields = Array.isArray(where)
                ? where.map((w) => (w as { field?: string }).field).filter(Boolean)
                : undefined
              console.error('[payload-adapter] findOne failed:', {
                model,
                whereFields,
                error,
              })
              if (enableDebugLogs) {
                debugLog('findOne failed (full where)', { model, where })
              }
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
            const effectiveLimit = limit ?? 100

            // Payload paginates by `page`, not `offset`. Deriving a page as
            // `floor(offset/limit)+1` is only correct when offset is an exact
            // multiple of limit; Better Auth passes arbitrary offsets (e.g.
            // admin listUsers). When offset is not aligned, over-fetch from
            // page 1 and slice to the true offset.
            const sort = sortBy
              ? `${sortBy.direction === 'desc' ? '-' : ''}${mapSortField(model, sortBy.field)}`
              : undefined

            // Anchored operators (starts_with/ends_with) require post-filtering,
            // which can't be combined with DB-level pagination. Scan a bounded
            // window from page 1, anchor-filter, then apply offset/limit in
            // memory. `contains` narrows the scan first, so 1000 covers realistic
            // result sets; deeper pagination on anchored operators is best-effort.
            const anchors = getAnchorClauses(where as WhereClause[] | undefined)
            if (anchors.length > 0) {
              const scan = await payload.find({
                collection,
                where: payloadWhere,
                limit: 1000,
                page: 1,
                sort,
                depth: join ? 1 : 0,
                overrideAccess: true,
              })
              const filtered = scan.docs.filter((d) =>
                matchesAnchors(d as Record<string, unknown>, anchors)
              )
              const start = offset ?? 0
              return filtered.slice(start, start + effectiveLimit)
            }

            if (offset && offset % effectiveLimit !== 0) {
              const result = await payload.find({
                collection,
                where: payloadWhere,
                limit: offset + effectiveLimit,
                page: 1,
                sort,
                depth: join ? 1 : 0,
                overrideAccess: true,
              })
              return result.docs.slice(offset)
            }

            const result = await payload.find({
              collection,
              where: payloadWhere,
              limit: effectiveLimit,
              page: offset ? offset / effectiveLimit + 1 : 1,
              sort,
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
              try {
                const result = await payload.update({
                  collection,
                  id,
                  data: data as Record<string, unknown>,
                  depth: 0,
                  overrideAccess: true,
                })
                warnDroppedKeys('update', model, collection, data as Record<string, unknown>, result as Record<string, unknown>)
                return result as unknown as typeof data
              } catch (error) {
                // Row already gone (e.g. concurrent session revocation) — BA
                // expects null, not a 500.
                if (isNotFoundError(error)) return null
                throw error
              }
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
            warnDroppedKeys('update', model, collection, data as Record<string, unknown>, result.docs[0] as Record<string, unknown>)
            return result.docs[0] as unknown as typeof data
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

            // Payload bulk ops are per-doc and can partially fail; `docs.length`
            // alone would report those failures as successes to Better Auth.
            const updateErrors = (result as { errors?: unknown[] }).errors
            if (updateErrors && updateErrors.length > 0) {
              console.error('[payload-adapter] updateMany partial failure:', {
                model,
                failed: updateErrors.length,
                succeeded: result.docs.length,
              })
            }

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
              try {
                await payload.delete({
                  collection,
                  id,
                  overrideAccess: true,
                })
              } catch (error) {
                // Delete-not-found is a silent no-op in BA's reference adapters
                // (double sign-out, expired-verification cleanup, etc.).
                if (!isNotFoundError(error)) throw error
              }
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

            const deleteErrors = (result as { errors?: unknown[] }).errors
            if (deleteErrors && deleteErrors.length > 0) {
              console.error('[payload-adapter] deleteMany partial failure:', {
                model,
                failed: deleteErrors.length,
                succeeded: result.docs.length,
              })
            }

            return result.docs.length
          },

          // Better Auth 1.7 requires these two atomic primitives on every
          // custom adapter — the factory throws rather than falling back.
          //
          // Payload's Local API exposes no `DELETE ... RETURNING` or
          // `SET n = n + d`, so both are read-then-write. We narrow the race
          // window by re-asserting Better Auth's guard (which already carries
          // the caller's precondition, e.g. `remaining > 0`) on the write, and
          // by treating "the write matched nothing" as losing the race rather
          // than as success. See the README's "Atomic operations" section for
          // the exact guarantees and their limits.
          consumeOne: async ({ model, where }) => {
            const payload = await getPayload()
            const collection = getCollection(model)

            if (enableDebugLogs) {
              debugLog('consumeOne', { collection, model, where })
            }

            const doc = await findOneDoc(model, where as WhereClause[])
            if (!doc) return null

            const id = (doc as Record<string, unknown>).id as string | number
            try {
              await payload.delete({ collection, id, overrideAccess: true })
            } catch (error) {
              // A concurrent consumer already removed the row — Payload 404s.
              // Returning null (rather than the row we read) is what keeps
              // single-use credentials single-use.
              if (isNotFoundError(error)) return null
              throw error
            }

            return doc as never
          },

          incrementOne: async ({ model, where, increment, set }) => {
            const payload = await getPayload()
            const collection = getCollection(model)

            if (enableDebugLogs) {
              debugLog('incrementOne', { collection, model, where, increment, set })
            }

            const incrementFields = Object.entries(increment)

            // Compare-and-swap with bounded retry. The guard re-asserts both
            // Better Auth's own precondition and the counter values we read,
            // so a racing writer's update matches no row; we then re-read and
            // retry instead of silently clobbering their write.
            for (let attempt = 0; attempt < INCREMENT_ONE_MAX_ATTEMPTS; attempt++) {
              const doc = await findOneDoc(model, where as WhereClause[])
              if (!doc) return null

              const current = doc as Record<string, unknown>
              const data: Record<string, unknown> = { ...(set ?? {}) }
              for (const [field, delta] of incrementFields) {
                const value = current[field]
                data[field] = (typeof value === 'number' ? value : 0) + delta
              }

              const guard: PayloadWhere = {
                and: [
                  { id: { equals: current.id } },
                  convertWhereToPayload(where),
                  // Lost-update guard: only write if the counters still hold
                  // the values this attempt computed from. A counter that has
                  // never been written is NULL rather than 0, and `equals: 0`
                  // does not match NULL in SQL — guard on absence instead.
                  ...incrementFields.map(([field]) =>
                    typeof current[field] === 'number'
                      ? { [field]: { equals: current[field] } }
                      : { [field]: { exists: false } }
                  ),
                ],
              }

              const result = await payload.update({
                collection,
                where: guard,
                data,
                depth: 0,
                overrideAccess: true,
              })

              const updated = result.docs[0]
              if (updated) {
                warnDroppedKeys('incrementOne', model, collection, data, updated as Record<string, unknown>)
                return updated as never
              }
              // Guard matched nothing: either a racer moved the counter (retry
              // against the new value) or the caller's precondition no longer
              // holds (the next findOneDoc returns null and we report null).
            }

            console.warn(
              `[payload-adapter] incrementOne on '${collection}' gave up after ` +
                `${INCREMENT_ONE_MAX_ATTEMPTS} contended attempts`
            )
            return null
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
