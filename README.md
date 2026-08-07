# @delmaredigital/payload-better-auth

Better Auth adapter and plugins for Payload CMS. Enables seamless integration between Better Auth and Payload.

<p align="center">
  <a href="https://github.com/delmaredigital/dd-starter"><img src="https://img.shields.io/badge/Starter_Template-Use_This-blue?style=for-the-badge&logo=github&logoColor=white" alt="Starter Template - Use This"></a>
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdelmaredigital%2Fdd-starter&project-name=my-payload-site&build-command=pnpm%20run%20ci&env=PAYLOAD_SECRET,BETTER_AUTH_SECRET&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%2C%7B%22type%22%3A%22blob%22%7D%5D"><img src="https://vercel.com/button" alt="Deploy with Vercel" height="32"></a>
</p>

> 🔒 **Upgrading to 0.10?** One behavioral change to be aware of:
>
> - **Secret fields on the plugin's managed collections are now locked by default** (`secureSecretFields` on `betterAuthCollections()`, default `true`). Session tokens, TOTP secrets and backup codes, verification identifiers/values, stored OAuth access/refresh/ID tokens, hashed passwords and API keys, JWKS private keys and OAuth client secrets are no longer readable via Payload's REST/GraphQL API, and are hidden in the admin UI. Better Auth itself is unaffected — the adapter operates with `overrideAccess: true`, as do Local API calls by default.
> - **Action:** only needed if you read those fields through REST/GraphQL or a Local API call that passes `overrideAccess: false`. Opt out entirely with `secureSecretFields: false`, or unlock per model (e.g. `{ session: [] }`). Note that locked fields are *silently dropped* from non-override writes rather than raising an error.
>
> Also fixed in 0.10: password reset through the bundled `ForgotPasswordView` (it posted to `/forget-password`, removed in Better Auth 1.6, while always reporting success to the user), `ResetPasswordView` invalidating its own token, and auth failing entirely when Payload's `routes.api` isn't `/api`. See the [CHANGELOG](./CHANGELOG.md#0100---2026-08-07).

---

> 📦 **Upgrading from pre-0.9?** Every release from 0.7 to 0.9 carried breaking changes — Better Auth 1.6 as a hard requirement plus a `twoFactor` schema migration (0.7), server-side role assignment and API-key scope enforcement (0.8), and the passkey/admin-login split along with `normalizeRoles` and query-anchoring changes (0.9). Read the [CHANGELOG](./CHANGELOG.md) carefully and apply the migration steps for each version between yours and the current one.

---

## Documentation

**[Full Documentation](https://delmaredigital.github.io/payload-better-auth/)** — API reference, guides, recipes, UI components, and more.

For AI-assisted exploration: [DeepWiki](https://deepwiki.com/delmaredigital/payload-better-auth)

---

## Install

```bash
pnpm add @delmaredigital/payload-better-auth better-auth
```

**Requirements:** `payload` >= 3.69.0 · `better-auth` >= 1.6.0 (1.6.23+ recommended) · `next` >= 15.5.16 · `react` >= 19.2.1 · Node >= 20.9

## Quick Start

### 1. Auth Configuration

```ts
// src/lib/auth/config.ts
import type { BetterAuthOptions } from 'better-auth'

export const betterAuthOptions: Partial<BetterAuthOptions> = {
  user: {
    additionalFields: {
      // `input: false` keeps `role` server-only — clients cannot set it at
      // sign-up. Role is assigned by the first-user-admin hook; configure the
      // default self-sign-up role via `firstUserAdmin: { defaultRole }`.
      role: { type: 'string', defaultValue: 'user', input: false },
    },
  },
  emailAndPassword: { enabled: true },
}
```

### 2. Users Collection

```ts
// src/collections/Users/index.ts
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

### 3. Payload Config

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
  collections: [Users],
  plugins: [
    betterAuthCollections({
      betterAuthOptions,
      skipCollections: ['user'],
    }),
    createBetterAuthPlugin({
      createAuth: (payload) =>
        betterAuth({
          ...betterAuthOptions,
          database: payloadAdapter({ payloadClient: payload }),
          advanced: { database: { generateId: 'serial' } },
          baseURL: baseUrl,
          secret: process.env.BETTER_AUTH_SECRET,
          trustedOrigins: [baseUrl],
        }),
    }),
  ],
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL },
  }),
})
```

### 4. Client-Side Auth

```ts
// src/lib/auth/client.ts
'use client'

import { createAuthClient, twoFactorClient } from '@delmaredigital/payload-better-auth/client'
import { passkeyClient } from '@better-auth/passkey/client'

export const authClient = createAuthClient({
  plugins: [twoFactorClient(), passkeyClient()],
})

export const { useSession, signIn, signUp, signOut, twoFactor, passkey } = authClient
```

> Listing plugins inline (rather than using `createPayloadAuthClient()` or spreading `payloadAuthPlugins`) ensures `twoFactor` and other plugin methods are typed on the returned client.

### 5. Server-Side Session

```ts
import { headers } from 'next/headers'
import { getPayload } from 'payload'
import { getServerSession } from '@delmaredigital/payload-better-auth'

export default async function Dashboard() {
  const payload = await getPayload({ config })
  const headersList = await headers()
  const session = await getServerSession(payload, headersList)

  if (!session) { redirect('/login') }

  return <div>Hello {session.user.name}</div>
}
```

**That's it!** The plugin automatically registers auth API endpoints at `/api/auth/*`, injects admin UI components, and handles session management.

> **Using a non-default API route?** The plugin mounts Better Auth at `routes.api` + `authBasePath`, and Better Auth's own router 404s any request outside its `basePath` (default `/api/auth`). If your Payload config sets `routes: { api: '/api/payload' }`, tell Better Auth where it lives:
>
> ```ts
> // inside createAuth
> betterAuth({
>   basePath: '/api/payload/auth', // <routes.api> + <authBasePath>
>   // ...
> })
> ```
>
> The plugin's admin components pick up `routes.api` automatically, and the plugin logs an error at startup (naming the exact value to set) if `basePath` doesn't match the mount.

---

For MongoDB setup, API reference, customization, access control helpers, API key scopes, plugin compatibility, UI components (2FA, passkeys, password reset, passwordless login via magic-link & email-OTP), recipes, and types — see the **[full documentation](https://delmaredigital.github.io/payload-better-auth/)**.

## License

MIT
