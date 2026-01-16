# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
