# @delmaredigital/payload-better-auth

Better Auth adapter and plugins for Payload CMS. Enables seamless integration between Better Auth and Payload.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Customization](#customization)
- [Plugin Compatibility](#plugin-compatibility)
- [License](#license)

---

## Installation

### Requirements

| Dependency | Version |
|------------|---------|
| `better-auth` | >= 1.0.0 |
| `payload` | >= 3.0.0 |
| `next` | >= 15.4.0 |
| `react` | >= 18.0.0 |

### Install

```bash
pnpm add @delmaredigital/payload-better-auth better-auth
```

---

## Quick Start

### Step 1: Create Your Auth Configuration

```ts
// src/lib/auth/config.ts
import type { BetterAuthOptions } from 'better-auth'

export const betterAuthOptions: Partial<BetterAuthOptions> = {
  user: {
    modelName: 'users',
    additionalFields: {
      role: { type: 'string', defaultValue: 'user' },
    },
  },
  session: {
    modelName: 'sessions',
    expiresIn: 60 * 60 * 24 * 30, // 30 days
  },
  account: { modelName: 'accounts' },
  verification: { modelName: 'verifications' },
  emailAndPassword: { enabled: true },
}

export const collectionSlugs = {
  user: 'users',
  session: 'sessions',
  account: 'accounts',
  verification: 'verifications',
} as const
```

### Step 2: Create Your Users Collection

```ts
// src/collections/Users.ts
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
import { betterAuthOptions, collectionSlugs } from './lib/auth/config'
import { Users } from './collections/Users'

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
            adapterConfig: {
              collections: collectionSlugs,
              enableDebugLogs: process.env.NODE_ENV === 'development',
              idType: 'number', // Use Payload's default SERIAL IDs
            },
          }),
          advanced: {
            database: {
              generateId: 'serial',
            },
          },
          secret: process.env.BETTER_AUTH_SECRET,
          trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL || ''],
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

### Step 4: Client-Side Auth

```ts
// src/lib/auth/client.ts
'use client'

import { createAuthClient } from '@delmaredigital/payload-better-auth/client'

export const authClient = createAuthClient({
  baseURL:
    typeof window !== 'undefined'
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL,
})

export const { useSession, signIn, signUp, signOut } = authClient
```

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

Creates a Better Auth database adapter that uses Payload collections.

```ts
payloadAdapter({
  payloadClient: payload,
  adapterConfig: {
    collections: { user: 'users', session: 'sessions' },
    enableDebugLogs: false,
    idType: 'number',
  },
})
```

| Option | Type | Description |
|--------|------|-------------|
| `payloadClient` | `BasePayload \| () => Promise<BasePayload>` | Payload instance or factory function |
| `adapterConfig.collections` | `Record<string, string>` | Map Better Auth model names to Payload collection slugs |
| `adapterConfig.enableDebugLogs` | `boolean` | Enable debug logging (default: `false`) |
| `adapterConfig.idType` | `'number' \| 'text'` | `'number'` for SERIAL (recommended), `'text'` for UUID |

**ID Type Options:**
- `'number'` (recommended) - Works with Payload's default SERIAL IDs. Requires `generateId: 'serial'` in Better Auth config.
- `'text'` - Works with UUID IDs. Requires `idType: 'uuid'` in Payload's database adapter.

### `betterAuthCollections(options)`

Payload plugin that auto-generates collections from Better Auth schema.

```ts
betterAuthCollections({
  betterAuthOptions,
  slugOverrides: { user: 'users' },
  skipCollections: ['user'],
  adminGroup: 'Auth',
})
```

| Option | Type | Description |
|--------|------|-------------|
| `betterAuthOptions` | `BetterAuthOptions` | Your Better Auth options |
| `slugOverrides` | `Record<string, string>` | Override collection names |
| `skipCollections` | `string[]` | Collections to skip generating (default: `['user']`) |
| `adminGroup` | `string` | Admin panel group name (default: `'Auth'`) |
| `access` | `CollectionConfig['access']` | Custom access control for generated collections |

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
| `admin.login.requiredRole` | `string \| null` | `'admin'` | Required role for admin access. Set to `null` to disable role checking. |
| `admin.logoutButtonComponent` | `string` | - | Override logout button (import map format) |
| `admin.beforeLoginComponent` | `string` | - | Override BeforeLogin component |
| `admin.loginViewComponent` | `string` | - | Override login view component |

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

### `getServerSession(payload, headers)`

Get the current session on the server.

```ts
const session = await getServerSession(payload, headersList)
// Returns: { user: { id, email, name, ... }, session: { id, expiresAt, ... } } | null
```

### `getServerUser(payload, headers)`

Get the current user on the server (shorthand for `session.user`).

```ts
const user = await getServerUser(payload, headersList)
// Returns: { id, email, name, ... } | null
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

## Plugin Compatibility

| Plugin | Status | Notes |
|--------|--------|-------|
| OAuth | Works | Uses existing accounts table |
| Magic Link | Works | Uses verifications table |
| Email Verification | Works | Uses verifications table |
| Email OTP | Works | Uses verifications table |
| Password Reset | Works | Uses verifications table |
| API Keys | Needs join | See [API Keys](#api-keys) below |
| Organizations | Needs joins | See [Organizations](#organizations) below |
| 2FA/TOTP | Needs join | See [Two-Factor Auth](#two-factor-auth-totp) below |

### Enabling Plugins That Need Joins

Some Better Auth plugins expect to access related data via joins (e.g., `user.apiKeys`). Payload handles this via `join` fields. Below are the patterns for each plugin.

<details>
<summary><strong>API Keys</strong></summary>

The API Keys plugin creates an `apiKey` model with a `userId` reference.

**1. Add to your Better Auth config:**

```ts
// src/lib/auth/config.ts
import { apiKey } from 'better-auth/plugins'

export const betterAuthOptions: Partial<BetterAuthOptions> = {
  // ... existing config
  plugins: [apiKey()],
}

export const collectionSlugs = {
  user: 'users',
  session: 'sessions',
  account: 'accounts',
  verification: 'verifications',
  apiKey: 'api-keys', // Add this
} as const
```

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
      collection: 'api-keys',
      on: 'user', // The field in api-keys that references users
    },
  ],
}
```

**3. Update slugOverrides in betterAuthCollections:**

```ts
betterAuthCollections({
  betterAuthOptions,
  slugOverrides: { apiKey: 'api-keys' },
  skipCollections: ['user'],
})
```
</details>

<details>
<summary><strong>Two-Factor Auth (TOTP)</strong></summary>

The Two-Factor plugin creates a `twoFactor` model with a `userId` reference.

**1. Add to your Better Auth config:**

```ts
// src/lib/auth/config.ts
import { twoFactor } from 'better-auth/plugins'

export const betterAuthOptions: Partial<BetterAuthOptions> = {
  // ... existing config
  plugins: [twoFactor()],
}

export const collectionSlugs = {
  // ... existing slugs
  twoFactor: 'two-factors', // Add this
} as const
```

**2. Add join field to your Users collection:**

```ts
// src/collections/Users.ts
export const Users: CollectionConfig = {
  slug: 'users',
  fields: [
    // ... existing fields
    {
      name: 'twoFactor',
      type: 'join',
      collection: 'two-factors',
      on: 'user',
    },
  ],
}
```
</details>

<details>
<summary><strong>Organizations</strong></summary>

The Organizations plugin creates multiple models: `organization`, `member`, and `invitation`.

**1. Add to your Better Auth config:**

```ts
// src/lib/auth/config.ts
import { organization } from 'better-auth/plugins'

export const betterAuthOptions: Partial<BetterAuthOptions> = {
  // ... existing config
  plugins: [organization()],
}

export const collectionSlugs = {
  // ... existing slugs
  organization: 'organizations',
  member: 'members',
  invitation: 'invitations',
} as const
```

**2. Add join fields to your Users collection:**

```ts
// src/collections/Users.ts
export const Users: CollectionConfig = {
  slug: 'users',
  fields: [
    // ... existing fields
    {
      name: 'memberships',
      type: 'join',
      collection: 'members',
      on: 'user',
    },
  ],
}
```

**3. Create an Organizations collection (or let it auto-generate and add joins):**

```ts
// src/collections/Organizations.ts
export const Organizations: CollectionConfig = {
  slug: 'organizations',
  admin: { useAsTitle: 'name', group: 'Auth' },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', unique: true },
    { name: 'logo', type: 'text' },
    { name: 'metadata', type: 'json' },
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
```
</details>

### General Pattern for Joins

When a Better Auth plugin creates a model with a foreign key (e.g., `userId`, `organizationId`), you need to:

1. **Map the collection slug** in `collectionSlugs` config
2. **Add a join field** to the parent collection pointing to the child collection
3. **Specify the `on` field** - this is the relationship field name in the child collection (without `Id` suffix)

The auto-generated collections create relationship fields like `user` (from `userId`), so your join's `on` property should match that field name.

---

## License

MIT
