/**
 * @delmare/payload-better-auth
 *
 * Better Auth adapter and plugins for Payload CMS.
 * Enables seamless integration between Better Auth and Payload.
 *
 * @packageDocumentation
 */

// Adapter
export { payloadAdapter, detectDbType, resolveIdType } from './adapter/index.js'
export type { PayloadAdapterConfig, DbType } from './adapter/index.js'

// Collection generator plugin
export { betterAuthCollections } from './adapter/collections.js'
export type { BetterAuthCollectionsOptions } from './adapter/collections.js'

// Payload plugin and strategy
export {
  createBetterAuthPlugin,
  betterAuthStrategy,
  resetAuthInstance,
  getApiKeyPermissionsConfig,
} from './plugin/index.js'
export type {
  Auth,
  CreateAuthFunction,
  BetterAuthPluginOptions,
  BetterAuthPluginAdminOptions,
  BetterAuthStrategyOptions,
} from './plugin/index.js'

// Enhanced Better Auth types with inference
export type {
  BetterAuthReturn,
  PayloadWithAuth,
  PayloadRequestWithBetterAuth,
  CollectionHookWithBetterAuth,
  EndpointWithBetterAuth,
  RoleArray,
} from './types/betterAuth.js'

// Generated schema types
export type {
  User,
  Session as BetterAuthSession,
  Account,
  Verification,
  Apikey,
  Passkey,
  Organization,
  Member,
  Invitation,
  Team,
  TeamMember,
  TwoFactor,
  BaseUserFields,
  BaseSessionFields,
  BaseAccountFields,
  UserPluginFields,
  SessionPluginFields,
  BetterAuthFullSchema,
  ModelKey,
  PluginId,
} from './generated-types.js'

// API key permission types
export type {
  PermissionDefinition,
  ApiKeyPermissionsConfig,
} from './types/apiKey.js'

// Permission utilities
export {
  generateCollectionPermissions,
} from './utils/generatePermissions.js'

// Access control utilities
export {
  normalizeRoles,
  hasAnyRole,
  hasAllRoles,
  hasAdminRoles,
  isAdmin,
  isAdminField,
  isAdminOrSelf,
  canUpdateOwnFields,
  isAuthenticated,
  isAuthenticatedField,
  hasRole,
  hasRoleField,
  requireAllRoles,
} from './utils/access.js'
export type {
  RoleCheckConfig,
  SelfAccessConfig,
  FieldUpdateConfig,
} from './utils/access.js'

// API key permission enforcement utilities
export {
  extractApiKeyFromRequest,
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  allowSessionOrPermission,
  allowSessionOrAnyPermission,
  requireApiKey,
} from './utils/apiKeyAccess.js'
export type {
  ApiKeyPermissionConfig,
  PermissionCheck,
} from './utils/apiKeyAccess.js'

// Auth config detection utility
export { detectAuthConfig } from './utils/detectAuthConfig.js'
export type { AuthDetectionResult } from './utils/detectAuthConfig.js'

// Session utilities
export { getServerSession, getServerUser, createSessionHelpers } from './utils/session.js'
export type { Session, SessionHelperOptions } from './utils/session.js'

// First user admin hook utility
export { firstUserAdminHooks } from './utils/firstUserAdmin.js'
export type { FirstUserAdminOptions } from './utils/firstUserAdmin.js'

// Better Auth defaults utility
export { withBetterAuthDefaults } from './utils/betterAuthDefaults.js'
