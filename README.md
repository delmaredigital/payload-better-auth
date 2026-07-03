# @delmaredigital/payload-better-auth

Better Auth adapter and plugins for Payload CMS. Enables seamless integration between Better Auth and Payload.

<p align="center">
  <a href="https://github.com/delmaredigital/dd-starter"><img src="https://img.shields.io/badge/Starter_Template-Use_This-blue?style=for-the-badge&logo=github&logoColor=white" alt="Starter Template - Use This"></a>
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdelmaredigital%2Fdd-starter&project-name=my-payload-site&build-command=pnpm%20run%20ci&env=PAYLOAD_SECRET,BETTER_AUTH_SECRET&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%2C%7B%22type%22%3A%22blob%22%7D%5D"><img src="https://vercel.com/button" alt="Deploy with Vercel" height="32"></a>
</p>

> 🔧 **Upgrading to 0.9?** A second hardening pass (correctness + robustness) with a few breaking changes. Summary (full migration in the [CHANGELOG](./CHANGELOG.md#090---2026-07-02)):
>
> - **Passkey on the admin login** — the default `LoginView` no longer imports the optional `@better-auth/passkey` peer (it broke builds for consumers who hadn't installed it). To keep passkey sign-in on the admin login, point your login view at the passkey wrapper (added in 0.9.1): `admin.loginViewComponent: '@delmaredigital/payload-better-auth/components/login-passkey#LoginViewWrapperWithPasskey'`. Consumers who don't use passkey need no change.
> - **`starts_with`/`ends_with` are now correctly anchored** (were over-broad via Payload's non-anchored `like`).
> - **Roles: a comma string is one role** (`normalizeRoles` no longer splits) — use an array for multiple roles.
> - **Password changes go through Better Auth's `changePassword`** — `canUpdateOwnFields` no longer verifies passwords (it was an unthrottled oracle).
>
> Also: multi-instance safety, per-request API-key scope checks (no quota burn), and adapter correctness fixes. See the [CHANGELOG](./CHANGELOG.md#090---2026-07-02).

---

> 🔒 **Upgrading to 0.8?** This is a **security-hardening release** with breaking changes. Summary (full migration in the [CHANGELOG](./CHANGELOG.md#080---2026-07-02)):
>
> - **Roles are assigned server-side on sign-up.** The admin login form no longer sends a `role`, and the first-user-admin hooks ignore any client-supplied role for non-first users. **Action:** if `role` is a Better Auth `additionalField`, set `input: false`; set the default self-sign-up role via `firstUserAdmin: { defaultRole }`. Closes a privilege-escalation path (`POST { role: 'admin' }`).
> - **API-key scope enforcement for `x-api-key`.** Keys sent via `x-api-key` are now scope-checked instead of being treated as a full session under `allowSessionOrPermission` / `allowAuthenticatedUsers`.
> - **2FA QR codes render locally** (new `qrcode.react` dependency, auto-installed) — the TOTP secret is no longer sent to a third-party QR service.
> - **Node >= 20.9 required**; peer ranges capped to tested majors; `defaultSignUpRole` (LoginView prop) is deprecated and ignored.
>
> See the [CHANGELOG](./CHANGELOG.md#080---2026-07-02) for full details and migration steps.

---

> ⚠️ **Upgrading to 0.7?** This release requires **Better Auth 1.6** and includes several breaking changes:
>
> - **Schema migration required** for projects using the `twoFactor` plugin — Better Auth 1.6.2 added a `verified` column to the `twoFactor` table.
> - **`oidcProvider` → `@better-auth/oauth-provider`** — generated OAuth types now reflect the `oauth-provider` schema. Consumers using `oidcProvider()` at runtime will keep working, but `OauthApplication` / `PluginId` / `ModelKey` type exports have changed shape. Migrating to `@better-auth/oauth-provider` is recommended.
> - **Client helper type widening** — `createPayloadAuthClient()` and `payloadAuthPlugins` are typed more conservatively to keep `.d.ts` portable. For typed plugin methods (e.g. `client.twoFactor.verifyTotp`), list plugins explicitly in `createAuthClient({ plugins: [...] })` (see [Client-Side Auth](#4-client-side-auth) below).
>
> See the [CHANGELOG](./CHANGELOG.md#070---2026-04-21) for full migration instructions.

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

---

For MongoDB setup, API reference, customization, access control helpers, API key scopes, plugin compatibility, UI components (2FA, passkeys, password reset, passwordless login via magic-link & email-OTP), recipes, and types — see the **[full documentation](https://delmaredigital.github.io/payload-better-auth/)**.

## License

MIT
