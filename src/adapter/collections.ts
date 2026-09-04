/**
 * Auto-generate Payload collections from Better Auth schema
 *
 * @packageDocumentation
 */

import type {
  Config,
  CollectionConfig,
  Field,
  Plugin,
  CollectionBeforeChangeHook,
  CollectionAfterChangeHook,
} from 'payload'
import type { BetterAuthOptions } from 'better-auth'
import { getAuthTables } from 'better-auth/db'
import type { FirstUserAdminOptions } from '../utils/firstUserAdmin.js'
import { isAdmin, hasAnyRole } from '../utils/access.js'

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
   * Deny API/admin access to sensitive credential fields on the collections this
   * plugin manages — session tokens, TOTP secrets and backup codes, verification
   * identifiers/values, stored OAuth tokens, hashed passwords and API keys.
   *
   * Better Auth itself is unaffected (the adapter operates with
   * `overrideAccess: true`); this only closes the Payload REST/GraphQL and
   * admin-UI read path. Without it, anyone the collection's `access.read`
   * admits (admins, by default) can lift live session tokens or TOTP secrets —
   * enough to hijack a session or clone a second factor.
   *
   * - `true` (default): lock the built-in field list per model (see
   *   `defaultSecretFieldsByModel`)
   * - `false`: disable
   * - object: merged over the built-in map (`modelKey -> field names`;
   *   an empty array unlocks that model)
   *
   * Applies to generated collections and to secret fields *added by
   * augmentation* to your pre-existing collections. Fields you defined
   * yourself are never touched.
   *
   * @default true
   */
  secureSecretFields?: boolean | Record<string, string[]>

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
 * Secret-bearing fields per Better Auth model key, locked by default via the
 * `secureSecretFields` option. Models a consumer hasn't enabled simply don't
 * exist in `getAuthTables`, so unused entries are inert.
 */
export const defaultSecretFieldsByModel: Record<string, string[]> = {
  account: ['password', 'accessToken', 'refreshToken', 'idToken'],
  apikey: ['key'],
  jwks: ['privateKey'],
  oauthAccessToken: ['accessToken', 'refreshToken'],
  oauthApplication: ['clientSecret'],
  session: ['token'],
  twoFactor: ['secret', 'backupCodes'],
  verification: ['identifier', 'value'],
}

/** Resolve the `secureSecretFields` option to a per-model field map (null = off). */
function resolveSecretFields(
  option: BetterAuthCollectionsOptions['secureSecretFields']
): Record<string, string[]> | null {
  if (option === false) return null
  if (option === undefined || option === true) return defaultSecretFieldsByModel
  return { ...defaultSecretFieldsByModel, ...option }
}

const denyFieldAccess = () => false

/** Deny create/read/update on a field and hide it in the admin UI. */
function lockField<T extends Field>(field: T): T {
  return {
    ...field,
    access: {
      create: denyFieldAccess,
      read: denyFieldAccess,
      update: denyFieldAccess,
    },
    admin: {
      ...('admin' in field ? field.admin : undefined),
      hidden: true,
    },
  } as T
}

/**
 * Lock the named secret fields on a generated collection. When the
 * collection's `useAsTitle` points at a locked field (e.g. `verification`'s
 * `identifier`), fall back to `id` — a locked field would render every row
 * label blank.
 */
function lockSecretFields(
  collection: CollectionConfig,
  secretFields: string[]
): CollectionConfig {
  const useAsTitle = collection.admin?.useAsTitle

  return {
    ...collection,
    admin: {
      ...collection.admin,
      ...(useAsTitle && secretFields.includes(useAsTitle) && { useAsTitle: 'id' }),
    },
    fields: collection.fields.map((field) =>
      'name' in field && field.name && secretFields.includes(field.name)
        ? lockField(field)
        : field
    ),
  }
}

/** req.context key marking a create that was auto-assigned admin as "first user". */
const FIRST_ADMIN_MARKER = '__betterAuthFirstUserAdminAssigned'

/** Deterministic "who was first" ordering: earliest createdAt, then lowest id. */
function compareCreated(
  a: { id: unknown; createdAt?: unknown },
  b: { id: unknown; createdAt?: unknown }
): number {
  const ac = new Date((a.createdAt as string | number | Date) ?? 0).getTime()
  const bc = new Date((b.createdAt as string | number | Date) ?? 0).getTime()
  if (ac !== bc) return ac - bc
  const ai = String(a.id)
  const bi = String(b.id)
  return ai < bi ? -1 : ai > bi ? 1 : 0
}

/**
 * Creates the first-user-admin hooks.
 *
 * Security model (roles are assigned authoritatively on the server):
 * - The FIRST user (no users exist yet) is bootstrapped as admin.
 * - A role supplied in `data` is honored ONLY when an already-authenticated
 *   admin performs the create (e.g. via the Payload admin UI). For
 *   self-service sign-up, `data` is attacker-controllable, so any incoming
 *   role is ignored and `defaultRole` is assigned. This closes the
 *   privilege-escalation path where a client POSTs `{ role: 'admin' }` to the
 *   sign-up endpoint.
 * - `afterChange` resolves a concurrent-first-signup race: if this user was
 *   bootstrap-assigned admin but other admins now exist, only the canonical
 *   first admin is kept and the rest are demoted. Only bootstrap-assigned
 *   admins (flagged via req.context) are ever demoted, so admins created
 *   deliberately by an existing admin are never touched.
 */
export function createFirstUserAdminHooks(
  options: FirstUserAdminOptions,
  usersSlug: string
): { before: CollectionBeforeChangeHook; after: CollectionAfterChangeHook } {
  const {
    adminRole = 'admin',
    defaultRole = 'user',
    roleField = 'role',
  } = options

  const before: CollectionBeforeChangeHook = async ({ data, operation, req, context }) => {
    if (operation !== 'create') {
      return data
    }

    // Honor an incoming role only for an authenticated admin; otherwise force
    // the default. Applied in both the success and error branches (fail closed).
    const byAdmin = hasAnyRole(req?.user as { role?: unknown } | null, [adminRole])
    const resolvedRole = byAdmin ? (data[roleField] ?? defaultRole) : defaultRole

    try {
      const { totalDocs } = await req.payload.count({
        collection: usersSlug,
        overrideAccess: true,
      })

      if (totalDocs === 0) {
        // Bootstrap the first user as admin; mark so afterChange can resolve
        // a concurrent-signup race to a single admin.
        if (context) context[FIRST_ADMIN_MARKER] = true
        return {
          ...data,
          [roleField]: adminRole,
        }
      }

      return {
        ...data,
        [roleField]: resolvedRole,
      }
    } catch (error) {
      // On error, don't block user creation - but never honor a client role.
      console.warn('[betterAuthCollections] Failed to check user count:', error)
      return {
        ...data,
        [roleField]: resolvedRole,
      }
    }
  }

  const after: CollectionAfterChangeHook = async ({ doc, operation, req, context }) => {
    if (operation !== 'create') return doc
    if (!context?.[FIRST_ADMIN_MARKER]) return doc

    try {
      const admins = await req.payload.find({
        collection: usersSlug,
        where: { [roleField]: { equals: adminRole } },
        limit: 100,
        depth: 0,
        overrideAccess: true,
      })
      if (admins.docs.length <= 1) return doc

      // Keep only the canonical first admin; demote this one if it isn't it.
      const keep = [...(admins.docs as Array<{ id: unknown; createdAt?: unknown }>)].sort(
        compareCreated
      )[0]
      if (String(keep.id) === String(doc.id)) return doc

      await req.payload.update({
        collection: usersSlug,
        id: doc.id as string | number,
        data: { [roleField]: defaultRole },
        overrideAccess: true,
      })
      return { ...doc, [roleField]: defaultRole }
    } catch (error) {
      console.warn(
        '[betterAuthCollections] first-user-admin race resolution failed:',
        error
      )
      return doc
    }
  }

  return { before, after }
}

/**
 * Inject the first-user-admin hooks (before + after) into a collection.
 */
function injectFirstUserAdminHook(
  collection: CollectionConfig,
  options: FirstUserAdminOptions,
  usersSlug: string
): CollectionConfig {
  const { before, after } = createFirstUserAdminHooks(options, usersSlug)
  const existingBefore = collection.hooks?.beforeChange ?? []
  const existingAfter = collection.hooks?.afterChange ?? []

  return {
    ...collection,
    hooks: {
      ...collection.hooks,
      beforeChange: [
        before,
        ...(Array.isArray(existingBefore) ? existingBefore : [existingBefore]),
      ],
      afterChange: [
        ...(Array.isArray(existingAfter) ? existingAfter : [existingAfter]),
        after,
      ],
    },
  }
}

/**
 * Determine if a field should be saved to JWT.
 * Session-critical fields are included, large data fields are excluded.
 */
function getSaveToJWT(modelKey: string, fieldName: string): boolean | undefined {
  // Session fields - include core session data.
  // Use an EXACT allowlist, not suffix matching: a suffix match on 'token' etc.
  // would auto-include any future session field ending in 'Token' (e.g. a
  // plugin's `refreshToken`/`oneTimeToken`), leaking secrets into every JWT.
  if (modelKey === 'session') {
    const includeFields = ['token', 'expiresAt', 'user', 'userId', 'ipAddress', 'userAgent', 'activeOrganizationId', 'activeTeamId']
    const excludeFields = ['createdAt', 'updatedAt']

    if (includeFields.includes(fieldName)) {
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
    case 'number[]':
    case 'array':
      // Payload has no native scalar-array field; `json` stores them natively.
      return 'json'
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
    // Only treat as a relationship if it references the target's 'id' field.
    // When referencing a non-PK field (e.g., oauthClient.clientId), use a plain
    // text field instead — Payload relationships always FK to 'id', which would
    // cause FK constraint violations for non-PK references.
    const hasReferences = fieldDef.references !== undefined &&
      (!fieldDef.references.field || fieldDef.references.field === 'id')
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

  const indexes = buildCompoundIndexes(table, fields)

  return {
    slug,
    admin: {
      useAsTitle: titleField ?? 'id',
      group: adminGroup,
      description: `Auto-generated from Better Auth schema (${modelKey})`,
    },
    access: customAccess ?? defaultAccess,
    fields,
    ...(indexes.length > 0 && { indexes }),
    timestamps: true,
  }
}

/**
 * Translate Better Auth's table-level `indexes` into Payload compound indexes.
 *
 * Better Auth 1.7 moved constraints that used to be implicit into the schema
 * itself — most importantly `account`'s unique `(issuer, accountId)`, which is
 * what stops one provider identity from being linked to two users. Passing them
 * through keeps the generated collections a faithful projection of Better
 * Auth's schema instead of a lossy one.
 *
 * Index entries name Better Auth fields; relationship fields are renamed on the
 * Payload side (`userId` → `user`), so map through the generated field list and
 * drop any index we can't fully resolve rather than emitting one that points at
 * a column Payload doesn't have.
 */
function buildCompoundIndexes(
  table: ReturnType<typeof getAuthTables>[string],
  fields: Field[]
): NonNullable<CollectionConfig['indexes']> {
  const tableIndexes = (table as { indexes?: { fields: string[]; unique?: boolean }[] }).indexes
  if (!Array.isArray(tableIndexes) || tableIndexes.length === 0) return []

  const generatedNames = new Set(
    fields.map((f) => ('name' in f ? f.name : undefined)).filter(Boolean) as string[]
  )

  const resolved: NonNullable<CollectionConfig['indexes']> = []
  for (const index of tableIndexes) {
    if (!Array.isArray(index.fields) || index.fields.length === 0) continue

    const mapped: string[] = []
    for (const fieldKey of index.fields) {
      const fieldDef = table.fields[fieldKey]
      const payloadName = fieldDef?.fieldName ?? fieldKey
      // Reference fields become relationships named without the Id suffix.
      const candidate = generatedNames.has(payloadName)
        ? payloadName
        : payloadName.replace(/(_id|Id)$/, '')
      if (!generatedNames.has(candidate)) {
        mapped.length = 0
        break
      }
      mapped.push(candidate)
    }

    if (mapped.length === index.fields.length) {
      resolved.push({ fields: mapped, ...(index.unique && { unique: true }) })
    } else {
      console.warn(
        `[betterAuthCollections] skipping index on '${table.modelName}' — ` +
          `field(s) not present on the generated collection: ${index.fields.join(', ')}`
      )
    }
  }

  return resolved
}

/**
 * Get existing field names from a collection, recursing into presentational
 * containers whose children live at the parent data level (`row`, `collapsible`,
 * and unnamed `tabs`). Named containers (`group`, named tabs) namespace their
 * children, so those are NOT collected as top-level names (only the container's
 * own name is). Without this recursion, a users collection that organizes
 * `email`/`role` inside tabs/rows would have those fields re-added by
 * augmentation, producing duplicate-field config errors.
 */
export function getExistingFieldNames(fields: Field[]): Set<string> {
  const names = new Set<string>()
  collectFieldNames(fields, names)
  return names
}

function collectFieldNames(fields: Field[], names: Set<string>): void {
  for (const field of fields) {
    if ('name' in field && field.name) {
      names.add(field.name)
    }
    if (field.type === 'row' || field.type === 'collapsible') {
      collectFieldNames(field.fields, names)
    } else if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        // Only unnamed tabs keep their fields at the parent (top) level.
        if (!('name' in tab) || !tab.name) {
          collectFieldNames(tab.fields as Field[], names)
        }
      }
    }
  }
}

/**
 * Augment an existing collection with missing fields from Better Auth schema.
 * This ensures user-defined collections (like 'users') get plugin fields automatically.
 */
export function augmentCollectionWithMissingFields(
  collection: CollectionConfig,
  table: ReturnType<typeof getAuthTables>[string],
  usePlural: boolean,
  modelKey: string,
  configureSaveToJWT = true,
  secretFields?: string[]
): CollectionConfig {
  const existingFieldNames = getExistingFieldNames(collection.fields)
  const missingFields: Field[] = []

  for (const [fieldKey, fieldDef] of Object.entries(table.fields)) {
    // Skip standard fields that Payload handles
    if (['id', 'createdAt', 'updatedAt'].includes(fieldKey)) {
      continue
    }

    const fieldName = fieldDef.fieldName ?? fieldKey
    // Only treat references to a primary key ('id') as relationships. Non-PK
    // references (e.g. oauthRefreshToken.clientId → oauthClient.clientId) stay
    // plain fields keeping their original name — matching generateCollection()
    // and what the adapter writes (it does not rename non-PK references).
    const hasReferences = fieldDef.references !== undefined &&
      (!fieldDef.references.field || fieldDef.references.field === 'id')

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

  // Lock secret fields among the ones WE are adding. Fields already defined on
  // the consumer's collection are theirs and are never modified.
  const addedFields = secretFields?.length
    ? missingFields.map((field) =>
        'name' in field && field.name && secretFields.includes(field.name)
          ? lockField(field)
          : field
      )
    : missingFields

  // Return augmented collection
  return {
    ...collection,
    fields: [...collection.fields, ...addedFields],
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
    secureSecretFields,
    customizeCollection,
  } = options

  const secretFieldsByModel = resolveSecretFields(secureSecretFields)

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

    // Security reminder: with firstUserAdmin disabled, the plugin's role-forcing
    // guard is NOT injected into the user collection, so the consumer must
    // constrain create access themselves. Otherwise Payload's auto-REST exposes
    // an anonymous POST /api/<users> that can seed a row with a privileged role.
    // (Fires once at config-build time — Payload builds the config once.)
    if (firstUserAdmin === false) {
      console.warn(
        `[betterAuthCollections] firstUserAdmin is disabled — the plugin's role-forcing ` +
          `guard is OFF for the "${usersSlug}" collection. You are responsible for preventing ` +
          `privilege escalation: ensure the collection's \`access.create\` AND the role field's ` +
          `\`access.create\` reject anonymous/non-admin callers. Otherwise Payload auto-REST ` +
          `(POST /api/${usersSlug}) may let anyone create a user with an arbitrary role.`
      )
    }

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
          configureSaveToJWT,
          secretFieldsByModel?.[modelKey]
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

      // Lock secret fields before customizeCollection, so the callback stays
      // the final word on the collection's shape.
      const secretFields = secretFieldsByModel?.[modelKey]
      if (secretFields?.length) {
        collection = lockSecretFields(collection, secretFields)
      }

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
