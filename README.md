# @delmaredigital/payload-better-auth

Better Auth adapter and plugins for Payload CMS. Enables seamless integration between Better Auth and Payload.

<p align="center">
  <a href="https://github.com/delmaredigital/dd-starter"><img src="https://img.shields.io/badge/Starter_Template-Use_This-blue?style=for-the-badge&logo=github&logoColor=white" alt="Starter Template - Use This"></a>
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdelmaredigital%2Fdd-starter&project-name=my-payload-site&build-command=pnpm%20run%20ci&env=PAYLOAD_SECRET,BETTER_AUTH_SECRET&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%2C%7B%22type%22%3A%22blob%22%7D%5D"><img src="https://vercel.com/button" alt="Deploy with Vercel" height="32"></a>
</p>

## Payload 4

**Payload 4 is in beta, and we're supporting it early.** This plugin is a thin adapter. It talks to Payload only through its public Local API and admin UI exports, so a new Payload major means a small set of mechanical changes rather than a rewrite. We follow Payload's canary releases as they land, and we intend to have a stable release ready when Payload 4.0 ships.

| You run | Install | npm tag |
|---|---|---|
| Payload 3 (`>=3.69 <4`) | `pnpm add @delmaredigital/payload-better-auth` | `latest` (0.13.x) |
| Payload 4 beta (`>=4.0.0-canary.37`) | `pnpm add @delmaredigital/payload-better-auth@next` | `next` (0.14.0-next.x) |

**Trying it on Payload 4:**

- **Requirements:** `payload` / `@payloadcms/ui` `>=4.0.0-canary.37`, `next` `>=16.2.6`, Node `>=24.15`, plus the rest of [Payload's v4 migration guide](https://github.com/payloadcms/payload/blob/main/docs/migration-guide/v4.mdx). Better Auth requirements are unchanged.
- **Pin an exact version** (e.g. `@delmaredigital/payload-better-auth@0.14.0-next.0`). Prereleases follow Payload's canaries and can change from one build to the next.
- **Already handled, on both majors:** the plugin's Local API lookups pass `overrideAccess: true` explicitly (Payload 4 flips the default to `false`), and its generated auth collections opt out of Payload 4's default versioning, so you get no `_versions` tables holding old sessions, tokens or password hashes.
- **Known gap:** the plugin's admin screens (passkeys, two-factor, API keys) still use Payload 3's `--theme-*` CSS variables, which Payload 4 retires, so their styling is off. Sign-in, sessions and access control are unaffected.
- **Where the work happens:** the [`payload-4`](https://github.com/delmaredigital/payload-better-auth/tree/payload-4) branch. Please report problems in an [issue](https://github.com/delmaredigital/payload-better-auth/issues) with "Payload 4" in the title.

The `next` line is a prerelease. For production, stay on `latest` until Payload 4.0 is stable; at that point the Payload 4 line becomes `latest`, and 0.13.x stays installable for Payload 3.

> **Upgrading from 0.12 to 0.13?** No code, config or data changes are needed; 0.13.0 is not breaking, despite the minor bump. One behavior to know: `payload.auth({ headers })` no longer extends the session unless you pass `canSetHeaders: true` and forward `responseHeaders`, so a call that can't deliver a refreshed cookie is now a pure read. 0.13.2 adds the optional [`roleField`](#naming-the-role-field) setting.
>
> **Upgrading from 0.11 or earlier?** Read the [upgrade guide](https://delmaredigital.github.io/payload-better-auth/#upgrading) before you bump. 0.11 requires Better Auth 1.7 and a database migration that backfills `account.issuer`, and 0.12 changed how array fields are stored ([migration steps](#migrating-stringified-arrays-0120)). Every release's details are in the [CHANGELOG](CHANGELOG.md).

---

## Documentation

**[Full Documentation](https://delmaredigital.github.io/payload-better-auth/)** — API reference, guides, recipes, UI components, and more.

For AI-assisted exploration: [DeepWiki](https://deepwiki.com/delmaredigital/payload-better-auth)

---

## Install

```bash
pnpm add @delmaredigital/payload-better-auth better-auth
```

**Requirements:** `payload` >= 4.0.0-canary.37 · `better-auth` >= 1.7.0 · `react` >= 19.2.1 · Node >= 24.15. Works with either Payload 4 admin adapter, `@payloadcms/next` or `@payloadcms/tanstack-start`: the admin components navigate through `@payloadcms/ui`'s router hooks, so `next` is an optional peer.

On Payload 3, use the 0.13.x line.

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

Every `additionalFields` entry needs a matching field here. Scalars map to the
obvious Payload type; an array-typed one (`string[]` / `number[]`) needs a field
that stores an array — `json`, or `select` with `hasMany: true` — because the
adapter writes real arrays, not serialized ones:

```ts
// better auth: roles: { type: 'string[]' }
{ name: 'roles', type: 'json' }
```

### Naming the role field

The plugin reads roles from `user.role` by default. To keep them somewhere else,
such as a `roles` array, set `roleField` once on `betterAuthCollections()`:

```ts
betterAuthCollections({ betterAuthOptions, roleField: 'roles' })
```

The first-user-admin guard, the saveToJWT field list, the access helpers, the
admin login role gate and the API-key management gate all read that value.
`firstUserAdmin.roleField` is the older spelling of the same setting and still
works. For types, wrap the generated user: `WithRoleField<User, 'roles', string[]>`.

Better Auth's `fieldName` mapping (`role: { type: 'string', fieldName: 'roles' }`)
renames where the value is stored, and the adapter handles it. Here that stored
name is also the Payload field name, so Payload-side checks see `user.roles` while
Better Auth's session user keeps `role`. Set `roleField` to the stored name
(`'roles'`); the admin login gate translates it to the session key on its own.
Use `fieldName` when you want the column renamed under Better Auth's key; use
`roleField` when the property itself is called something else.

Called directly, `hasAnyRole(user, roles)` and `hasAllRoles(user, roles)` still
default to `role` for backward compatibility — with a custom field, pass the
name as the third argument (`hasAnyRole(user, ['admin'], 'roles')`) or the check
reads the wrong property. The access helpers (`isAdmin`, `hasRole`,
`isAdminOrSelf`, …) do this for you: they read the configured `roleField` off
the request's Payload config and also accept a `roleField` option of their own.

`roleField` is published by `betterAuthCollections()`, so setups that skip
it have no configured value and every gate falls back to `role`. To use another
name there, either set it on your Payload config yourself
(`custom: { betterAuth: { roleField: 'roles' } }`) or pass `roleField` to each
helper and the `roleField` prop to a standalone `LoginView`.

> Upgrading from 0.11.x with the oauth-provider plugin or an array-typed
> `additionalField`? Those columns hold JSON strings and need converting once —
> see [Migrating stringified arrays](#migrating-stringified-arrays-0120).

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

Sessions slide the way Better Auth documents (`session.updateAge`): once the refresh window is reached, `getSession()` extends the session row and issues a refreshed cookie. `betterAuthStrategy` forwards that `Set-Cookie` on every Payload REST and GraphQL request, so the browser's cookie moves with the database. Where there is no response to carry a cookie — server components, `getServerSession()`, `payload.auth({ headers })` — the session is read without refreshing it, so the two can never drift apart. To let a Local API call refresh the session, tell Payload it may set headers and forward what it hands back:

```ts
// app/api/whoami/route.ts
export async function GET(req: Request) {
  const payload = await getPayload({ config })
  const { user, responseHeaders } = await payload.auth({ headers: req.headers, canSetHeaders: true })
  return Response.json({ user }, { headers: responseHeaders })
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

## Migrating stringified arrays (0.12.0)

Releases up to 0.11.3 reported `supportsArrays: false` to Better Auth, so every
`string[]` / `number[]` value was `JSON.stringify`'d on its way into Payload.
Those columns hold `'["a","b"]'` where an array belongs. From 0.12.0 the adapter
stores arrays natively, so those rows need converting once.

**If you don't use the oauth-provider plugin and have no array-typed
`additionalFields`, there is nothing to do** — nothing else in Better Auth uses an
array field.

**Use 0.12.1 or later.** On 0.12.0 this migration was a silent no-op on Postgres:
it reported `converted: 0` against databases that were not clean. Payload writes
these fields to a `jsonb` column, so a stringified value is stored as a *jsonb
string*; on read node-postgres parses the jsonb and hands drizzle a JS string,
and drizzle's `PgJsonb.mapFromDriverValue` parses it a second time. The stored
string becomes an array before Payload sees it, so a stringified row and a native
one are indistinguishable through `payload.find()`. 0.12.1 censuses the stored
shape in SQL instead. If you ran the 0.12.0 migration, re-run it.

### 1. Migrate

```ts
import { migrateStringifiedArrays } from '@delmaredigital/payload-better-auth'
import { betterAuthOptions } from './lib/auth/config'

const results = await migrateStringifiedArrays({
  payload,
  betterAuthOptions,
  dryRun: true, // drop this once the report looks right
})
console.table(results)
// [{ collection: 'oauthClients', field: 'redirectUris', scanned: 12,
//    converted: 12, skipped: 0, observedVia: 'stored-shape' }, …]
```

It derives the fields to convert from your own Better Auth schema rather than a
hardcoded list, so it covers whatever plugins you run, and it's safe to re-run —
values already stored as arrays are left alone, and a string that doesn't parse to
an array is skipped and counted rather than guessed at.

Read `observedVia` alongside `converted`. On Postgres it must say `stored-shape`;
`local-api` there would mean the count came from the laundered value and is not
trustworthy. If the stored shape can't be inspected at all, the migration throws
rather than reporting a clean database.

### 2. Verify against the database

`converted: 0` is only good news if the census could see the stored shape. Confirm
independently:

```sql
SELECT jsonb_typeof(scopes) AS shape, count(*)
FROM oauth_access_tokens GROUP BY 1;
```

You want only `array` (and `null`). Any `string` rows are unconverted. To fix them
outside the plugin:

```sql
UPDATE oauth_access_tokens
SET scopes = (scopes #>> '{}')::jsonb
WHERE jsonb_typeof(scopes) = 'string';
```

### 3. Only then, remove your own workarounds

If you were writing `JSON.stringify(uris)` into these columns, or parsing them back
out on read, drop that — after migrating, the column holds one shape.

**Do this last, and only after step 2 reads clean.** Removing a tolerant parse
while unconverted rows remain is what turns this into an incident: raw SQL reads
carry no column type, so they bypass drizzle's mapper and still see the string.
Code that reads `redirect_uris` via `drizzle.execute(sql`…`)` — a DCR connector
gate, a consent screen — would get `[]` from an unconverted row. For a
redirect-URI allowlist that's a hard lockout of a legitimate connector.

That raw-SQL path is also the real exposure of leaving rows unmigrated. Better
Auth's own reads go through Payload, where the double-parse launders the value, so
`/oauth2/authorize` keeps working — the damage is confined to code that queries
these columns directly.

---

For MongoDB setup, API reference, customization, access control helpers, API key scopes, plugin compatibility, UI components (2FA, passkeys, password reset, passwordless login via magic-link & email-OTP), recipes, and types — see the **[full documentation](https://delmaredigital.github.io/payload-better-auth/)**.

## License

MIT
