# @delmaredigital/payload-better-auth

Better Auth adapter and plugins for Payload CMS. Enables seamless integration between Better Auth and Payload.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
- [Admin Panel Integration](#admin-panel-integration)
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

Or install from GitHub:

```bash
pnpm add github:delmaredigital/payload-better-auth
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

### Step 2: Create the Auth Instance Factory

```ts
// src/lib/auth/index.ts
import { betterAuth } from 'better-auth'
import type { BasePayload } from 'payload'
import { payloadAdapter } from '@delmaredigital/payload-better-auth'
import { betterAuthOptions, collectionSlugs } from './config'

export function createAuth(payload: BasePayload) {
  return betterAuth({
    ...betterAuthOptions,
    database: payloadAdapter({
      payloadClient: payload,
      adapterConfig: {
        collections: collectionSlugs,
        enableDebugLogs: process.env.NODE_ENV === 'development',
        idType: 'number', // Use Payload's default SERIAL IDs
      },
    }),
    // Use serial/integer IDs (Payload default) instead of UUID
    advanced: {
      database: {
        generateId: 'serial',
      },
    },
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [process.env.NEXT_PUBLIC_APP_URL || ''],
  })
}
```

### Step 3: Configure Payload

```ts
// src/payload.config.ts
import { buildConfig } from 'payload'
import {
  betterAuthCollections,
  createBetterAuthPlugin,
} from '@delmaredigital/payload-better-auth'
import { betterAuthOptions } from './lib/auth/config'
import { createAuth } from './lib/auth'
import { Users } from './collections/Users'

export default buildConfig({
  collections: [Users /* ... other collections */],
  plugins: [
    // Auto-generate sessions, accounts, verifications collections
    betterAuthCollections({
      betterAuthOptions,
      skipCollections: ['user'], // We define Users ourselves
    }),
    // Initialize Better Auth in Payload's lifecycle
    createBetterAuthPlugin({
      createAuth,
    }),
  ],
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL },
    // Use Payload defaults - Better Auth adapter handles ID conversion
  }),
})
```

### Step 4: Create Your Users Collection

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

### Step 5: Create the Auth API Route

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

### Step 6: Client-Side Auth

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

### Step 7: Server-Side Session Access

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
})
```

| Option | Type | Description |
|--------|------|-------------|
| `createAuth` | `(payload: BasePayload) => Auth` | Factory function that creates the Better Auth instance |

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

## Admin Panel Integration

When using `disableLocalStrategy: true` in your Users collection, you need custom admin authentication components since Payload's default login form won't work.

### Why Custom Components Are Needed

With `disableLocalStrategy: true`:
- Payload's default login form is disabled
- Users must authenticate via Better Auth
- A custom login page is needed at `/admin/login`
- A custom logout button is needed to clear Better Auth sessions

<details>
<summary><strong>Step 1: Create BeforeLogin Component</strong></summary>

This component redirects unauthenticated users from Payload's login to your custom login page:

```tsx
// src/components/admin/BeforeLogin.tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function BeforeLogin() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/admin/login')
  }, [router])

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <div>Redirecting to login...</div>
    </div>
  )
}
```
</details>

<details>
<summary><strong>Step 2: Create Custom Logout Button</strong></summary>

**IMPORTANT**: The logout button must only trigger logout **on click**, not on mount. Triggering logout on mount would cause an infinite redirect loop since this component is rendered in the admin panel header.

```tsx
// src/components/admin/Logout.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from '@/lib/auth/client'

export default function Logout() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)

  async function handleLogout() {
    if (isLoading) return
    setIsLoading(true)

    try {
      await signOut()
      router.push('/admin/login')
    } catch (error) {
      console.error('Logout error:', error)
      setIsLoading(false)
    }
  }

  return (
    <button
      onClick={handleLogout}
      disabled={isLoading}
      type="button"
      className="btn btn--style-secondary btn--icon-style-without-border btn--size-small btn--withoutPopup"
    >
      {isLoading ? 'Logging out...' : 'Log out'}
    </button>
  )
}
```
</details>

<details>
<summary><strong>Step 3: Create Admin Login Page</strong></summary>

```tsx
// src/app/(frontend)/admin/login/page.tsx
'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signIn } from '@/lib/auth/client'

export default function AdminLoginPage() {
  const { data: session, isPending } = useSession()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (session?.user) {
      const user = session.user as { role?: string }
      if (user.role === 'admin') {
        router.push('/admin')
      } else {
        setError('Access denied. Admin role required.')
      }
    }
  }, [session, router])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      const result = await signIn.email({ email, password })
      if (result.error) {
        setError(result.error.message || 'Invalid credentials')
        setIsLoading(false)
        return
      }
      router.refresh()
    } catch {
      setError('An unexpected error occurred')
      setIsLoading(false)
    }
  }

  if (isPending) {
    return <div>Loading...</div>
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Admin Login</h1>
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
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  )
}
```
</details>

<details>
<summary><strong>Step 4: Configure Payload Admin Components</strong></summary>

```ts
// payload.config.ts
export default buildConfig({
  admin: {
    user: Users.slug,
    components: {
      beforeLogin: ['@/components/admin/BeforeLogin'],
      logout: {
        Button: '@/components/admin/Logout',
      },
    },
  },
  // ... rest of config
})
```
</details>

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

This project is licensed under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/).

### What This Means

**✅ Free for:**
- Personal projects and hobby use
- Open source projects
- Educational and research purposes
- Evaluation and testing
- Nonprofit organizations
- Government institutions

**💼 Commercial use:**
Requires a separate commercial license. If you're using this in a commercial product or service, please contact us for licensing options.

**📧 Commercial Licensing:** [hello@delmaredigital.com](mailto:hello@delmaredigital.com)

---

## About

Built by [Delmare Digital](https://delmaredigital.com) — custom software solutions for growing businesses.