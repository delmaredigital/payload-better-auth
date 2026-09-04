# @delmaredigital/payload-better-auth

Better Auth adapter and plugins for Payload CMS. Enables seamless integration between Better Auth and Payload.

<p align="center">
  <a href="https://github.com/delmaredigital/dd-starter"><img src="https://img.shields.io/badge/Starter_Template-Use_This-blue?style=for-the-badge&logo=github&logoColor=white" alt="Starter Template - Use This"></a>
</p>

<p align="center">
  <a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdelmaredigital%2Fdd-starter&project-name=my-payload-site&build-command=pnpm%20run%20ci&env=PAYLOAD_SECRET,BETTER_AUTH_SECRET&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22neon%22%2C%22integrationSlug%22%3A%22neon%22%7D%2C%7B%22type%22%3A%22blob%22%7D%5D"><img src="https://vercel.com/button" alt="Deploy with Vercel" height="32"></a>
</p>

> ⚠️ **Upgrading to 0.12? Array-typed fields changed shape on disk. Use 0.12.1 or later.**
>
> Releases up to 0.11.3 reported `supportsArrays: false` to Better Auth, so every `string[]` / `number[]` value was `JSON.stringify`'d on its way into Payload — those columns hold `'["a","b"]'` where an array belongs. 0.12.0 stores arrays natively, so existing rows need converting once.
>
> **If you don't use the oauth-provider plugin and have no array-typed `additionalFields`, there is nothing to do** — nothing else in Better Auth uses an array field.
>
> Otherwise run the migration, **then verify, then remove any workaround of your own** — in that order:
>
> ```ts
> import { migrateStringifiedArrays } from '@delmaredigital/payload-better-auth'
>
> const results = await migrateStringifiedArrays({
>   payload,
>   betterAuthOptions,
>   dryRun: true, // drop this once the report looks right
> })
> console.table(results)
> ```
>
> **On 0.12.0 this reported `converted: 0` against databases that were not clean** — on Postgres the ORM parses stored strings into arrays on read, hiding them. 0.12.1 censuses the stored shape in SQL instead. If you ran the 0.12.0 migration, re-run it on 0.12.1, and check each row says `observedVia: 'stored-shape'`.
>
> Confirm with the database itself before dropping any tolerant parsing you added — `SELECT jsonb_typeof(scopes), count(*) FROM oauth_access_tokens GROUP BY 1;` should show no `string` rows. Full details: [Migrating stringified arrays](#migrating-stringified-arrays-0120).

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
>    -- OAuth rows: the issuer each provider DECLARES (see the warning below)
>    UPDATE accounts SET issuer = 'https://accounts.google.com' WHERE provider_id = 'google';
>    UPDATE accounts SET issuer = 'https://www.facebook.com'    WHERE provider_id = 'facebook';
>    -- Only providers that declare no issuer of their own get the synthetic form
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
>    ⚠️ **`local:oauth:<providerId>` is the fallback, not the rule.** It applies only where a provider declares no issuer of its own. In Better Auth 1.7.1 seven built-ins DO declare one and must not get the synthetic form: **google** (`https://accounts.google.com`), **facebook** (`https://www.facebook.com`), **apple** (`https://appleid.apple.com`), **line**, **cognito**, **paybin** and **microsoft** — plus every generic-OAuth/OIDC provider (Okta, Auth0, Keycloak). Read the value rather than guessing it:
>
>    ```sh
>    node -e "import('better-auth/social-providers').then(m => console.log(m.google({clientId:'x',clientSecret:'y'}).accountIssuer))"
>    ```
>
>    Backfilling those rows with `local:oauth:…` files them under a key Better Auth never queries. Sign-in does not find the row, takes the new-identity path and writes a **second** account row; the unique index permits it because the pair differs. Nothing fails, and the damage is silent until a user is asked to link an account they already have.
>
>    ✅ **Facebook's `account_id` does NOT move**, despite an `accountSubject` that reads like it changed. 1.7 declares `"sub" in profile ? profile.sub : profile.id` — the same branch 1.6 took inside `getUserInfo` (Limited Login yields `sub`, the Graph `/me?fields=…` path yields `id`). Facebook rows need only the `issuer` update; rows with no stored `id_token` came via Graph. Only a Limited Login / `configId` consumer needs to look further.
>
>    ⚠️ **Microsoft Entra ID needs a row-by-row backfill, and its `account_id` moves too.** Its issuer is per-tenant (`https://login.microsoftonline.com/<tid>/v2.0`), so there is no constant to write — and 1.7 keys the subject on the `oid` claim where 1.6 stored `sub`, so every existing Entra `account_id` is also wrong. Both values are in the `id_token` already stored on the row: decode the claims segment (base64url) and take `iss` and `oid` from it. Decode only — do not verify the signature. This reads a claim out of a row already in your own database, not a token presented by a caller, so there is nothing to authenticate; stored `id_token`s are short-lived and long expired, so verification would fail regardless. If a row has no usable `id_token`, it cannot be repaired this way — decide per row (delete it and let the user re-link, or look the `oid` up through Graph) rather than guessing a value.
>
>    Names above assume the plugin's Postgres defaults (pluralized slug, snake_case columns); adjust for `usePlural: false` or MongoDB.
> 3. **Apply the migration** and verify sign-in for each provider you support.
>
> No application-code changes are required for the common setup — the adapter, generated collections, and admin UI absorb the rest of 1.7. If you use OAuth JWT bearer auth, database `joins`, or a proxy with a dynamic `baseURL`, see the [CHANGELOG](./CHANGELOG.md#0110---2026-08-19) for the smaller items.
>
> 📦 **Coming from 0.10 or earlier?** One more behavioral change worth knowing before you get to the above: since 0.10, **secret fields on the plugin's managed collections are locked by default** (`secureSecretFields` on `betterAuthCollections()`). Session tokens, TOTP secrets and backup codes, stored OAuth tokens, hashed passwords and API keys, JWKS private keys and OAuth client secrets are no longer readable through Payload's REST/GraphQL API. That only matters if you read them there, or via a Local API call passing `overrideAccess: false` — opt out with `secureSecretFields: false`, or unlock per model. Every release from 0.7 to 0.9 carried its own breaking change on top of that: read the [CHANGELOG](./CHANGELOG.md) and apply each migration between your version and this one.

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

Every `additionalFields` entry needs a matching field here. Scalars map to the
obvious Payload type; an array-typed one (`string[]` / `number[]`) needs a field
that stores an array — `json`, or `select` with `hasMany: true` — because the
adapter writes real arrays, not serialized ones:

```ts
// better auth: roles: { type: 'string[]' }
{ name: 'roles', type: 'json' }
```

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
