/**
 * Auto-generate Payload collections from Better Auth schema
 *
 * @packageDocumentation
 */

import type { Config, CollectionConfig, Field, Plugin, CollectionBeforeChangeHook } from 'payload'
import type { BetterAuthOptions } from 'better-auth'
import { getAuthTables } from 'better-auth/db'
import type { FirstUserAdminOptions } from '../utils/firstUserAdmin.js'
import { isAdmin } from '../utils/access.js'

export type { FirstUserAdminOptions }

export type BetterAuthCollectionsOptions = {
  /**
   * Better Auth options. Pass the same options you use for betterAuth().
   * The plugin reads the schema to generate collections.
   */
  betterAuthOptions?: BetterAuthOptions

  /**
   * Collections to skip (they already exist in your config)
   * Default: ['user'] - assumes you have a Users collection
   */
  skipCollections?: string[]

  /**
   * Admin group name for generated collections
   * Default: 'Auth'
   */
  adminGroup?: string

  /**
   * Custom access control for generated collections.
   * By default, only admins can read/delete, and create/update are disabled.
   */
  access?: CollectionConfig['access']

  /**
   * Whether to pluralize collection slugs (add 's' suffix).
   * Should match your adapter's usePlural setting.
   * Default: true (matches Payload conventions)
   */
  usePlural?: boolean

  /**
   * Configure saveToJWT for session-related fields.
   * This controls which fields are included in JWT tokens.
   * Default: true
   */
  configureSaveToJWT?: boolean

  /**
   * Automatically make the first registered user an admin.
   * Enabled by default. Set to `false` to disable, or provide options to customize.
   *
   * @default true
   *
   * @example Disable
   * ```ts
   * betterAuthCollections({
   *   betterAuthOptions: authOptions,
   *   firstUserAdmin: false,
   * })
   * ```
   *
   * @example Custom roles
   * ```ts
   * betterAuthCollections({
   *   betterAuthOptions: authOptions,
   *   firstUserAdmin: {
   *     adminRole: 'super-admin',
   *     defaultRole: 'member',
   *   },
   * })
   * ```
   */
  firstUserAdmin?: boolean | FirstUserAdminOptions

  /**
   * Customize a generated collection before it's added to config.
   * Use this to add hooks, modify fields, or adjust any collection setting.
   *
   * @example
   * ```ts
   * customizeCollection: (modelKey, collection) => {
   *   if (modelKey === 'session') {
   *     return {
   *       ...collection,
   *       hooks: {
   *         afterDelete: [myCleanupHook],
   *       },
   *     }
   *   }
   *   return collection
   * }
   * ```
   */
  customizeCollection?: (
    modelKey: string,
    collection: CollectionConfig
  ) => CollectionConfig
}

/**
 * Creates a beforeChange hook that makes the first user an admin.
 */
function createFirstUserAdminHook(
  options: FirstUserAdminOptions,
  usersSlug: string
): CollectionBeforeChangeHook {
  const {
    adminRole = 'admin',
    defaultRole = 'user',
    roleField = 'role',
  } = options

  return async ({ data, operation, req }) => {
    if (operation !== 'create') {
      return data
    }

    try {
      const { totalDocs } = await req.payload.count({
        collection: usersSlug,
        overrideAccess: true,
      })

      if (totalDocs === 0) {
        // First user becomes admin
        return {
          ...data,
          [roleField]: adminRole,
        }
      }

      // Subsequent users get default role if not already set
      return {
        ...data,
        [roleField]: data[roleField] ?? defaultRole,
      }
    } catch (error) {
      // On error, don't block user creation - just use provided or default role
      console.warn('[betterAuthCollections] Failed to check user count:', error)
      return {
        ...data,
        [roleField]: data[roleField] ?? defaultRole,
      }
    }
  }
}

/**
 * Inject the first-user-admin hook into a collection's hooks.
 */
function injectFirstUserAdminHook(
  collection: CollectionConfig,
  options: FirstUserAdminOptions,
  usersSlug: string
): CollectionConfig {
  const hook = createFirstUserAdminHook(options, usersSlug)
  const existingHooks = collection.hooks?.beforeChange ?? []

  return {
    ...collection,
    hooks: {
      ...collection.hooks,
      beforeChange: [hook, ...(Array.isArray(existingHooks) ? existingHooks : [existingHooks])],
    },
  }
}

/**
 * Determine if a field should be saved to JWT.
 * Session-critical fields are included, large data fields are excluded.
 */
function getSaveToJWT(modelKey: string, fieldName: string): boolean | undefined {
  // Session fields - include core session data
  if (modelKey === 'session') {
    const includeFields = ['token', 'expiresAt', 'user', 'userId', 'ipAddress', 'userAgent', 'activeOrganizationId', 'activeTeamId']
    const excludeFields = ['createdAt', 'updatedAt']

    if (includeFields.some(f => fieldName === f || fieldName.endsWith(f.charAt(0).toUpperCase() + f.slice(1)))) {
      return true
    }
    if (excludeFields.includes(fieldName)) {
      return false
    }
  }

  // User fields - include essential auth data
  if (modelKey === 'user') {
    const includeFields = ['role', 'email', 'emailVerified', 'name', 'twoFactorEnabled', 'banned']
    const excludeFields = ['image', 'password', 'banReason']

    if (includeFields.includes(fieldName)) {
      return true
    }
    if (excludeFields.includes(fieldName)) {
      return false
    }
  }

  // Account fields - generally not in JWT
  if (modelKey === 'account') {
    return false
  }

  // Verification fields - not in JWT
  if (modelKey === 'verification') {
    return false
  }

  // Default: don't set (let Payload decide)
  return undefined
}

/**
 * Simple pluralization (add 's' suffix)
 */
function pluralize(name: string): string {
  if (name.endsWith('s')) return name
  return `${name}s`
}

function mapFieldType(
  type: string,
  fieldName: string,
  hasReferences: boolean
): Field['type'] {
  if (hasReferences) {
    return 'relationship'
  }

  switch (type) {
    case 'boolean':
      return 'checkbox'
    case 'number':
      return 'number'
    case 'date':
      return 'date'
    case 'string':
      if (fieldName === 'email') return 'email'
      return 'text'
    case 'json':
    case 'object':
      return 'json'
    case 'string[]':
    case 'array':
      return 'json' // Payload doesn't have native string array, use JSON
    default:
      return 'text'
  }
}

function extractRelationTarget(
  fieldName: string,
  usePlural: boolean
): string {
  const base = fieldName.replace(/(_id|Id)$/, '')
  return usePlural ? pluralize(base) : base
}

function generateCollection(
  modelKey: string,
  table: ReturnType<typeof getAuthTables>[string],
  usePlural: boolean,
  adminGroup: string,
  customAccess?: BetterAuthCollectionsOptions['access'],
  configureSaveToJWT = true
): CollectionConfig {
  // Use modelName from schema if set, otherwise apply pluralization to modelKey
  const baseName = table.modelName ?? modelKey
  const slug = usePlural ? pluralize(baseName) : baseName
  const fields: Field[] = []

  for (const [fieldKey, fieldDef] of Object.entries(table.fields)) {
    if (['id', 'createdAt', 'updatedAt'].includes(fieldKey)) {
      continue
    }

    const fieldName = fieldDef.fieldName ?? fieldKey
    const hasReferences = fieldDef.references !== undefined
    const fieldType = mapFieldType(fieldDef.type as string, fieldKey, hasReferences)

    if (fieldType === 'relationship') {
      // Use schema reference if available, otherwise infer from field name
      let relationTo: string
      if (fieldDef.references?.model) {
        relationTo = usePlural ? pluralize(fieldDef.references.model) : fieldDef.references.model
      } else {
        relationTo = extractRelationTarget(fieldKey, usePlural)
      }

      const relFieldName = fieldName.replace(/(_id|Id)$/, '')
      const saveToJWT = configureSaveToJWT ? getSaveToJWT(modelKey, relFieldName) : undefined

      fields.push({
        name: relFieldName,
        type: 'relationship',
        relationTo,
        required: fieldDef.required ?? false,
        index: true,
        ...(saveToJWT !== undefined && { saveToJWT }),
      } as Field)
      continue
    }

    const saveToJWT = configureSaveToJWT ? getSaveToJWT(modelKey, fieldName) : undefined
    const field: Record<string, unknown> = {
      name: fieldName,
      type: fieldType,
      ...(saveToJWT !== undefined && { saveToJWT }),
    }

    if (fieldDef.required) field.required = true
    if (fieldDef.unique) {
      field.unique = true
      field.index = true
    }

    if (fieldDef.defaultValue !== undefined) {
      let defaultValue: unknown = fieldDef.defaultValue
      if (typeof defaultValue === 'function') {
        try {
          defaultValue = (defaultValue as () => unknown)()
        } catch {
          defaultValue = undefined
        }
      }
      if (defaultValue !== undefined && defaultValue !== null) {
        field.defaultValue = defaultValue
      }
    }

    fields.push(field as Field)
  }

  const titleField = ['name', 'email', 'title', 'identifier'].find((f) =>
    fields.some((field) => 'name' in field && field.name === f)
  )

  // Default access: admin-only read/delete, disabled manual create/update via admin UI
  // The adapter uses overrideAccess: true for programmatic operations from Better Auth
  const defaultAccess: CollectionConfig['access'] = {
    read: isAdmin(),
    create: () => false, // Manual creation disabled - Better Auth manages these
    update: () => false, // Manual update disabled - Better Auth manages these
    delete: isAdmin(),
  }

  return {
    slug,
    admin: {
      useAsTitle: titleField ?? 'id',
      group: adminGroup,
      description: `Auto-generated from Better Auth schema (${modelKey})`,
    },
    access: customAccess ?? defaultAccess,
    fields,
    timestamps: true,
  }
}

/**
 * Get existing field names from a collection, handling nested field structures.
 */
function getExistingFieldNames(fields: Field[]): Set<string> {
  const names = new Set<string>()
  for (const field of fields) {
    if ('name' in field && field.name) {
      names.add(field.name)
    }
  }
  return names
}

/**
 * Augment an existing collection with missing fields from Better Auth schema.
 * This ensures user-defined collections (like 'users') get plugin fields automatically.
 */
function augmentCollectionWithMissingFields(
  collection: CollectionConfig,
  table: ReturnType<typeof getAuthTables>[string],
  usePlural: boolean,
  modelKey: string,
  configureSaveToJWT = true
): CollectionConfig {
  const existingFieldNames = getExistingFieldNames(collection.fields)
  const missingFields: Field[] = []

  for (const [fieldKey, fieldDef] of Object.entries(table.fields)) {
    // Skip standard fields that Payload handles
    if (['id', 'createdAt', 'updatedAt'].includes(fieldKey)) {
      continue
    }

    const fieldName = fieldDef.fieldName ?? fieldKey
    const hasReferences = fieldDef.references !== undefined

    // For reference fields, check the name without Id suffix
    const payloadFieldName = hasReferences
      ? fieldName.replace(/(_id|Id)$/, '')
      : fieldName

    // Skip if field already exists
    if (existingFieldNames.has(payloadFieldName)) {
      continue
    }

    // Generate the missing field
    const fieldType = mapFieldType(fieldDef.type as string, fieldKey, hasReferences)

    if (fieldType === 'relationship') {
      let relationTo: string
      if (fieldDef.references?.model) {
        relationTo = usePlural ? pluralize(fieldDef.references.model) : fieldDef.references.model
      } else {
        relationTo = extractRelationTarget(fieldKey, usePlural)
      }

      const saveToJWT = configureSaveToJWT ? getSaveToJWT(modelKey, payloadFieldName) : undefined

      missingFields.push({
        name: payloadFieldName,
        type: 'relationship',
        relationTo,
        required: fieldDef.required ?? false,
        index: true,
        admin: {
          description: `Auto-added by Better Auth (${fieldKey})`,
        },
        ...(saveToJWT !== undefined && { saveToJWT }),
      } as Field)
    } else {
      const saveToJWT = configureSaveToJWT ? getSaveToJWT(modelKey, payloadFieldName) : undefined
      // Fields managed exclusively by Better Auth should be read-only in the admin UI
      const readOnlyFields = ['twoFactorEnabled']
      const isReadOnly = readOnlyFields.includes(payloadFieldName)

      const field: Record<string, unknown> = {
        name: payloadFieldName,
        type: fieldType,
        admin: {
          description: `Auto-added by Better Auth (${fieldKey})`,
          ...(isReadOnly && { readOnly: true }),
        },
        ...(saveToJWT !== undefined && { saveToJWT }),
      }

      if (fieldDef.required) field.required = true
      if (fieldDef.unique) {
        field.unique = true
        field.index = true
      }

      if (fieldDef.defaultValue !== undefined) {
        let defaultValue: unknown = fieldDef.defaultValue
        if (typeof defaultValue === 'function') {
          try {
            defaultValue = (defaultValue as () => unknown)()
          } catch {
            defaultValue = undefined
          }
        }
        if (defaultValue !== undefined && defaultValue !== null) {
          field.defaultValue = defaultValue
        }
      }

      missingFields.push(field as Field)
    }
  }

  // Return original if no fields to add
  if (missingFields.length === 0) {
    return collection
  }

  // Return augmented collection
  return {
    ...collection,
    fields: [...collection.fields, ...missingFields],
  }
}

/**
 * Payload plugin that auto-generates collections from Better Auth schema.
 *
 * @example Basic usage
 * ```ts
 * import { betterAuthCollections } from '@delmaredigital/payload-better-auth'
 *
 * export default buildConfig({
 *   plugins: [
 *     betterAuthCollections({
 *       betterAuthOptions: { ... },
 *       skipCollections: ['user'], // Define Users yourself
 *     }),
 *   ],
 * })
 * ```
 *
 * @example With customization callback
 * ```ts
 * betterAuthCollections({
 *   betterAuthOptions: authOptions,
 *   customizeCollection: (modelKey, collection) => {
 *     if (modelKey === 'session') {
 *       return {
 *         ...collection,
 *         hooks: { afterDelete: [cleanupHook] },
 *       }
 *     }
 *     return collection
 *   },
 * })
 * ```
 */
export function betterAuthCollections(
  options: BetterAuthCollectionsOptions = {}
): Plugin {
  const {
    betterAuthOptions = {},
    skipCollections = ['user'],
    adminGroup = 'Auth',
    access,
    usePlural = true,
    configureSaveToJWT = true,
    firstUserAdmin,
    customizeCollection,
  } = options

  // Parse firstUserAdmin option (defaults to true)
  const firstUserAdminOptions: FirstUserAdminOptions | null =
    firstUserAdmin === false
      ? null
      : typeof firstUserAdmin === 'object'
        ? firstUserAdmin
        : {} // true or undefined = enabled with defaults

  return (incomingConfig: Config): Config => {
    const existingCollections = new Map(
      (incomingConfig.collections ?? []).map((c) => [c.slug, c])
    )

    const tables = getAuthTables(betterAuthOptions)
    const generatedCollections: CollectionConfig[] = []
    const augmentedCollections: CollectionConfig[] = []

    // Calculate users collection slug for firstUserAdmin hook
    const userTable = tables['user']
    const usersSlug = usePlural
      ? pluralize(userTable?.modelName ?? 'user')
      : (userTable?.modelName ?? 'user')

    for (const [modelKey, table] of Object.entries(tables)) {
      // Calculate slug
      const baseName = table.modelName ?? modelKey
      const slug = usePlural ? pluralize(baseName) : baseName

      // Check if this collection already exists
      const existingCollection = existingCollections.get(slug)

      if (existingCollection) {
        // Augment existing collection with missing fields from Better Auth schema
        let augmented = augmentCollectionWithMissingFields(
          existingCollection,
          table,
          usePlural,
          modelKey,
          configureSaveToJWT
        )

        // Inject first-user-admin hook for user collection
        if (modelKey === 'user' && firstUserAdminOptions) {
          augmented = injectFirstUserAdminHook(augmented, firstUserAdminOptions, usersSlug)
        }

        if (augmented !== existingCollection) {
          augmentedCollections.push(augmented)
          existingCollections.set(slug, augmented)
        }
        continue
      }

      // Skip if explicitly told to (but still augment if exists above)
      if (skipCollections.includes(modelKey)) {
        continue
      }

      let collection = generateCollection(
        modelKey,
        table,
        usePlural,
        adminGroup,
        access,
        configureSaveToJWT
      )

      // Inject first-user-admin hook for user collection
      if (modelKey === 'user' && firstUserAdminOptions) {
        collection = injectFirstUserAdminHook(collection, firstUserAdminOptions, usersSlug)
      }

      // Apply customization callback if provided
      if (customizeCollection) {
        collection = customizeCollection(modelKey, collection)
      }

      generatedCollections.push(collection)
    }

    // Merge: replace augmented collections, add new ones
    const finalCollections = (incomingConfig.collections ?? []).map((c) => {
      const augmented = augmentedCollections.find((a) => a.slug === c.slug)
      return augmented ?? c
    })

    return {
      ...incomingConfig,
      collections: [...finalCollections, ...generatedCollections],
    }
  }
}
