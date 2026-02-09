# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.13] - 2026-02-09

### Added

#### Type-Safe Session Helpers

`getServerSession` and `getServerUser` now accept a generic type parameter so the returned user is typed as your Payload `User` type instead of a loose `Record<string, unknown>`.

**Option A — Pass the generic at each call site:**

```ts
import { getServerSession } from '@delmaredigital/payload-better-auth'
import type { User } from '@/payload-types'

const session = await getServerSession<User>(payload, headers)
session.user.role       // ✅ fully typed
session.user.firstName  // ✅ fully typed
```

**Option B (recommended) — Create typed helpers once, import everywhere:**

```ts
// lib/auth.ts
import { createSessionHelpers } from '@delmaredigital/payload-better-auth'
import type { User } from '@/payload-types'

export const { getServerSession, getServerUser } = createSessionHelpers<User>()
```

```ts
// app/page.tsx — no generic needed
import { getServerSession } from '@/lib/auth'

const session = await getServerSession(payload, headers)
session.user.role  // ✅ typed
```

Both `getServerSession` and `getServerUser` are fully backward-compatible — omitting the generic returns the same loose type as before.

## [0.3.10] - 2026-01-28

### Fixed

#### Reduced Published Package Size

Disabled source maps (`.js.map`) and declaration maps (`.d.ts.map`) from the published package. These files doubled the unpacked size and served no purpose since source files are no longer included in the package.

---

## [0.3.9] - 2026-01-28

### Fixed

#### Package Exports Pointing to Source Files

Fixed critical issue where the published package's `exports` field pointed to TypeScript source files (`src/`) instead of compiled JavaScript (`dist/`). This caused "Unknown module type" errors when using the package with Turbopack.

The `publishConfig.exports` pattern does not work reliably with pnpm - the exports are not overwritten during publish. Changed to point `exports` directly to `dist/`.

---

## [0.3.8] - 2026-01-28

### Fixed

#### Multi-Role Access Control for Generated Collections

The default access control for auto-generated collections (sessions, accounts, verifications, etc.) now correctly handles users with array-based roles. Previously, users with `role: ['admin', 'editor']` were silently denied access because the inline check only matched exact string values.

The fix uses the existing `isAdmin()` utility which properly normalizes roles via `normalizeRoles()` and checks with `hasAnyRole()`.

Thanks to [@Rot4tion](https://github.com/Rot4tion) for contributing this fix in PR #6.

### Changed

#### Build System Migration to SWC

Migrated from pure TypeScript compilation to SWC for faster builds:

- **Build time**: ~85ms for 41 files (vs several seconds with tsc)
- **TypeScript**: Now only emits declaration files (`.d.ts`)
- **Source maps**: Enabled for debugging

Build commands remain the same:
```bash
pnpm build      # Full build (SWC + types)
pnpm dev        # Watch mode with SWC
```

#### Updated Documentation

Added caution note in README clarifying that the `access` option in `betterAuthCollections()` completely replaces the default access object rather than merging with it. Documents the default access settings for reference.

## [0.3.7] - 2026-01-26

### Fixed

#### LoginView Plugin Options Now Typed Correctly (#5)

The following options were documented in the README and working in `LoginView`, but the TypeScript types in `BetterAuthPluginAdminOptions.login` were missing them:

- `enableSignUp?: boolean | 'auto'` - Enable user registration (auto-detects by default)
- `defaultSignUpRole?: string` - Default role for new users (default: `'user'`)
- `enableForgotPassword?: boolean | 'auto'` - Enable password reset (auto-detects by default)
- `resetPasswordUrl?: string` - Custom URL for password reset page
- `enablePasskey` now also supports `'auto'` for auto-detection

These options were already wired through to `LoginView` but TypeScript would error when trying to use them.

### Added

#### `payloadAuthPlugins` Export for Custom Plugin Support (#4)

New `payloadAuthPlugins` export enables adding custom plugins (like Stripe) with full TypeScript type safety:

```typescript
import { createAuthClient, payloadAuthPlugins } from '@delmaredigital/payload-better-auth/client'
import { stripeClient } from '@better-auth/stripe/client'

export const authClient = createAuthClient({
  plugins: [...payloadAuthPlugins, stripeClient({ subscription: true })],
})

// authClient.subscription is fully typed!
```

This approach uses Better Auth's native `createAuthClient` (which we re-export) combined with our default plugins tuple. This gives you full type inference for any custom plugins you add, unlike wrapper functions that lose type information.

**For simple setups without custom plugins**, `createPayloadAuthClient()` still works and is the easiest option:

```typescript
import { createPayloadAuthClient } from '@delmaredigital/payload-better-auth/client'

export const authClient = createPayloadAuthClient()
```

### Changed

#### Documentation Clarifications

- **Auto-detection is the default**: Clarified that `enableSignUp`, `enableForgotPassword`, and `enablePasskey` all support `'auto'` (the default), which automatically detects availability from Better Auth's endpoints. No configuration needed for most cases.
- **Customization paths**: Added clearer documentation for overriding/disabling the `LoginView` and using custom admin or frontend login components.
- **Custom plugins**: Updated client documentation to show `payloadAuthPlugins` pattern for Stripe and other custom plugins with full type safety.

## [0.3.6] - 2026-01-26

### Added

#### `apiKeyWithDefaults` Utility

New wrapper for Better Auth's `apiKey()` plugin that enables metadata by default:

```typescript
import { apiKeyWithDefaults } from '@delmaredigital/payload-better-auth'

export const betterAuthOptions = {
  plugins: [
    apiKeyWithDefaults(),  // Use instead of apiKey()
  ],
}
```

This enables storing scope names in metadata so they display in the admin UI after key creation. The handler also gracefully retries without metadata if the plugin isn't configured with it enabled.

#### `withBetterAuthDefaults` Utility

New utility function that applies sensible defaults to Better Auth options. Currently handles:

- **trustedOrigins**: If not explicitly provided but `baseURL` is set, defaults to `[baseURL]`

This simplifies the common single-domain case where users only need to set `baseURL`:

```typescript
import { withBetterAuthDefaults, payloadAdapter } from '@delmaredigital/payload-better-auth'

createBetterAuthPlugin({
  createAuth: (payload) => betterAuth(withBetterAuthDefaults({
    database: payloadAdapter({ payloadClient: payload }),
    baseURL: process.env.BETTER_AUTH_URL,
    // trustedOrigins automatically becomes [baseURL]
  })),
})
```

Multi-domain setups can still explicitly set `trustedOrigins` to include multiple origins - the utility won't override explicit configuration.

#### First User Admin

The first registered user is now automatically made an admin. This is enabled by default via `betterAuthCollections()`.

```typescript
betterAuthCollections({
  betterAuthOptions,
  // firstUserAdmin: true  ← enabled by default
})
```

**Customize:**
```typescript
betterAuthCollections({
  betterAuthOptions,
  firstUserAdmin: {
    adminRole: 'super-admin',  // default: 'admin'
    defaultRole: 'member',      // default: 'user'
    roleField: 'userRole',      // default: 'role'
  },
})
```

**Disable:**
```typescript
betterAuthCollections({
  betterAuthOptions,
  firstUserAdmin: false,
})
```

A standalone `firstUserAdminHooks()` utility is also exported for use with Better Auth's `databaseHooks` in advanced scenarios.

### Fixed

#### Admin Sidebar Only Shows Enabled Plugins (#2)

The Security navigation section now conditionally shows links based on which Better Auth plugins are actually enabled. Previously, all three links (Two-Factor Auth, API Keys, Passkeys) were shown regardless of configuration.

- Links are now passed via `clientProps` injection
- If no security plugins are enabled, the Security section doesn't appear

#### API Key Creation with Scopes (#3)

Creating API keys with permission scopes from the admin UI now works correctly. Previously, this failed with "THE_PROPERTY_YOURE_TRYING_TO_SET_CAN_ONLY_BE_SET_FROM_THE_SERVER_AUTH_INSTANCE_ONLY" because Better Auth marks `permissions` as server-only.

The fix intercepts API key creation requests in the endpoint handler and:
1. Extracts scopes from the request
2. Converts scopes to permissions server-side using `scopesToPermissions()`
3. Calls `auth.api.createApiKey()` with the permissions

The UI now sends `scopes` instead of `permissions`, and the server handles the conversion.

#### Adapter Returns Database Results Over Input Data

The adapter now correctly prioritizes database results over input data when returning from create/update operations. This fixes an issue where Payload hooks that modify data (like `firstUserAdmin` setting role to 'admin') were being overwritten by the original input data.

#### Session Re-fetch After Signup

The LoginView now re-fetches the session after signup to get the updated user data. This ensures that role changes from Payload hooks (like `firstUserAdmin`) are reflected immediately, preventing the "Access Denied" screen after first user registration.

#### ID Field Type Conversion for Serial IDs

When using `generateId: 'serial'`, fields like `activeOrganizationId` were returned as strings from Better Auth, but Payload expects numbers for relationship lookups. This caused access control queries like `{ organization: { equals: user.activeOrganizationId } }` to fail.

The adapter now automatically converts ID fields matching `*Id` or `*_id` patterns to numbers when `idType` is `'number'`.

### Added

#### ID Field Conversion Customization

New adapter config options to customize which fields are converted:

```typescript
payloadAdapter({
  payloadClient: payload,
  adapterConfig: {
    // Add fields that don't follow the *Id pattern
    idFieldsAllowlist: ['customOrgRef'],

    // Exclude fields that end in 'Id' but aren't ID references
    idFieldsBlocklist: ['visitorId', 'correlationId'],
  },
})
```

---

## [0.3.3] - 2026-01-23

### Fixed

#### Session Fields Now Available on req.user

When using Better Auth plugins that store data on the session (like the organization plugin), those fields are now available on `req.user` in Payload access control functions.

**Before:** `req.user.activeOrganizationId` was always `undefined`

**After:** Session fields are merged onto the user object:
- `req.user.activeOrganizationId` - from organization plugin
- `req.user.organizationRole` - user's role in the active organization (auto-fetched from members collection)
- Any other session fields from enabled plugins

This enables organization-scoped access control patterns:

```typescript
export const orgReadAccess: Access = ({ req }) => {
  if (!req.user?.activeOrganizationId) return false
  return {
    organization: { equals: req.user.activeOrganizationId }
  }
}
```

### Added

- New `membersCollection` option for `betterAuthStrategy()` to customize the members collection slug (default: `'members'`)

---

## [0.3.2] - 2026-01-19

### Fixed

#### Login Configuration Props Now Work

The `admin.login` configuration options (like `afterLoginPath`, `requiredRole`, `enablePasskey`, etc.) were not being passed to the LoginView component. This has been fixed by:

- Added `LoginViewWrapper` RSC that reads config from `payload.config.custom.betterAuth.login`
- Plugin now stores login config in `config.custom.betterAuth.login` for the wrapper to access
- The wrapper passes all configured props to the client LoginView component

All login configuration options now work as documented:

```typescript
createBetterAuthPlugin({
  createAuth,
  admin: {
    login: {
      afterLoginPath: '/admin/page-tree',  // Now works!
      requiredRole: ['admin', 'editor'],
      enablePasskey: true,
    },
  },
})
```

---

## [0.3.1] - 2026-01-15

### Added

#### User Registration in LoginView

The `LoginView` component now supports inline user registration:

```typescript
createBetterAuthPlugin({
  createAuth,
  admin: {
    login: {
      enableSignUp: true,         // or 'auto' to detect availability (default)
      defaultSignUpRole: 'user',  // Role for new users (default: 'user')
    },
  },
})
```

Features:
- "Create account" link appears when sign-up is available
- Full registration form with name, email, password, and confirmation
- Automatic role assignment via `defaultSignUpRole`
- Email verification support (shows success message if verification required)
- Role-based access control still applies after registration

#### Forgot Password in LoginView

The `LoginView` component now supports inline password reset:

```typescript
createBetterAuthPlugin({
  createAuth,
  admin: {
    login: {
      enableForgotPassword: true,   // or 'auto' to detect availability (default)
      resetPasswordUrl: '/custom',  // Optional: redirect to custom page
    },
  },
})
```

Features:
- "Forgot password?" link appears when password reset is available
- Inline email form to request reset link
- Confirmation view after sending reset email
- Optional redirect to custom reset page via `resetPasswordUrl`

### Changed

- Improved README Quick Start example with cleaner `adapterConfig` usage (debug logging now opt-in via comment)
- Added note about vanilla starter folder-based collection structure
- Added important warning about not adding custom `beforeLogin` component

---

## [0.3.0] - 2026-01-14

This is a major release with significant new features including security management UI, access control helpers, API key scopes, passkey support, and a comprehensive type system.

### Breaking Changes

#### Adapter Configuration

The `adapterConfig.collections` option has been **removed**. Custom collection names are now configured using Better Auth's official `modelName` pattern:

**Before (0.2.x):**
```typescript
payloadAdapter({
  payloadClient: payload,
  adapterConfig: {
    collections: { user: 'members', session: 'auth_sessions' },
  },
})
```

**After (0.3.0):**
```typescript
// Configure in BetterAuthOptions instead:
betterAuth({
  database: payloadAdapter({ payloadClient: payload }),
  user: { modelName: 'member' },        // Singular - becomes 'members'
  session: { modelName: 'auth_session' }, // Singular - becomes 'auth_sessions'
})
```

**Note:** With `usePlural: true` (the default), provide **singular** model names. They get pluralized automatically.

#### Collection Generator

The `slugOverrides` option has been **removed** from `betterAuthCollections()`. Use Better Auth's `modelName` config instead (same as above).

### Added

#### Schema-Aware Adapter

The adapter now uses Better Auth's `createAdapterFactory` for proper schema-aware transformations:
- Automatic support for **all Better Auth plugins** (twoFactor, organization, passkey, admin, apiKey, etc.)
- No more hardcoded field mappings - uses schema introspection
- Automatic field name transformations (e.g., `userId` ↔ `user` for relationships)
- Reference field value type conversion (string UUIDs ↔ numbers for SERIAL)
- All operations use `overrideAccess: true` to prevent Payload access control from blocking auth operations

#### Default to SERIAL IDs

The adapter now defaults to `'number'` (SERIAL) IDs to match Payload's default behavior:
- No configuration needed for typical Payload setups
- Set `adapterConfig: { idType: 'text' }` if using UUIDs
- Helpful warnings for common configuration mistakes

#### Security Management UI

Auto-injected management views for security features based on which Better Auth plugins are enabled:

| View | Path | Plugin Required |
|------|------|-----------------|
| Two-Factor Auth | `/admin/security/two-factor` | `twoFactor()` |
| API Keys | `/admin/security/api-keys` | `apiKey()` |
| Passkeys | `/admin/security/passkeys` | `passkey()` |

Features:
- **Two-Factor Management**: Enable/disable 2FA, QR code setup, backup codes display
- **API Keys Management**: Create/delete keys, scope selection UI with collection grouping, bulk actions
- **Passkeys Management**: Register/delete passkeys with WebAuthn

A "Security" navigation section is added to the admin sidebar automatically.

Configure via:
```typescript
createBetterAuthPlugin({
  createAuth,
  admin: {
    betterAuthOptions,      // Required for plugin detection
    enableManagementUI: true,  // Default: true
    managementPaths: {
      twoFactor: '/security/two-factor',
      apiKeys: '/security/api-keys',
      passkeys: '/security/passkeys',
    },
  },
})
```

#### Access Control Helpers

New utility functions for common authorization patterns:

```typescript
import {
  isAdmin,
  isAdminField,
  isAdminOrSelf,
  canUpdateOwnFields,
  isAuthenticated,
  isAuthenticatedField,
  hasRole,
  hasRoleField,
  requireAllRoles,
  normalizeRoles,
  hasAnyRole,
  hasAllRoles,
  hasAdminRoles,
} from '@delmaredigital/payload-better-auth'

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    read: isAdminOrSelf({ adminRoles: ['admin'] }),
    update: canUpdateOwnFields({
      allowedFields: ['name', 'image', 'password'],
      requireCurrentPassword: true,
    }),
    delete: isAdmin(),
  },
}
```

#### API Key Permission Scopes

API keys can now have granular permission scopes that control what resources they can access. Scopes are human-readable permission groups similar to GitHub OAuth scopes.

**Zero Config (auto-generates from collections):**
```typescript
createBetterAuthPlugin({
  createAuth,
  // Auto-generates: posts:read, posts:write, posts:delete, etc.
})
```

**Custom Scopes:**
```typescript
createBetterAuthPlugin({
  createAuth,
  admin: {
    apiKey: {
      scopes: {
        'content:read': {
          label: 'Read Content',
          description: 'View posts and pages',
          permissions: { posts: ['read'], pages: ['read'] }
        },
        'content:manage': {
          label: 'Manage Content',
          description: 'Full content management',
          permissions: { posts: ['*'], pages: ['*'] }
        }
      },
      defaultScopes: ['content:read']
    }
  }
})
```

The API Keys management UI shows:
- Scopes grouped by collection with collapsible sections
- Bulk action buttons: All Read, All Write, All Delete, Select All, Clear
- Selection count badges and permission summary

#### API Key Scope Enforcement

New access control functions for enforcing API key scopes:

```typescript
import {
  requireScope,
  requireAnyScope,
  requireAllScopes,
  allowSessionOrScope,
  allowSessionOrAnyScope,
  validateApiKey,
  hasScope,
  hasAnyScope,
  hasAllScopes,
  extractApiKeyFromRequest,
  getApiKeyInfo,
} from '@delmaredigital/payload-better-auth'

export const Posts: CollectionConfig = {
  slug: 'posts',
  access: {
    read: requireScope('posts:read'),
    create: requireScope('posts:write'),
    delete: requireAllScopes(['posts:delete', 'admin:write']),
  },
}
```

Supports:
- Wildcard scopes (`posts:*`, `*`)
- Mixed session/API key authentication with `allowSessionOrScope()`

#### Pre-configured Auth Client Factory

New `createPayloadAuthClient()` convenience factory:

```typescript
import { createPayloadAuthClient } from '@delmaredigital/payload-better-auth/client'

// Pre-configured with twoFactor, apiKey, and passkey plugins
const authClient = createPayloadAuthClient()

// All methods available:
await authClient.signIn.email({ email, password })
await authClient.twoFactor.verifyTotp({ code })
await authClient.passkey.addPasskey({ name: 'My Device' })
```

For full control, the raw `createAuthClient` is still available:
```typescript
import { createAuthClient, twoFactorClient, passkeyClient, apiKeyClient } from '@delmaredigital/payload-better-auth/client'
```

#### Bundled Passkey Package

The `@better-auth/passkey` package is now bundled - no separate installation required.

#### Passkey Components

New components for passkey authentication:

```typescript
import { PasskeySignInButton, PasskeyRegisterButton } from '@delmaredigital/payload-better-auth/components'

// Sign-in button
<PasskeySignInButton
  onSuccess={(user) => router.push('/dashboard')}
  onError={(error) => setError(error)}
  label="Sign in with Passkey"
/>

// Registration button
<PasskeyRegisterButton
  passkeyName="My MacBook"
  onSuccess={(passkey) => refetchPasskeys()}
/>
```

Enable in LoginView:
```typescript
createBetterAuthPlugin({
  createAuth,
  admin: {
    login: {
      enablePasskey: true,  // Shows "Sign in with Passkey" button
    },
  },
})
```

#### Multiple Role Support in LoginView

The `requiredRole` option now accepts an array of roles:

```typescript
createBetterAuthPlugin({
  createAuth,
  admin: {
    login: {
      // Any of these roles grants access
      requiredRole: ['admin', 'editor', 'moderator'],

      // Or require ALL roles
      requiredRole: ['admin', 'content-manager'],
      requireAllRoles: true,

      // Disable role checking
      requiredRole: null,
    },
  },
})
```

#### Inline Two-Factor Authentication

The `LoginView` component now handles 2FA verification inline:
1. User enters email/password
2. If 2FA is required, form transitions to TOTP code input
3. User enters 6-digit code from authenticator app
4. Upon verification, user is redirected to admin panel

No additional configuration needed.

#### SaveToJWT Auto-Configuration

The `betterAuthCollections()` plugin now auto-configures `saveToJWT` for session-critical fields:
- **Sessions**: token, expiresAt, userId, ipAddress, userAgent
- **Users**: role, email, twoFactorEnabled

Disable with `configureSaveToJWT: false` if needed.

#### Auto-Add Missing Fields

The `betterAuthCollections()` plugin automatically adds missing plugin-specific fields to existing collections. For example, with the `twoFactor` plugin enabled, the `twoFactorEnabled` field is automatically added to your Users collection:
```
[better-auth] Auto-adding fields to 'users': ['twoFactorEnabled']
```

#### Enhanced Type System

Comprehensive TypeScript types for Better Auth integration:

```typescript
import type {
  // Core integration types
  BetterAuthReturn,
  PayloadWithAuth,
  PayloadRequestWithBetterAuth,
  CollectionHookWithBetterAuth,
  EndpointWithBetterAuth,
  RoleArray,

  // Generated schema types
  User,
  BetterAuthSession,
  Account,
  Apikey,
  Passkey,
  Organization,
  Member,
  TwoFactor,
  // ... and more

  // Configuration types
  ScopeDefinition,
  ApiKeyScopesConfig,
  AvailableScope,
  RoleCheckConfig,
  SelfAccessConfig,
  FieldUpdateConfig,
  ApiKeyInfo,
  ApiKeyAccessConfig,
} from '@delmaredigital/payload-better-auth'
```

Run `pnpm generate:types` to regenerate types after adding Better Auth plugins.

#### Password Reset UI Components

New components at `@delmaredigital/payload-better-auth/components/auth`:

- `ForgotPasswordView` - Email input form to request password reset
- `ResetPasswordView` - New password form with token validation

#### Two-Factor Authentication UI Components

New components at `@delmaredigital/payload-better-auth/components/twoFactor`:

- `TwoFactorSetupView` - QR code display, manual secret, backup codes, verification
- `TwoFactorVerifyView` - TOTP or backup code entry during login

#### Collection Customization Callback

New `customizeCollection` option for `betterAuthCollections()`:

```typescript
betterAuthCollections({
  betterAuthOptions,
  customizeCollection: (modelKey, collection) => {
    if (modelKey === 'session') {
      return {
        ...collection,
        hooks: { afterDelete: [cleanupHook] },
      }
    }
    return collection
  },
})
```

#### Test Infrastructure

Added Vitest test suite with unit tests covering adapter initialization, ID type detection, CRUD operations, and custom collection name handling.

### Changed

- All authentication components now use the official Better Auth client SDK instead of raw `fetch()` calls
- `betterAuthCollections()` has `usePlural` option (default: `true`) to control collection name pluralization
- Improved field type mapping with JSON and array type support
- Better relationship detection using schema references

### Fixed

- Fixed critical bug where adapter database operations were blocked by Payload's access control (now uses `overrideAccess: true`)
- Role check after 2FA now correctly fetches session before validation

### Migration from 0.2.x

1. **Remove `adapterConfig.collections`** - Move custom names to `BetterAuthOptions`:
   ```typescript
   // In betterAuth() config, not payloadAdapter():
   user: { modelName: 'member' },
   session: { modelName: 'auth_session' },
   ```

2. **Remove `slugOverrides`** from `betterAuthCollections()` - Same migration as above

3. **ID type now defaults to 'number'** - Remove `adapterConfig.idType: 'number'` as it's now the default

4. **Update client imports** (optional) - Consider using the new pre-configured client:
   ```typescript
   // Old
   import { createAuthClient } from '@delmaredigital/payload-better-auth/client'
   const client = createAuthClient({ baseURL: '...', plugins: [...] })

   // New (recommended)
   import { createPayloadAuthClient } from '@delmaredigital/payload-better-auth/client'
   const client = createPayloadAuthClient()  // Pre-configured with common plugins
   ```

---

## [0.2.0] - 2026-01-11

### Added

#### Automatic Auth API Endpoints

The plugin now auto-registers `/api/auth/*` endpoints via Payload's endpoint system, eliminating the need to manually create an `app/api/auth/[...all]/route.ts` file.

- Endpoints are registered for GET, POST, PATCH, PUT, DELETE methods
- Requests are proxied to Better Auth's handler
- Configurable via `authBasePath` option (default: `/auth`)
- Can be disabled with `autoRegisterEndpoints: false` for advanced use cases

#### Automatic Admin Components

When `disableLocalStrategy: true` is detected in your Users collection, the plugin automatically injects admin components:

- **LogoutButton**: Styled to match Payload's admin nav using CSS variables
- **BeforeLogin**: Redirects to `/admin/login` for custom authentication
- **LoginView**: Full login page matching Payload's admin theme (light/dark mode)

All components use Payload's CSS variables for native theme integration.

#### Plugin Configuration Options

New options for `createBetterAuthPlugin()`:

```typescript
createBetterAuthPlugin({
  createAuth,
  authBasePath: '/auth',              // Customize auth endpoint path
  autoRegisterEndpoints: true,        // Auto-register API endpoints
  autoInjectAdminComponents: true,    // Auto-inject admin components
  admin: {
    disableLogoutButton: false,       // Disable logout button injection
    disableBeforeLogin: false,        // Disable BeforeLogin injection
    disableLoginView: false,          // Disable login view injection
    login: {
      title: 'Login',                 // Customize login page title
      afterLoginPath: '/admin',       // Redirect after successful login
    },
    // Override with custom components (import map format)
    logoutButtonComponent: '@/components/MyLogout',
    beforeLoginComponent: '@/components/MyBeforeLogin',
    loginViewComponent: '@/components/MyLoginView',
  },
})
```

#### New Export: Components

Admin components are now available for direct use or customization:

```typescript
import { LogoutButton, BeforeLogin, LoginView } from '@delmaredigital/payload-better-auth/components'
```

#### New Export: detectAuthConfig

Utility function to detect auth configuration in Payload config:

```typescript
import { detectAuthConfig } from '@delmaredigital/payload-better-auth'

const result = detectAuthConfig(config)
// { hasDisableLocalStrategy: boolean, authCollectionSlug: string | null, ... }
```

### Changed

- `BetterAuthPluginOptions` expanded with new configuration options
- README simplified with reduced setup steps (7 steps → 4 steps)
- Plugin now scans collections to detect `disableLocalStrategy` configuration

### Migration from 0.1.x

If upgrading from 0.1.x, you can simplify your setup:

1. **Remove manual API route** - Delete `app/api/auth/[...all]/route.ts`
2. **Remove manual admin components** - Delete custom BeforeLogin, Logout, and login page components
3. **Remove admin.components configuration** - Remove from payload.config.ts

The plugin now handles all of the above automatically when `disableLocalStrategy: true` is detected.

---

## [0.1.5] - 2026-01-10

### Changed

- Switch license to MIT

---

## [0.1.4] - 2026-01-09

### Fixed

- Initial stable release
- Payload adapter for Better Auth
- Collection auto-generation from Better Auth schema
- Auth strategy for Payload collections
- Session utilities for server-side access
