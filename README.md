# @delmaredigital/payload-better-auth

Better Auth adapter and plugins for Payload CMS. Enables seamless integration between Better Auth and Payload.

<p align="center">
  <a href="https://github.com/delmaredigital/dd-starter"><img src="https://img.shields.io/badge/Starter_Template-Use_This-blue?style=for-the-badge&logo=github&logoColor=white" alt="Starter Template - Use This"></a>
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdelmaredigital%2Fdd-starter&project-name=my-payload-site&build-command=pnpm%20run%20ci&env=PAYLOAD_SECRET,BETTER_AUTH_SECRET&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%2C%7B%22type%22%3A%22blob%22%7D%5D"><img src="https://vercel.com/button" alt="Deploy with Vercel" height="32"></a>
</p>

> ⚠️ **Upgrading to 0.11? Better Auth 1.7 is now required, and it needs a database migration.**
>
> 1. **Upgrade the peers together** — `better-auth@^1.7`, plus `@better-auth/api-key` / `@better-auth/passkey` at the same major if you use them. 1.6 is no longer supported: 1.7 requires two new adapter methods, and a 1.6 install would throw at runtime.
> 2. **Generate the migration, then edit it to backfill `issuer`.** Better Auth 1.7 keys provider identities on `(issuer, accountId)` instead of `providerId`, so the accounts collection gains a **required** `issuer` field plus a unique index. `payload migrate:create` will emit an `ADD COLUMN … NOT NULL` that **fails on a populated table** — split it into add-nullable → backfill → enforce:
>
>    ```sql
>    ALTER TABLE accounts ADD COLUMN issuer varchar;
>
>    -- Email/password rows
>    UPDATE accounts SET issuer = 'local:credential' WHERE provider_id = 'credential';
>    -- Built-in social providers ('google', 'github', …)
>    UPDATE accounts SET issuer = 'local:oauth:' || provider_id WHERE issuer IS NULL;
>
>    -- Must return zero rows, or the unique index will fail
>    SELECT issuer, account_id, COUNT(*)
>    FROM accounts GROUP BY issuer, account_id HAVING COUNT(*) > 1;
>
>    ALTER TABLE accounts ALTER COLUMN issuer SET NOT NULL;
>    -- then the unique index exactly as Payload generated it
>    ```
>
>    Generic-OAuth/OIDC providers (Okta, Auth0, Keycloak, Entra ID) use their **real** discovery issuer, not the `local:oauth:` form — check Better Auth's [1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer) for those. Names above assume the plugin's Postgres defaults (pluralized slug, snake_case columns); adjust for `usePlural: false` or MongoDB.
> 3. **Apply the migration** and verify sign-in for each provider you support.
>
> No application-code changes are required for the common setup — the adapter, generated collections, and admin UI absorb the rest of 1.7. If you use OAuth JWT bearer auth, database `joins`, or a proxy with a dynamic `baseURL`, see the [CHANGELOG](./CHANGELOG.md#0110---2026-08-19) for the smaller items.

---

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

**Requirements:** `payload` >= 3.69.0 · `better-auth` >= 1.7.0 · `next` >= 15.5.16 · `react` >= 19.2.1 · Node >= 20.9

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

## Atomic operations

Better Auth 1.7 requires every database adapter to implement two atomic primitives, and calls them on paths you are almost certainly using:

| Primitive | Used by |
| --- | --- |
| `consumeOne` | Single-use credentials — email verification, password reset, magic links, email OTP, device-authorization codes |
| `incrementOne` | Guarded counters — API-key quota and rate limits, two-factor backup codes, team member counts |

Payload's Local API has no `DELETE … RETURNING` or `SET n = n + d`, so the adapter implements both as read-then-write and narrows the race window rather than eliminating it:

- **`consumeOne`** reads the row, then deletes it by id. The row is returned **only if our own delete removed it** — if a concurrent caller got there first, Payload raises a 404 and we return `null`. That is what keeps a magic link or reset token single-use.
- **`incrementOne`** reads the row, then writes with a guard that re-asserts both Better Auth's own precondition (e.g. `remaining > 0`) and the counter values the write was computed from. A racing writer's update matches no row, so the loser re-reads and retries (up to five times) instead of clobbering the winner.

**The limit:** Payload resolves a `where` by finding rows and then mutating them, so a narrow window remains between its internal read and write. Under heavy concurrency on the *same row*, a quota decrement can be lost or a token consumed twice. This matches the guarantee Better Auth 1.6 provided for these flows, and is fine for typical traffic — but if you need strict cross-process guarantees for API-key quota, enforce it at the database with a `CHECK` constraint or a unique index rather than relying on the adapter alone.

---

For MongoDB setup, API reference, customization, access control helpers, API key scopes, plugin compatibility, UI components (2FA, passkeys, password reset, passwordless login via magic-link & email-OTP), recipes, and types — see the **[full documentation](https://delmaredigital.github.io/payload-better-auth/)**.

## License

MIT
