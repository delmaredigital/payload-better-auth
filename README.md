# @delmaredigital/payload-better-auth

Better Auth adapter and plugins for Payload CMS. Enables seamless integration between Better Auth and Payload.

<p align="center">
  <a href="https://demo.delmaredigital.com"><img src="https://img.shields.io/badge/Live_Demo-Try_It_Now-2ea44f?style=for-the-badge&logo=vercel&logoColor=white" alt="Live Demo - Try It Now"></a>
  &nbsp;&nbsp;
  <a href="https://github.com/delmaredigital/dd-starter"><img src="https://img.shields.io/badge/Starter_Template-Use_This-blue?style=for-the-badge&logo=github&logoColor=white" alt="Starter Template - Use This"></a>
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdelmaredigital%2Fdd-starter&project-name=my-payload-site&build-command=pnpm%20run%20ci&env=PAYLOAD_SECRET,BETTER_AUTH_SECRET&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%2C%7B%22type%22%3A%22blob%22%7D%5D"><img src="https://vercel.com/button" alt="Deploy with Vercel" height="32"></a>
</p>

---
## Documentation
For additional documentation and references, visit: [https://deepwiki.com/delmaredigital/payload-better-auth](https://deepwiki.com/delmaredigital/payload-better-auth)

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Customization](#customization)
- [Access Control Helpers](#access-control-helpers)
- [API Key Scope Enforcement](#api-key-scope-enforcement)
- [Plugin Compatibility](#plugin-compatibility)
- [Recipes](#recipes)
- [Types](#types)
- [License](#license)

---

## Installation

### Requirements

| Dependency | Version |
|------------|---------|
| `payload` | >= 3.69.0 |
| `@payloadcms/next` | >= 3.69.0 |
| `@payloadcms/ui` | >= 3.69.0 |
| `better-auth` | >= 1.4.0 |
| `next` | >= 15.4.8 |
| `react` | >= 19.2.1 |

### Install

```bash
pnpm add @delmaredigital/payload-better-auth better-auth
```

### Environment Variables

Better Auth requires these environment variables:

```bash
# Required
BETTER_AUTH_SECRET=your-secret-key-min-32-chars  # Must be at least 32 characters

# Optional - only needed if not using the getBaseUrl() helper below
BETTER_AUTH_URL=http://localhost:3000            # Your app's base URL

# OAuth Providers (if using social login)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
# etc.
```

**Notes:**
- `BETTER_AUTH_SECRET` is used for signing sessions and tokens - use a secure random string
- `BETTER_AUTH_URL` tells Better Auth where it's hosted - plugins like passkey derive their config from this
- WebAuthn (passkeys) requires HTTPS in production but works on `localhost` for development

**Vercel Deployment:**

For seamless support of Vercel preview deployments, use this helper instead of hardcoding URLs:

```ts
// src/lib/auth/getBaseUrl.ts
export function getBaseUrl() {
  // Vercel preview/production deployments
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  // Explicit override
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL
  // Local development
  return 'http://localhost:3000'
}
```

This automatically handles:
- **Local dev**: Uses `http://localhost:3000`
- **Vercel preview**: Uses the auto-generated `*.vercel.app` URL
- **Production**: Uses your custom domain (set `BETTER_AUTH_URL` in production env)

---

## Quick Start

### Step 1: Create Your Auth Configuration

```ts
// src/lib/auth/config.ts
import type { BetterAuthOptions } from 'better-auth'

export const betterAuthOptions: Partial<BetterAuthOptions> = {
  // Model names are SINGULAR - they get pluralized automatically
  // 'user' becomes 'users', 'session' becomes 'sessions', etc.
  user: {
    additionalFields: {
      role: { type: 'string', defaultValue: 'user' },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
  },
  emailAndPassword: { enabled: true },
}
```

### Step 2: Create Your Users Collection

```ts
// src/collections/Users/index.ts (vanilla starter uses folder-based collections)
import type { CollectionConfig } from 'payload'
import { betterAuthStrategy } from '@delmaredigital/payload-better-auth'

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    disableLocalStrategy: true,
    strategies: [betterAuthStrategy()],
  },
  access: {
    read: ({ req }) => {
      if (!req.user) return false
      if (req.user.role === 'admin') return true
      return { id: { equals: req.user.id } }
    },
    admin: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'email', type: 'email', required: true, unique: true },
    { name: 'emailVerified', type: 'checkbox', defaultValue: false },
    { name: 'name', type: 'text' },
    { name: 'image', type: 'text' },
    {
      name: 'role',
      type: 'select',
      defaultValue: 'user',
      options: [
        { label: 'User', value: 'user' },
        { label: 'Admin', value: 'admin' },
      ],
    },
  ],
}
```

> **Note:** Plugin-specific fields (e.g., `twoFactorEnabled` for 2FA, `banned` for admin) are **automatically added** to your Users collection by `betterAuthCollections()`. You'll see a log message like:
> ```
> [better-auth] Auto-adding fields to 'users': ['twoFactorEnabled']
> ```

### Step 3: Configure Payload

```ts
// src/payload.config.ts
import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { betterAuth } from 'better-auth'
import {
  betterAuthCollections,
  createBetterAuthPlugin,
  payloadAdapter,
} from '@delmaredigital/payload-better-auth'
import { betterAuthOptions } from './lib/auth/config'
import { Users } from './collections/Users'
import { getBaseUrl } from './lib/auth/getBaseUrl'

const baseUrl = getBaseUrl()

export default buildConfig({
  collections: [Users /* ...other collections */],
  plugins: [
    // Auto-generate sessions, accounts, verifications collections
    betterAuthCollections({
      betterAuthOptions,
      skipCollections: ['user'], // We define Users ourselves
    }),
    // Initialize Better Auth with auto-injected endpoints and admin components
    createBetterAuthPlugin({
      createAuth: (payload) =>
        betterAuth({
          ...betterAuthOptions,
          database: payloadAdapter({
            payloadClient: payload,
            // adapterConfig: { enableDebugLogs: true }, // Uncomment to enable debug logging
          }),
          // For Payload's default SERIAL IDs:
          advanced: {
            database: {
              generateId: 'serial',
            },
          },
          baseURL: baseUrl,
          secret: process.env.BETTER_AUTH_SECRET,
          trustedOrigins: [baseUrl],  // Or use withBetterAuthDefaults() below
        }),
    }),
  ],
  admin: {
    user: 'users',
  },
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL },
  }),
})
```

> **⚠️ Note:** The plugin automatically injects its own login page, logout button, and redirect handling. Don't add a custom `beforeLogin` in Payload's `admin.components` directly - use the plugin's options instead (see [Customization](#customization) for `disableLoginView`, `loginViewComponent`, etc.).

### Step 4: Client-Side Auth

```ts
// src/lib/auth/client.ts
'use client'

import { createPayloadAuthClient } from '@delmaredigital/payload-better-auth/client'

// Pre-configured with twoFactor, apiKey, and passkey plugins
// Uses window.location.origin automatically - works on any deployment URL
export const authClient = createPayloadAuthClient()

export const { useSession, signIn, signUp, signOut, twoFactor, passkey } = authClient
```

**Note:** `createPayloadAuthClient()` automatically uses `window.location.origin` as the base URL, so it works seamlessly across local dev, Vercel previews, and production without any configuration.

**Adding custom plugins (e.g., Stripe):**

For custom plugins with full TypeScript support, use `createAuthClient` with `payloadAuthPlugins`:

```ts
// src/lib/auth/client.ts
'use client'

import { createAuthClient, payloadAuthPlugins } from '@delmaredigital/payload-better-auth/client'
import { stripeClient } from '@better-auth/stripe/client'

// Spread payloadAuthPlugins to include defaults (twoFactor, apiKey, passkey)
// Then add your custom plugins - full type safety!
export const authClient = createAuthClient({
  plugins: [...payloadAuthPlugins, stripeClient({ subscription: true })],
})

// authClient.subscription is fully typed
export const { useSession, signIn, signUp, signOut, twoFactor, passkey, subscription } = authClient
```

This approach uses Better Auth's native `createAuthClient` with our default plugins, giving you full type inference for any custom plugins you add.

### Step 5: Server-Side Session Access

```ts
// In a server component or API route
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import { getServerSession } from '@delmaredigital/payload-better-auth'

export default async function Dashboard() {
  const payload = await getPayload({ config })
  const headersList = await headers()
  const session = await getServerSession(payload, headersList)

  if (!session) {
    redirect('/login')
  }

  return <div>Hello {session.user.name}</div>
}
```

**That's it!** The plugin automatically:
- Registers auth API endpoints at `/api/auth/*`
- Injects logout button, login redirect, and login page components
- Handles session management via Better Auth

---

## API Reference

### `payloadAdapter(config)`

Creates a Better Auth database adapter that uses Payload collections. Uses Better Auth's `createAdapterFactory` for schema-aware transformations, automatically supporting all Better Auth plugins.

```ts
payloadAdapter({
  payloadClient: payload,
  adapterConfig: {
    enableDebugLogs: false,
    idType: 'number', // Optional - auto-detects from generateId setting
  },
})
```

| Option | Type | Description |
|--------|------|-------------|
| `payloadClient` | `BasePayload \| () => Promise<BasePayload>` | Payload instance or factory function |
| `adapterConfig.enableDebugLogs` | `boolean` | Enable debug logging (default: `false`) |
| `adapterConfig.idType` | `'number' \| 'text'` | ID type (default: `'number'` for Payload's SERIAL IDs) |
| `adapterConfig.idFieldsAllowlist` | `string[]` | Additional fields to convert to numeric IDs (default: `[]`) |
| `adapterConfig.idFieldsBlocklist` | `string[]` | Fields to exclude from numeric ID conversion (default: `[]`) |

**ID Type:**
- Defaults to `'number'` (SERIAL) - Payload's default
- Set `idType: 'text'` if using UUIDs

**Note:** When using number IDs (default), you can optionally set `generateId: 'serial'` in Better Auth to be explicit:
```typescript
advanced: { database: { generateId: 'serial' } }
```
This is not required - the adapter handles it automatically. A warning will only appear if you explicitly set `generateId` to something incompatible.

**ID Field Conversion:**

When using serial IDs (`idType: 'number'`), the adapter automatically converts string ID fields to numbers. This applies to fields matching `*Id` or `*_id` patterns (like `activeOrganizationId`). This ensures Payload relationship lookups work correctly in access control.

Use `idFieldsAllowlist` and `idFieldsBlocklist` to customize this behavior:

```typescript
payloadAdapter({
  payloadClient: payload,
  adapterConfig: {
    // Add fields that don't follow the *Id pattern but should be converted
    idFieldsAllowlist: ['customOrgRef', 'legacyIdentifier'],

    // Exclude fields that end in 'Id' but aren't actually ID references
    idFieldsBlocklist: ['visitorId', 'correlationId'],
  },
})
```

**Custom Collection Names (Optional):**

By default, the adapter uses standard collection names (`users`, `sessions`, `accounts`, `verifications`). You only need `modelName` if you want **custom** names:

```ts
betterAuth({
  database: payloadAdapter({ payloadClient: payload }),
  // Only set modelName to CUSTOMIZE collection names
  // Use SINGULAR form - gets pluralized automatically
  user: { modelName: 'member' },        // Changes 'users' → 'members'
  session: { modelName: 'auth_session' }, // Changes 'sessions' → 'auth_sessions'
})
```

**Note:** If you're using the default collection names, don't set `modelName` at all.

### `betterAuthCollections(options)`

Payload plugin that auto-generates collections from Better Auth schema.

```ts
betterAuthCollections({
  betterAuthOptions,
  skipCollections: ['user'],
  adminGroup: 'Auth',
  usePlural: true,
  customizeCollection: (modelKey, collection) => collection,
})
```

| Option | Type | Description |
|--------|------|-------------|
| `betterAuthOptions` | `BetterAuthOptions` | Your Better Auth options |
| `skipCollections` | `string[]` | Collections to skip generating (default: `['user']`) |
| `adminGroup` | `string` | Admin panel group name (default: `'Auth'`) |
| `access` | `CollectionConfig['access']` | Custom access control for generated collections. **Note**: Replaces default access entirely (see caution below). |
| `usePlural` | `boolean` | Pluralize collection slugs (default: `true`) |
| `configureSaveToJWT` | `boolean` | Auto-configure `saveToJWT` for session-critical fields (default: `true`) |
| `firstUserAdmin` | `boolean \| FirstUserAdminOptions` | Make first registered user an admin (default: `true`) |
| `customizeCollection` | `(modelKey, collection) => CollectionConfig` | Customize generated collections |

> **⚠️ Caution on Custom Access:**
> When providing the `access` option, it **completely replaces** the default access object for all auto-generated collections. It does not merge with or override individual properties.
>
> By default, the plugin sets:
> - `read`: `isAdmin()`
> - `delete`: `isAdmin()`
> - `create`: `() => false` (Manual creation disabled - Better Auth manages these)
> - `update`: `() => false` (Manual update disabled - Better Auth manages these)
> 
> You must explicitly handle all access types to ensure your collections remain secure and functional.

**First User Admin:**

By default, the first user to register is automatically assigned the admin role. This provides a better out-of-the-box experience - no need to manually update the database to create your first admin.

```typescript
// Enabled by default - first user gets role='admin'
betterAuthCollections({ betterAuthOptions })

// Customize roles
betterAuthCollections({
  betterAuthOptions,
  firstUserAdmin: {
    adminRole: 'super-admin',  // Role for first user (default: 'admin')
    defaultRole: 'member',      // Role for subsequent users (default: 'user')
    roleField: 'userRole',      // Field name (default: 'role')
  },
})

// Disable
betterAuthCollections({
  betterAuthOptions,
  firstUserAdmin: false,
})

**Customization Example:**

```ts
betterAuthCollections({
  betterAuthOptions,
  customizeCollection: (modelKey, collection) => {
    if (modelKey === 'session') {
      return {
        ...collection,
        hooks: {
          afterDelete: [cleanupExpiredSessions],
        },
      }
    }
    return collection
  },
})
```

### `createBetterAuthPlugin(options)`

Payload plugin that initializes Better Auth during Payload's `onInit`.

```ts
createBetterAuthPlugin({
  createAuth: (payload) => betterAuth({ ... }),
  authBasePath: '/auth',
  autoRegisterEndpoints: true,
  autoInjectAdminComponents: true,
  admin: {
    login: { title: 'Admin Login' },
  },
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `createAuth` | `(payload: BasePayload) => Auth` | *required* | Factory function that creates the Better Auth instance |
| `authBasePath` | `string` | `'/auth'` | Base path for auth API endpoints |
| `autoRegisterEndpoints` | `boolean` | `true` | Auto-register auth API endpoints |
| `autoInjectAdminComponents` | `boolean` | `true` | Auto-inject admin components when `disableLocalStrategy` detected |
| `admin.disableLogoutButton` | `boolean` | `false` | Disable logout button injection |
| `admin.disableBeforeLogin` | `boolean` | `false` | Disable BeforeLogin redirect injection |
| `admin.disableLoginView` | `boolean` | `false` | Disable login view injection |
| `admin.login.title` | `string` | `'Login'` | Custom login page title |
| `admin.login.afterLoginPath` | `string` | `'/admin'` | Redirect path after successful login |
| `admin.login.requiredRole` | `string \| string[] \| null` | `'admin'` | Required role(s) for admin access. Array = any role matches (unless `requireAllRoles`). Set to `null` to disable. |
| `admin.login.requireAllRoles` | `boolean` | `false` | When `requiredRole` is an array, require ALL roles (true) or ANY role (false). |
| `admin.login.enablePasskey` | `boolean \| 'auto'` | `false` | Enable passkey (WebAuthn) sign-in option. `'auto'` detects if passkey plugin is available. |
| `admin.login.enableSignUp` | `boolean \| 'auto'` | `'auto'` | Enable user registration. `'auto'` detects if sign-up endpoint is available. |
| `admin.login.defaultSignUpRole` | `string` | `'user'` | Default role assigned to new users during registration |
| `admin.login.enableForgotPassword` | `boolean \| 'auto'` | `'auto'` | Enable forgot password link. `'auto'` detects if endpoint is available. |
| `admin.login.resetPasswordUrl` | `string` | - | Custom URL for password reset. If not set, uses inline reset form. |
| `admin.logoutButtonComponent` | `string` | - | Override logout button (import map format) |
| `admin.beforeLoginComponent` | `string` | - | Override BeforeLogin component |
| `admin.loginViewComponent` | `string` | - | Override login view component |
| `admin.betterAuthOptions` | `BetterAuthOptions` | - | Better Auth options (required for management UI auto-detection) |
| `admin.enableManagementUI` | `boolean` | `true` | Enable security management UI (2FA, API keys) |
| `admin.managementPaths.twoFactor` | `string` | `'/security/two-factor'` | Two-factor management view path |
| `admin.managementPaths.apiKeys` | `string` | `'/security/api-keys'` | API keys management view path |
| `admin.managementPaths.passkeys` | `string` | `'/security/passkeys'` | Passkeys management view path |
| `admin.apiKey` | `ApiKeyScopesConfig` | - | API key scopes configuration (see below) |

#### API Key Scopes Configuration

API keys can have granular permission scopes. By default, scopes are auto-generated from your Payload collections.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `scopes` | `Record<string, ScopeDefinition>` | - | Custom scope definitions |
| `includeCollectionScopes` | `boolean` | `true` when no custom scopes, `false` when custom scopes provided | Include auto-generated collection scopes |
| `excludeCollections` | `string[]` | `['sessions', 'verifications', 'accounts', 'twoFactors', 'apikeys']` | Collections to exclude from auto-generated scopes |
| `defaultScopes` | `string[]` | `[]` | Default scopes pre-selected when creating a key |

**Zero Config (recommended):**
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

**Hybrid (custom + auto-generated):**
```typescript
admin: {
  apiKey: {
    scopes: { 'content:manage': { /* ... */ } },
    includeCollectionScopes: true,  // Also include posts:read, etc.
    excludeCollections: ['users', 'sessions']
  }
}
```

**How Permissions Work:**

When creating API keys through the admin UI, users select scopes (e.g., `posts:read`, `posts:write`). These scopes are converted to Better Auth permissions server-side for security - the conversion happens in the Payload endpoint handler before calling Better Auth's API. This ensures that permission assignment is always controlled server-side, following Better Auth's security model.

### `betterAuthStrategy(options?)`

Payload auth strategy for Better Auth session validation.

```ts
betterAuthStrategy({
  usersCollection: 'users',
})
```

| Option | Type | Description |
|--------|------|-------------|
| `usersCollection` | `string` | The collection slug for users (default: `'users'`) |

### `getServerSession<TUser>(payload, headers)`

Get the current session on the server. Pass your Payload `User` type for full type safety:

```ts
import { getServerSession } from '@delmaredigital/payload-better-auth'
import type { User } from '@/payload-types'

const session = await getServerSession<User>(payload, headersList)
// session.user.role, session.user.firstName, etc. are fully typed
```

### `getServerUser<TUser>(payload, headers)`

Get the current user on the server (shorthand for `session.user`):

```ts
import { getServerUser } from '@delmaredigital/payload-better-auth'
import type { User } from '@/payload-types'

const user = await getServerUser<User>(payload, headersList)
// user.role, user.firstName, etc. are fully typed
```

### `createSessionHelpers<TUser>()`

Create typed session helpers bound to your User type. Define once, import everywhere — no generics needed at call sites:

```ts
// lib/auth.ts
import { createSessionHelpers } from '@delmaredigital/payload-better-auth'
import type { User } from '@/payload-types'

export const { getServerSession, getServerUser } = createSessionHelpers<User>()
```

```ts
// app/page.tsx
import { getServerSession } from '@/lib/auth'

const session = await getServerSession(payload, headersList)
// session.user is typed as User — no generic needed
```

### `withBetterAuthDefaults(options)`

Applies sensible defaults to Better Auth options. Useful for simplifying common configurations.

```ts
import { withBetterAuthDefaults } from '@delmaredigital/payload-better-auth'

betterAuth(withBetterAuthDefaults({
  baseURL: 'https://myapp.com',
  // trustedOrigins automatically becomes ['https://myapp.com']
}))
```

| Default Applied | Condition |
|-----------------|-----------|
| `trustedOrigins: [baseURL]` | When `trustedOrigins` is not set but `baseURL` is |

Explicit values are never overridden - if you set `trustedOrigins` manually, it won't be changed.

### `apiKeyWithDefaults(options?)`

Wraps Better Auth's `apiKey()` plugin with sensible defaults for use with this package.

```ts
import { apiKeyWithDefaults } from '@delmaredigital/payload-better-auth'

export const betterAuthOptions = {
  plugins: [
    apiKeyWithDefaults(),  // Use instead of apiKey()
  ],
}
```

| Default Applied | Purpose |
|-----------------|---------|
| `enableMetadata: true` | Allows storing scope names for display in admin UI |

**Why use this?**

Better Auth's `apiKey()` plugin disables metadata by default. When you create API keys with scopes through the admin UI, the selected scopes need to be stored in metadata to display them later. Without metadata enabled, keys are created successfully but scopes won't appear in the UI.

You can still pass any `apiKey()` options:

```ts
apiKeyWithDefaults({
  rateLimit: { max: 100, window: 60 },
  // enableMetadata is already true
})
```

---

## Customization

### Role-Based Access Control

By default, the login page checks that users have the `admin` role before allowing access to the admin panel. Users without the required role see an "Access Denied" message.

```ts
createBetterAuthPlugin({
  createAuth,
  admin: {
    login: {
      // Default: 'admin' - only users with role='admin' can access
      requiredRole: 'admin',

      // Use a different role name
      requiredRole: 'editor',

      // Multiple roles - any of these grants access
      requiredRole: ['admin', 'editor', 'moderator'],

      // Require ALL roles (instead of any)
      requiredRole: ['admin', 'content-manager'],
      requireAllRoles: true,

      // Disable role checking entirely
      requiredRole: null,
    },
  },
})
```

**For complex RBAC** (multiple roles, permissions, etc.), disable the login view and create your own:

```ts
createBetterAuthPlugin({
  createAuth,
  admin: {
    disableLoginView: true,
    loginViewComponent: '@/components/admin/CustomLoginWithRBAC',
  },
})
```

You can use the built-in `LoginView` as a starting point:

```tsx
// src/components/admin/CustomLoginWithRBAC.tsx
'use client'

import { LoginView } from '@delmaredigital/payload-better-auth/components'

// Option 1: Wrap and extend the built-in component
export default function CustomLoginWithRBAC() {
  // Add your custom RBAC logic here
  return <LoginView requiredRole={null} /> // Disable built-in role check
}

// Option 2: Copy the LoginView source code from the package and customize fully
// See: node_modules/@delmaredigital/payload-better-auth/dist/components/LoginView.js
```

### Disabling Auto-Injection

If you prefer to handle API routes or admin components manually:

```ts
createBetterAuthPlugin({
  createAuth,
  autoRegisterEndpoints: false,      // Handle API route yourself
  autoInjectAdminComponents: false,  // Handle admin components yourself
})
```

**Disabling Only the LoginView:**

To disable just the login view while keeping other auto-injected components:

```ts
createBetterAuthPlugin({
  createAuth,
  admin: {
    disableLoginView: true,
    // Optionally provide your own:
    loginViewComponent: '@/components/admin/CustomLogin',
  },
})
```

This is useful when you need:
- Complex RBAC logic beyond simple role checks
- Custom 2FA flows different from the built-in inline handling
- Integration with external identity providers
- Custom branding or UI requirements

**Frontend Login (outside admin panel):**

For user-facing login pages (not the Payload admin), you don't need to configure anything in the plugin. Just use the auth client directly in your own React components:

```tsx
import { authClient } from '@/lib/auth/client'

// Use authClient.signIn.email(), authClient.signUp.email(), etc.
// See "Handling 2FA in Custom Login Forms" section below for a complete example
```

### Custom Admin Components

Override specific admin components while keeping others auto-injected:

```ts
createBetterAuthPlugin({
  createAuth,
  admin: {
    // Use custom components (import map format)
    loginViewComponent: '@/components/admin/CustomLogin',
    logoutButtonComponent: '@/components/admin/CustomLogout',

    // Or disable specific components
    disableBeforeLogin: true,
  },
})
```

### Manual API Route (Advanced)

If you disable `autoRegisterEndpoints`, create your own route:

```ts
// src/app/api/auth/[...all]/route.ts
import { getPayload } from 'payload'
import config from '@payload-config'
import type { NextRequest } from 'next/server'
import type { PayloadWithAuth } from '@delmaredigital/payload-better-auth'

export async function GET(request: NextRequest) {
  const payload = (await getPayload({ config })) as PayloadWithAuth
  return payload.betterAuth.handler(request)
}

export async function POST(request: NextRequest) {
  const payload = (await getPayload({ config })) as PayloadWithAuth
  return payload.betterAuth.handler(request)
}
```

---

## Access Control Helpers

Pre-built access control functions for common authorization patterns.

### Role-Based Access

```typescript
import {
  isAdmin,
  isAdminField,
  isAdminOrSelf,
  hasRole,
  requireAllRoles,
  isAuthenticated,
  isAuthenticatedField,
} from '@delmaredigital/payload-better-auth'

export const Posts: CollectionConfig = {
  slug: 'posts',
  access: {
    read: isAuthenticated(),              // Any logged-in user
    create: hasRole(['editor', 'admin']), // Any of these roles
    update: hasRole(['editor', 'admin']),
    delete: requireAllRoles(['admin', 'content-manager']), // Must have ALL roles
  },
  fields: [
    {
      name: 'title',
      type: 'text',
    },
    {
      name: 'internalNotes',
      type: 'textarea',
      access: {
        read: isAdminField(),  // Only admins can read this field
      },
    },
  ],
}
```

### Self-Access Patterns

```typescript
import { isAdminOrSelf, canUpdateOwnFields } from '@delmaredigital/payload-better-auth'

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    // Admins can read all; users can only read themselves
    read: isAdminOrSelf({ adminRoles: ['admin'] }),

    // Users can update only specific fields on their own profile
    update: canUpdateOwnFields({
      allowedFields: ['name', 'image', 'password'],
      userSlug: 'users',
      requireCurrentPassword: true, // Require currentPassword for password changes
    }),

    // Only admins can delete
    delete: isAdmin({ adminRoles: ['admin'] }),
  },
  // ...
}
```

### Utility Functions

```typescript
import { normalizeRoles, hasAnyRole, hasAllRoles, hasAdminRoles } from '@delmaredigital/payload-better-auth'

// Normalize role field (handles string, array, or comma-separated)
const roles = normalizeRoles(user.role) // ['admin', 'editor']

// Check role membership
hasAnyRole(user, ['admin', 'editor'])  // true if user has any
hasAllRoles(user, ['admin', 'editor']) // true if user has all
hasAdminRoles(user, { adminRoles: ['admin', 'super-admin'] }) // true if admin
```

---

## API Key Scope Enforcement

Enforce API key scopes in your Payload access control. API keys can have granular permission scopes that control what resources they can access.

### Basic Usage

```typescript
import { requireScope, requireAnyScope, requireAllScopes } from '@delmaredigital/payload-better-auth'

export const Posts: CollectionConfig = {
  slug: 'posts',
  access: {
    read: requireScope('posts:read'),
    create: requireScope('posts:write'),
    update: requireScope('posts:write'),
    delete: requireAllScopes(['posts:delete', 'admin:write']), // Must have both
  },
}
```

### Wildcard Scopes

```typescript
// API key with scope 'posts:*' matches 'posts:read', 'posts:write', 'posts:delete'
// API key with scope '*' matches everything
```

### Allow Both Session and API Key

```typescript
import { allowSessionOrScope, allowSessionOrAnyScope } from '@delmaredigital/payload-better-auth'

export const Posts: CollectionConfig = {
  slug: 'posts',
  access: {
    // Allow authenticated users OR API keys with the scope
    read: allowSessionOrScope('posts:read'),
    create: allowSessionOrAnyScope(['posts:write', 'content:manage']),
  },
}
```

### Manual Validation

```typescript
import { validateApiKey, extractApiKeyFromRequest, hasScope } from '@delmaredigital/payload-better-auth'

// In a custom endpoint
async function myEndpoint({ req }) {
  const keyInfo = await validateApiKey(req)

  if (!keyInfo) {
    return Response.json({ error: 'Invalid API key' }, { status: 401 })
  }

  // Check specific scope
  if (!hasScope(keyInfo.scopes, 'custom:action')) {
    return Response.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  // keyInfo contains: { id, userId, scopes, keyPrefix, metadata }
  return Response.json({ userId: keyInfo.userId })
}
```

### Configuration Options

```typescript
requireScope('posts:read', {
  apiKeysCollection: 'apikeys',        // Collection slug (auto-detected)
  allowAuthenticatedUsers: false,      // Also allow session auth
  extractApiKey: (req) => { ... },     // Custom extraction function
})
```

---

## Plugin Compatibility

The adapter uses Better Auth's `createAdapterFactory` which is **schema-aware** - it automatically supports all Better Auth plugins without additional configuration. Just install the plugin, add it to your config, and our adapter handles the rest.

### How It Works

1. **You install** the plugin package (if separate from core)
2. **You configure** the plugin in Better Auth options
3. **Our adapter automatically**:
   - Creates the necessary collections via `betterAuthCollections()`
   - Handles all CRUD operations via schema-aware transformations
   - No plugin-specific adapter configuration needed

### Supported Plugins

| Plugin | Package | Notes |
|--------|---------|-------|
| OAuth | `better-auth` (core) | Uses accounts collection |
| Magic Link | `better-auth` (core) | Uses verifications collection |
| Email Verification | `better-auth` (core) | Uses verifications collection |
| Email OTP | `better-auth` (core) | Uses verifications collection |
| Password Reset | `better-auth` (core) | Uses verifications collection |
| Two-Factor (TOTP) | `better-auth` (core) | Auto-generates twoFactors collection |
| API Keys | `better-auth` (core) | Auto-generates apikeys collection |
| Organizations | `better-auth` (core) | Auto-generates organizations, members, invitations |
| Admin | `better-auth` (core) | Adds admin fields to users |
| Passkey | Bundled | Auto-generates passkeys collection |

**Note:** The `@better-auth/passkey` package is bundled with this package - no separate installation required.

### Example: Core Plugins

Core plugins are included in `better-auth`:

```typescript
import { twoFactor, organization, admin } from 'better-auth/plugins'
import { apiKeyWithDefaults } from '@delmaredigital/payload-better-auth'

betterAuth({
  database: payloadAdapter({ payloadClient: payload }),
  plugins: [
    twoFactor(),
    apiKeyWithDefaults(),  // Use this instead of apiKey() for better admin UI support
    organization(),
    admin(),
  ],
})
```

### Adding Join Fields for Relationships

Some plugins create related data (e.g., user's API keys). To query these relationships from the parent, add join fields:

<details>
<summary><strong>Why Join Fields?</strong></summary>

Payload uses `join` fields to establish queryable relationships from parent to child. Without them, you can still query the child collection directly (e.g., find API keys by userId), but you can't include them when fetching the parent (e.g., get user with their API keys).

</details>

### Enabling Plugins That Need Joins

Some Better Auth plugins expect to access related data via joins (e.g., `user.apiKeys`). Payload handles this via `join` fields. Below are the patterns for each plugin.

<details>
<summary><strong>API Keys</strong></summary>

The API Keys plugin creates an `apiKey` model with a `userId` reference.

**1. Add to your Better Auth config:**

```ts
import { apiKeyWithDefaults } from '@delmaredigital/payload-better-auth'

export const betterAuthOptions: Partial<BetterAuthOptions> = {
  // ... existing config
  plugins: [apiKeyWithDefaults()],  // Enables metadata for scope display in admin UI
}
```

> **Note:** `apiKeyWithDefaults()` wraps Better Auth's `apiKey()` plugin with `enableMetadata: true` so that selected scopes are stored and displayed in the admin UI. You can still use the raw `apiKey()` from `better-auth/plugins` if you don't need this feature.

**2. Add join field to your Users collection:**

```ts
// src/collections/Users.ts
export const Users: CollectionConfig = {
  slug: 'users',
  // ... existing config
  fields: [
    // ... existing fields
    {
      name: 'apiKeys',
      type: 'join',
      collection: 'apikeys', // Auto-generated collection (lowercase)
      on: 'user', // The field in apikeys that references users
    },
  ],
}
```

**3. (Optional) Configure permission scopes:**

The API Keys management UI (`/admin/security/api-keys`) lets users select permission scopes when creating keys. By default, scopes are auto-generated from your Payload collections. See [API Key Scopes Configuration](#api-key-scopes-configuration) for customization options.
</details>

<details>
<summary><strong>Two-Factor Auth (TOTP)</strong></summary>

The Two-Factor plugin creates a `twoFactor` model and adds a `twoFactorEnabled` field to users.

**1. Add to your Better Auth config:**

```ts
import { twoFactor } from 'better-auth/plugins'

export const betterAuthOptions: Partial<BetterAuthOptions> = {
  // ... existing config
  plugins: [twoFactor()],
}
```

**2. (Automatic) The `twoFactorEnabled` field is auto-added:**

The `betterAuthCollections()` plugin automatically adds `twoFactorEnabled` to your Users collection. You'll see:
```
[better-auth] Auto-adding fields to 'users': ['twoFactorEnabled']
```

**3. (Optional) Add join field for querying user's 2FA records:**

```ts
// src/collections/Users.ts
export const Users: CollectionConfig = {
  slug: 'users',
  fields: [
    // ... existing fields
    {
      name: 'twoFactor',
      type: 'join',
      collection: 'twoFactors',
      on: 'user',
    },
  ],
}
```

**4. (Optional) Add UI components:**

See [Two-Factor Authentication Flow](#two-factor-authentication-flow) for pre-built setup and verification components.
</details>

<details>
<summary><strong>Organizations</strong></summary>

The Organizations plugin creates multiple models: `organization`, `member`, and `invitation`.

**1. Add to your Better Auth config:**

```ts
import { organization } from 'better-auth/plugins'

export const betterAuthOptions: Partial<BetterAuthOptions> = {
  // ... existing config
  plugins: [organization()],
}
```

**2. Add join field to your Users collection:**

```ts
// src/collections/Users.ts
export const Users: CollectionConfig = {
  slug: 'users',
  fields: [
    // ... existing fields
    {
      name: 'memberships',
      type: 'join',
      collection: 'members', // Auto-generated collection
      on: 'user',
    },
  ],
}
```

**3. (Optional) Customize the Organizations collection:**

```ts
betterAuthCollections({
  betterAuthOptions,
  customizeCollection: (modelKey, collection) => {
    if (modelKey === 'organization') {
      return {
        ...collection,
        fields: [
          ...collection.fields,
          {
            name: 'members',
            type: 'join',
            collection: 'members',
            on: 'organization',
          },
          {
            name: 'invitations',
            type: 'join',
            collection: 'invitations',
            on: 'organization',
          },
        ],
      }
    }
    return collection
  },
})
```
</details>

### General Pattern for Joins

When a Better Auth plugin creates a model with a foreign key (e.g., `userId`, `organizationId`), you need to:

1. **Add a join field** to the parent collection pointing to the child collection
2. **Specify the `on` field** - this is the relationship field name in the child collection (without `Id` suffix)

The auto-generated collections create relationship fields like `user` (from `userId`), so your join's `on` property should match that field name.

**Collection Slug Casing:** Collection slugs are derived from Better Auth's model names (pluralized). Some plugins use lowercase (`apikey` → `apikeys`, `passkey` → `passkeys`) while others use camelCase (`twoFactor` → `twoFactors`). Always check the actual slug in your Payload admin panel if unsure.

### Cascade Delete (Cleanup Orphaned Records)

When a user is deleted, their related records (sessions, accounts, API keys, passkeys, etc.) become orphaned. Better Auth provides an `afterDelete` hook for cleanup:

```typescript
// src/lib/auth/index.ts
import { betterAuth } from 'better-auth'
import { payloadAdapter } from '@delmaredigital/payload-better-auth'

export const auth = betterAuth({
  database: payloadAdapter({ payloadClient: payload }),
  user: {
    deleteUser: {
      enabled: true,
      afterDelete: async (user) => {
        // Clean up all related records
        const collections = ['sessions', 'accounts', 'apikeys', 'passkeys', 'twoFactors']

        for (const collection of collections) {
          try {
            await payload.delete({
              collection,
              where: { user: { equals: user.id } },
            })
          } catch {
            // Collection may not exist if plugin not enabled
          }
        }
      },
    },
  },
  // ... other options
})
```

**Note:** This is optional. Orphaned records don't cause errors (Payload doesn't enforce foreign key constraints), but cleanup keeps your database tidy.

---

## Additional UI Components

### User Registration

The `LoginView` **automatically detects** if user registration is available by checking Better Auth's sign-up endpoint. If your Better Auth config has `emailAndPassword.enabled: true` (and not `disableSignUp: true`), the "Create account" link appears automatically.

**No configuration needed** for most cases - it just works based on your Better Auth settings.

**Optional overrides** (only if you need to force show/hide):
```typescript
createBetterAuthPlugin({
  createAuth,
  admin: {
    login: {
      // These options override auto-detection (usually not needed)
      enableSignUp: 'auto',      // 'auto' (default) | true | false
      defaultSignUpRole: 'user', // Role assigned to new users (default: 'user')
    },
  },
})
```

**Notes:**
- `'auto'` (default): Detects availability from Better Auth's sign-up endpoint
- `true`: Always show registration (even if Better Auth returns 404)
- `false`: Never show registration
- New users are assigned `defaultSignUpRole` (default: `'user'`)
- If email verification is required, users see a success message to check their email
- Role-based access control still applies - users without `requiredRole` see "Access Denied"

### Password Reset Flow

The `LoginView` **automatically detects** if password reset is available by checking Better Auth's reset endpoint. The "Forgot password?" link appears automatically when available.

**No configuration needed** for most cases - it just works based on your Better Auth settings.

**Optional overrides** (only if you need to force show/hide or use a custom URL):
```typescript
createBetterAuthPlugin({
  createAuth,
  admin: {
    login: {
      // These options override auto-detection (usually not needed)
      enableForgotPassword: 'auto',       // 'auto' (default) | true | false
      resetPasswordUrl: '/custom-reset',  // Optional: redirect to custom page instead of inline form
    },
  },
})
```

#### Standalone Components

For custom password reset pages outside the admin panel:

```typescript
import { ForgotPasswordView, ResetPasswordView } from '@delmaredigital/payload-better-auth/components/auth'
```

**ForgotPasswordView** - Email input form to request a password reset link.

```tsx
<ForgotPasswordView
  logo={<MyLogo />}
  title="Forgot Password"
  loginPath="/admin/login"
  successMessage="Check your email for a reset link."
/>
```

**ResetPasswordView** - Form to set a new password (expects `?token=` in URL).

```tsx
<ResetPasswordView
  logo={<MyLogo />}
  title="Reset Password"
  afterResetPath="/admin/login"
  minPasswordLength={8}
/>
```

### Two-Factor Authentication Flow

The plugin's `LoginView` **automatically handles 2FA verification inline**. When a user with 2FA enabled signs in:

1. User enters email/password and submits
2. If 2FA is enabled, the form transitions to a TOTP code input step
3. User enters their 6-digit code from their authenticator app
4. Upon successful verification, the user is redirected to the admin panel

**No additional configuration required** - the LoginView handles the full flow automatically.

#### Standalone Components for Custom Flows

For custom frontend implementations (outside the admin panel), use these components:

```typescript
import { TwoFactorSetupView, TwoFactorVerifyView } from '@delmaredigital/payload-better-auth/components/twoFactor'
```

**TwoFactorSetupView** - QR code display, manual secret entry, backup codes, and verification.

```tsx
<TwoFactorSetupView
  logo={<MyLogo />}
  title="Set Up Two-Factor Authentication"
  afterSetupPath="/admin"
  onSetupComplete={() => console.log('2FA enabled!')}
/>
```

**TwoFactorVerifyView** - TOTP code or backup code entry during login.

```tsx
<TwoFactorVerifyView
  logo={<MyLogo />}
  title="Two-Factor Authentication"
  afterVerifyPath="/admin"
  onVerifyComplete={() => console.log('Verified!')}
/>
```

All components use Payload CSS variables for native theme integration (light/dark mode).

#### Handling 2FA in Custom Login Forms

**Important:** If you have a custom login form (outside the admin panel), you **must** check for `twoFactorRedirect` in the sign-in response. Without this check, users with 2FA enabled will appear to log in but won't actually be authenticated.

```typescript
// src/lib/auth/client.ts
'use client'

import { createPayloadAuthClient } from '@delmaredigital/payload-better-auth/client'

// Pre-configured with twoFactor, apiKey, and passkey plugins
export const authClient = createPayloadAuthClient()

export const { signIn, signUp, signOut, twoFactor } = authClient
```

```tsx
// src/components/auth/login-form.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn, twoFactor } from '@/lib/auth/client'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await signIn.email({ email, password })

      if (result.error) {
        setError(result.error.message || 'Failed to sign in')
        return
      }

      // IMPORTANT: Check if 2FA is required
      if (result.data?.twoFactorRedirect) {
        setTwoFactorRequired(true)
        return
      }

      // Success - redirect to dashboard
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  async function handleTotpVerify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await twoFactor.verifyTotp({ code: totpCode })

      if (result.error) {
        setError(result.error.message || 'Invalid verification code')
        return
      }

      // Success - redirect to dashboard
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  // Show TOTP verification form
  if (twoFactorRequired) {
    return (
      <form onSubmit={handleTotpVerify}>
        <h2>Two-Factor Authentication</h2>
        <p>Enter the 6-digit code from your authenticator app</p>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={totpCode}
          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          autoComplete="one-time-code"
        />
        {error && <div className="error">{error}</div>}
        <button type="submit" disabled={loading || totpCode.length !== 6}>
          {loading ? 'Verifying...' : 'Verify'}
        </button>
        <button type="button" onClick={() => setTwoFactorRequired(false)}>
          Back to login
        </button>
      </form>
    )
  }

  // Show login form
  return (
    <form onSubmit={handleLogin}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        required
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
      />
      {error && <div className="error">{error}</div>}
      <button type="submit" disabled={loading}>
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
    </form>
  )
}
```

**Key Points:**
- Always check `result.data?.twoFactorRedirect` after `signIn.email()`
- When 2FA is required, the sign-in sets a temporary cookie - show the TOTP form immediately
- Use `twoFactor.verifyTotp({ code })` to complete authentication
- The TOTP cookie is session-scoped, so the user must complete verification in the same browser session

### Passkey Sign-In

Enable passwordless authentication using WebAuthn passkeys.

**Option 1: Enable in LoginView**

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

**Option 2: Standalone Button for Custom Forms**

```typescript
import { PasskeySignInButton } from '@delmaredigital/payload-better-auth/components'

function CustomLoginForm() {
  return (
    <div>
      {/* Your email/password form */}

      <PasskeySignInButton
        onSuccess={(user) => {
          router.push('/dashboard')
        }}
        onError={(error) => {
          setError(error)
        }}
        label="Sign in with Passkey"
        loadingLabel="Authenticating..."
        className="my-button-class"  // Accepts all button props
      />
    </div>
  )
}
```

The `PasskeySignInButton` handles the full WebAuthn authentication flow with Better Auth.

### Passkey Registration

For registering new passkeys (e.g., in account security settings):

**Bundled Component:**

```typescript
import { PasskeyRegisterButton } from '@delmaredigital/payload-better-auth/components'

function SecuritySettings() {
  return (
    <PasskeyRegisterButton
      passkeyName="My MacBook"
      onSuccess={(passkey) => {
        console.log('Passkey registered:', passkey.id)
        refetchPasskeys()
      }}
      onError={(error) => {
        setError(error)
      }}
      label="Add Passkey"
      loadingLabel="Registering..."
    />
  )
}
```

**Using the Auth Client Directly:**

```typescript
import { createPayloadAuthClient } from '@delmaredigital/payload-better-auth/client'

// Already includes passkeyClient plugin
const authClient = createPayloadAuthClient()

// Register a new passkey
await authClient.passkey.addPasskey({ name: 'My Device' })

// List user's passkeys
const { data: passkeys } = await authClient.passkey.listUserPasskeys()

// Delete a passkey
await authClient.passkey.deletePasskey({ id: passkeyId })
```

**Full Passkey Management Component:**

For building custom passkey management UIs, you can use the bundled management client:

```typescript
import { PasskeysManagementClient } from '@delmaredigital/payload-better-auth/management'

function PasskeysSettingsPage() {
  return <PasskeysManagementClient title="Manage Passkeys" />
}
```

This component provides a complete UI for listing, registering, and deleting passkeys, using Payload CSS variables for theme integration.

### Security Management UI

The plugin auto-injects management views for security features based on which Better Auth plugins are enabled:

| View | Path | Plugin Required |
|------|------|-----------------|
| Two-Factor Auth | `/admin/security/two-factor` | `twoFactor()` |
| API Keys | `/admin/security/api-keys` | `apiKey()` |
| Passkeys | `/admin/security/passkeys` | `passkey()` |

A "Security" navigation section is added to the admin sidebar.

**Configuration:**

```typescript
createBetterAuthPlugin({
  createAuth,
  admin: {
    betterAuthOptions,      // Required for plugin detection
    enableManagementUI: true,  // Default: true
  },
})
```

**Note:** Sessions are managed via Payload's default collection view at `/admin/collections/sessions`.

---

## Recipes

Common patterns and solutions for Better Auth integration.

### Auto-Create Organization on User Signup

A common pattern is to automatically create a personal workspace/organization when a user signs up (and verifies their email). The key is to use Better Auth's organization API (`auth.api.createOrganization()`) rather than raw adapter calls, so that `organizationHooks` fire properly.

**The Challenge:** Database hooks are defined in `betterAuthOptions` before the `auth` instance exists, so you can't directly reference `auth.api` in your hooks.

**The Solution:** Use a lazy auth instance singleton:

**Step 1: Create an auth instance singleton**

```typescript
// src/lib/auth/instance.ts
import type { betterAuth } from 'better-auth'

type AuthInstance = ReturnType<typeof betterAuth>

let authInstance: AuthInstance | null = null

export function setAuthInstance(auth: AuthInstance): void {
  authInstance = auth
}

export function getAuthInstance(): AuthInstance {
  if (!authInstance) {
    throw new Error('Auth not initialized')
  }
  return authInstance
}
```

**Step 2: Store the instance after creation**

```typescript
// src/payload.config.ts (or wherever you configure plugins)
import { setAuthInstance } from '@/lib/auth/instance'

createBetterAuthPlugin({
  createAuth: (payload) => {
    const auth = betterAuth({
      ...betterAuthOptions,
      database: payloadAdapter({ payloadClient: payload }),
      // ... other options
    })

    // Store for use in database hooks
    setAuthInstance(auth)

    return auth
  },
})
```

**Step 3: Use the organization API in database hooks**

```typescript
// src/lib/auth/config.ts
import { getAuthInstance } from './instance'

export const betterAuthOptions: Partial<BetterAuthOptions> = {
  // ... other options

  plugins: [
    organization({
      // organizationHooks fire when using auth.api.createOrganization()
      organizationHooks: {
        afterCreateOrganization: async ({ organization }) => {
          // This runs for ALL org creations - auto-created, manual, API
          console.log(`Organization ${organization.id} created`)
          // Create related records, send welcome email, etc.
        },
      },
    }),
  ],

  databaseHooks: {
    user: {
      update: {
        after: async (user, ctx) => {
          // Only proceed if user just verified their email
          if (!user.emailVerified) return

          // Check if user already has an organization (e.g., joined via invitation)
          const existingMembership = await ctx?.context?.adapter?.findOne({
            model: 'member',
            where: [{ field: 'userId', value: user.id }],
          })
          if (existingMembership) return

          // Create organization using the proper API
          // This ensures organizationHooks.afterCreateOrganization fires
          const auth = getAuthInstance()
          await auth.api.createOrganization({
            body: {
              name: `${user.name}'s Workspace`,
              slug: generateUniqueSlug(user.name),
              userId: user.id,
            },
          })
        },
      },
    },
  },
}
```

**Why This Matters:**

| Approach | organizationHooks fire? | Recommended? |
|----------|------------------------|--------------|
| `auth.api.createOrganization()` | ✅ Yes | ✅ Yes |
| `ctx.context.adapter.create({ model: 'organization' })` | ❌ No | ❌ No |

Using the raw adapter bypasses Better Auth's organization plugin entirely. Any logic in `organizationHooks` (like creating related records, sending notifications, or syncing with external systems) won't run.

**Handling Invitations:**

Users who join via invitation already have a membership record (created when they accept the invitation), so the `existingMembership` check prevents creating a duplicate personal organization for them.

---

## Types

The package exports comprehensive TypeScript types for Better Auth integration.

### Core Types

```typescript
import type {
  PayloadWithAuth,
  PayloadRequestWithBetterAuth,
  BetterAuthReturn,
} from '@delmaredigital/payload-better-auth'

// PayloadWithAuth - Payload instance with betterAuth attached
const payload = await getPayload({ config }) as PayloadWithAuth
const session = await payload.betterAuth.api.getSession({ headers })

// PayloadRequestWithBetterAuth - Request type with typed payload
function myHook({ req }: { req: PayloadRequestWithBetterAuth }) {
  const auth = req.payload.betterAuth
}
```

### Hook and Endpoint Types

```typescript
import type {
  CollectionHookWithBetterAuth,
  EndpointWithBetterAuth,
} from '@delmaredigital/payload-better-auth'

// Typed collection hooks with Better Auth access
const afterChangeHook: CollectionHookWithBetterAuth<typeof authOptions, MyDoc> = async ({
  req,
  doc,
}) => {
  const session = await req.payload.betterAuth.api.getSession({ headers: req.headers })
  // ...
  return doc
}

// Typed endpoints
const myEndpoint: EndpointWithBetterAuth<typeof authOptions> = {
  path: '/custom',
  method: 'get',
  handler: async ({ req }) => {
    const auth = req.payload.betterAuth
    // ...
  },
}
```

### Generated Schema Types

Auto-generated types for all Better Auth models:

```typescript
import type {
  User,
  BetterAuthSession,
  Account,
  Apikey,
  Passkey,
  Organization,
  Member,
  TwoFactor,
  // ... and more
} from '@delmaredigital/payload-better-auth'
```

### Type Generation

Regenerate types from Better Auth schema (useful after adding plugins):

```bash
pnpm generate:types
```

---

## License

MIT
