# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.13.0] - 2026-09-04

Sliding sessions now work through Payload. Thanks to the contributor of
[#35](https://github.com/delmaredigital/payload-better-auth/pull/35), who traced the
missing cookie refresh to the strategy and fixed it the way both frameworks intend.

**Nothing in this release is breaking.** This project reserves minor bumps for breaking
changes while pre-1.0, and this one should have been 0.12.3 — the bump is a versioning
slip, not a signal. No code, config, or data changes are needed to upgrade.

### Fixed

- **`betterAuthStrategy` forwards Better Auth's `Set-Cookie` headers** ([#35](https://github.com/delmaredigital/payload-better-auth/pull/35)). Better Auth's `getSession()` extends the session row once `session.updateAge` is reached and issues a refreshed cookie. The strategy called it without `returnHeaders` and threw the headers away, so the database session slid while the browser's cookie kept its original `Max-Age`: anyone whose traffic went only through Payload — the admin panel included — was logged out after `expiresIn` regardless of activity, and expired-cookie clearing and the cookie cache never reached the browser either. The strategy now passes `returnHeaders: true` and returns every `Set-Cookie` through Payload's `responseHeaders`, which Payload applies to REST and GraphQL responses.

### Changed

- **Session reads that cannot deliver a cookie no longer extend the session.** When Payload runs the strategy with `canSetHeaders: false` (the admin's server renders, `payload.auth({ headers })` without `canSetHeaders: true`), and in `getServerSession()` / `getServerUser()` and the api-key endpoint guards, `getSession()` is now called with `disableRefresh`. Before, these calls extended the row in the database with no way to tell the browser, so the two expiries drifted apart. Refresh still happens everywhere the cookie can be delivered: through the strategy on REST/GraphQL, on Better Auth's own endpoints, and from `payload.auth({ headers, canSetHeaders: true })` when you forward `responseHeaders` (see README §5).

- **`betterAuthStrategy`'s `authenticate` is typed with Payload's exported `AuthStrategyFunctionArgs`** rather than a hand-written subset, so `canSetHeaders`, `isGraphQL` and `strategyName` follow Payload's contract.

### Upgrading

No action needed. If you call `payload.auth({ headers })` in a Route Handler or Server Action and want the response to carry the refreshed cookie, pass `canSetHeaders: true` and forward `responseHeaders`. Otherwise that call is now a pure read — which is what it effectively was before, minus the stray database write.

## [0.12.2] - 2026-09-04

Performance and correctness of the Postgres census in `migrateStringifiedArrays()`.
No behaviour change to what it converts. Thanks again to the downstream reporter,
who read the 0.12.1 implementation and found all three of these.

### Fixed

- **The Postgres census pages instead of materializing the whole result set.** It selected every matching row with no `LIMIT` and built one array before converting any of them. In a pre-0.12 database *every* row is stringified, so the worst case was an entire table in memory — and `oauthAccessTokens` is the table most likely to be large in a real provider. It now pages at `batchSize`.

- **`batchSize` is honoured on Postgres.** It was documented but only ever applied to the SQLite/MongoDB path, so passing it on Postgres silently did nothing.

- **Paging is keyset on `id`, not `OFFSET`.** Converting a row makes it stop matching `jsonb_typeof(...) = 'string'`, so the result set shrinks underneath the walk and an offset would step over rows. Rows that are skipped (a string that doesn't parse to an array) stay matching, which an offset would also mishandle. Advancing past the last handled id is correct for both, and terminates even when every row in a page is skipped.

### Changed

- **All of a table's array columns are censused in one scan.** `oauthClients` carries seven `string[]` columns and was read seven times over; it is now read once, with each column projected through its own `CASE WHEN jsonb_typeof(...)`.

- **One update per row rather than one per converted field.** A row with several stringified columns was written once per column, each firing Payload's hooks again.

## [0.12.1] - 2026-09-04

`migrateStringifiedArrays()` was a silent no-op on Postgres, and its `converted: 0`
read as "your database is clean". Combined with 0.12.0's advice to then delete your
own tolerant parsing, that could take a legitimate OAuth connector offline. Thanks
to the reporter who measured this against a live database and traced the cause.

### Fixed

- **`migrateStringifiedArrays()` now censuses the stored shape on Postgres instead of the value the ORM returns.** Payload writes these fields to a `jsonb` column, so a stringified value is stored as a *jsonb string*. On read, node-postgres parses the jsonb and hands drizzle a JS string — and drizzle's `PgJsonb.mapFromDriverValue` runs `JSON.parse` on any string it receives (a guard for drivers that return raw text). That second parse turns the stored string back into an array before Payload sees it, so a stringified row and a native one are **indistinguishable** through `payload.find()`. The migration's `typeof value === 'string'` check could therefore never fire: it reported `scanned: 207, converted: 0` against a database with 62 genuinely stringified rows. The census now runs in SQL against `jsonb_typeof`, which reports what is actually stored.

  SQLite and MongoDB were never affected — SQLite stores json as TEXT and drizzle parses it exactly once, MongoDB stores the value verbatim — so on those backends the Local API is faithful and is still used.

- **Results carry `observedVia`** (`'stored-shape' | 'local-api'`), so a `converted: 0` is interpretable. "We inspected the columns and they were clean" and "we could not observe the stored shape" are different facts and printed identically before.

- **It throws instead of reporting a clean database it could not inspect.** If the Postgres adapter doesn't expose drizzle, or a collection's table can't be resolved, that is now a hard error naming the collection and field rather than a `converted: 0`.

### Changed

- **Corrected the 0.12.0 claim that an unmigrated row breaks `/oauth2/authorize`.** It doesn't, on Postgres — the same double-parse launders the value before Better Auth sees it, so `findRegisteredRedirectUri` receives an array and works. The real exposure is narrower: **code that reads these columns with raw SQL**, which carries no column type and so bypasses drizzle's mapper entirely and sees the string. A DCR connector gate or consent screen reading `redirect_uris` via `drizzle.execute(sql\`…\`)` is the case that matters.

- **Reordered the upgrade guidance so the workaround removal comes last**, after the migration has been verified against the stored shape. 0.12.0 had it the other way round, which is what turned a false negative into a lockout: `converted: 0` → conclude there is nothing to convert → delete the tolerant parse → every raw-SQL read of an unconverted row returns `[]`. For a redirect-URI allowlist that is a hard lockout of a legitimate connector.

### Upgrading

If you already ran the 0.12.0 migration and saw `converted: 0` on Postgres, **re-run it** — that result was not trustworthy. Confirm each row reports `observedVia: 'stored-shape'`, and verify independently before removing any tolerant parsing of your own:

```sql
SELECT jsonb_typeof(scopes) AS shape, count(*)
FROM oauth_access_tokens GROUP BY 1;
```

`string` rows are unconverted; you want only `array` (and `null`). If you need to convert by hand, or outside the plugin:

```sql
UPDATE oauth_access_tokens
SET scopes = (scopes #>> '{}')::jsonb
WHERE jsonb_typeof(scopes) = 'string';
```

Only after that census reads clean should you drop your own `JSON.stringify`-on-write or tolerant-parse-on-read.

## [0.12.0] - 2026-09-04

Array-typed fields were being written to Payload as JSON strings. The adapter now
stores them as arrays — one shape in the database, no translation layer — and a
one-time migration converts rows written by earlier releases.

### Breaking

- **`string[]` / `number[]` values are now stored as real arrays** ([#34](https://github.com/allandelmare/payload-better-auth/issues/34)). Better Auth 1.7 split `supportsArrays` out of `supportsJSON`, and this adapter kept reporting `supportsArrays: false` — so the adapter factory `JSON.stringify`'d every array value on its way into Payload. A `additionalFields: { roles: { type: 'string[]' } }` backed by a field that validates its shape failed the write outright (`ValidationError: data must be array`); everything that did save landed as `'["a","b"]'` where an array belonged, unqueryable and rendered as a quoted string in the admin UI. `supportsArrays` describes whether the backend holds native arrays — the official Postgres, MongoDB and memory adapters all report `true`, and Payload's `json` field validation handles arrays explicitly. The adapter talks to Payload's Local API rather than a SQL driver, so this holds for every Payload database adapter, exactly as the already-unconditional `supportsJSON: true` does.

  **This changes stored data, so existing rows need migrating once** — see Upgrading. The oauth-provider plugin is where this bites: every array-typed field in Better Auth today belongs to it (`redirectUris`, `scopes`, `grantTypes`, `responseTypes`, `contacts`, `resources`, `requestedUserInfoClaims`, `allowedScopes`), and those rows are written at registration and then only read, so they never correct themselves. Left unmigrated, Better Auth's `findRegisteredRedirectUri` calls `registered.find(...)` on a string and throws, breaking `/oauth2/authorize` for that client.

- **`number[]` now generates a `json` collection field** instead of `text`. `mapFieldType` handled `string[]` but let `number[]` fall through, which only worked because arrays were being stringified. No Better Auth table ships a `number[]` field, so this affects `additionalFields` only.

### Added

- **`migrateStringifiedArrays()`** — the one-time data migration for the above. It reads the array-typed fields out of your own Better Auth schema rather than a hardcoded list, so it covers whatever plugins you run, and it is safe to re-run: values that are already arrays are left alone. Supports `dryRun` for a report first, `onProgress` for output, and `batchSize` for paging. A string that doesn't parse to an array is skipped and counted, never guessed at.

- **Tests pin the shape of the user `betterAuthStrategy` returns.** Every non-null return now has assertions for `collection` and `_strategy` (cookie/API-key path and OAuth JWT path), and the OAuth JWT path — previously untested — is covered end to end with a mocked `verifyBearerToken`: issuer/audience/JWKS derivation, `oauthScopes` and organization context from claims, and fail-closed behaviour when `baseURL` is missing, verification fails, or the `sub` has no Payload user. Downstream packages now discriminate on `collection` (payload-puck ≥ 0.9.0), so this is guaranteed behaviour rather than incidental.

### Fixed

- **Docs: API keys must be sent as `x-api-key` unless Better Auth is configured otherwise.** The strategy comment and the 0.8.0 changelog entry stated that `betterAuthStrategy` authenticates keys sent via both `x-api-key` and `Authorization: Bearer`. Which header counts as an API key is decided by Better Auth's api-key plugin inside `getSession()`, and by default it reads only `x-api-key`; a `Bearer <key>` request yields no session unless the app sets the plugin's `apiKeyHeaders` or `customAPIKeyGetter` (verified against Better Auth 1.7.1). The code is unchanged — the `authorization` fallback in the strategy and `extractApiKeyFromRequest` still serve apps that configured it — but the comments and docs now say so.

### Upgrading

**If you don't use the oauth-provider plugin and have no array-typed `additionalFields`, there is nothing to do.** Nothing else in Better Auth uses an array field.

Otherwise, run the migration once after upgrading and before serving traffic:

```ts
import { migrateStringifiedArrays } from '@delmaredigital/payload-better-auth'
import { betterAuthOptions } from './lib/auth/config'

const results = await migrateStringifiedArrays({
  payload,
  betterAuthOptions,
  dryRun: true, // drop this once the report looks right
})
console.table(results)
```

Two more things worth checking:

- **Drop your own workarounds.** If you were writing `JSON.stringify(uris)` into these columns or parsing them back out on read, stop — after migrating, the column holds one shape. Leaving a `JSON.parse` in place that assumes a string will now break.
- **`number[]` under `session.additionalFields`** changes its generated Payload field from `text` to `json`, so it needs a Payload schema migration (`payload migrate:create`). `string[]` was already `json` and is unaffected.

## [0.11.3] - 2026-09-01

The admin login page decided which sign-in buttons to render by reading Better
Auth's raw configuration. That object is not the list Better Auth signs people in
against, so the page both hid providers that worked and showed providers that
didn't. Detection now reads the resolved auth context (`auth.$context`) — the same
list `/sign-in/social` matches against.

### Fixed

- **Generic OAuth / OIDC providers appear on the admin login** ([#32](https://github.com/allandelmare/payload-better-auth/issues/32)). Since Better Auth 1.7, `genericOAuth()` registers its providers as first-class social providers — merged into the auth context during plugin `init()`, never into `options.socialProviders`, which is where this plugin looked. A Keycloak, Zitadel, Okta, Auth0 or Entra ID provider was silently filtered out of `enableSocial`, and the only way to offer SSO on the admin login was a custom login view. They now render alongside the built-in providers, sign in through the same `signIn.social` call, and are allowlisted by their `providerId`. A provider's configured `name` becomes its button label, so `{ providerId: 'zitadel', name: 'Company SSO' }` reads as "Continue with Company SSO" instead of "Continue with Zitadel".
- **No more buttons that Better Auth would refuse.** Reading raw config also meant rendering providers that never resolved: one switched off with `enabled: false`, or one whose config is a function that resolves to `null`. Clicking either produced "Provider not found". The login page now shows a provider if and only if sign-in accepts it.
- **Sign-in methods contributed by a plugin are detected.** Better Auth merges options returned from a plugin's `init()` into the auth context, so `auth.options` — what detection read — can be missing configuration that is genuinely in effect. Method detection (`enablePassword`, `enableSignUp`, `enableForgotPassword`, the OTP lengths) now reads the post-init options, and no longer hides a method the server actually accepts.

### Changed

- **The login view resolves its props from `auth.$context` rather than `auth.options`.** `$context` is a single promise built once by `betterAuth()`, so this costs nothing per render. If it rejects — `genericOAuth`'s `init()` throws when OIDC discovery fails and no `accountIssuer` is set — the login page logs and falls back to rendering password sign-in with no social buttons, rather than 500ing the one screen an admin needs to fix the config.

### Upgrading

No action. If you use `genericOAuth()` and kept a custom login view solely to render its buttons, you can now drop it and set `admin.login.enableSocial` instead. The account-creation warning under Social Sign-In applies to generic providers exactly as it does to built-in ones: set `disableImplicitSignUp` if you don't want a public admin login creating user rows.

## [0.11.2] - 2026-08-25

Two-factor authentication was reachable but not recoverable: the login form's
second-factor step only accepted TOTP, and the bundled setup view could never
succeed for an account with a password. Both are fixed, along with the smaller
things found alongside them.

### Added

- **`admin.login.enableTwoFactorBackupCode` / `admin.login.enableTwoFactorEmailOtp`** (`boolean | 'auto'`, default `'auto'`) — what the login form's two-factor step may offer beyond the authenticator app. `'auto'` detects the twoFactor plugin and its `otpOptions.sendOTP` server-side. These are ceilings: the step then follows the factors Better Auth reports for the signed-in user, and never offers one they don't hold.
- **`TwoFactorSetupViewWrapper`** (exported from `/rsc`) — server wrapper for `TwoFactorSetupView` that resolves whether the signed-in account has a password by listing its Better Auth accounts, mirroring `LoginViewWrapper`'s detection pattern. Use it as the admin view; the client component also accepts an explicit `hasPassword` prop for custom flows.

### Fixed

- **The login form's two-factor step accepts backup codes and emailed codes**, not just TOTP. A user with a lost authenticator was locked out entirely: backup codes were issued by setup and redeemable by nothing, and the emailed second factor was unreachable even with `otpOptions.sendOTP` configured. Where admin access itself requires 2FA, that could mean recoverable by nobody. The step now offers "use a backup code" (free-text, `verifyBackupCode`) and "email me a code" (`sendOtp`/`verifyOtp`, with a resend action on a 30-second cooldown).
- **The step opens on a factor the user actually has.** Better Auth reports them on sign-in (`twoFactorMethods`) and the login view discarded them, always opening on an authenticator input. Someone who enabled 2FA by email now lands on the emailed-code entry instead of a code they can't produce, and the "use your authenticator app" link is hidden when there is no verified TOTP secret.
- **`TwoFactorSetupView` can enable 2FA for password accounts at all.** It fired a passwordless `/two-factor/enable` on mount, which Better Auth rejects for any account holding a password — a guaranteed "Invalid password" with no field to answer it. Credential accounts now confirm their password first; passwordless accounts start enablement immediately. Backup codes can also be downloaded as a file, and copying confirms visibly instead of failing silently when clipboard access is denied.
- **One-time code inputs honour the configured length.** The forms assumed six digits, so a config setting `emailOTP`'s `otpLength`, or the twoFactor plugin's `totpOptions.digits` / `otpOptions.digits`, to anything else produced a form that truncated the code and refused to submit it. All three are read from the plugin options server-side.
- **`BeforeLogin` is no longer injected where it can't render.** Payload renders `beforeLogin` inside its *own* login view, which this plugin replaces by default — so the injected component, and any `beforeLoginComponent` a consumer passed, silently never rendered. It is now injected only when `disableLoginView: true` keeps Payload's login view alive, and passing one that can't be injected logs a warning instead of dropping it silently.
- **The backup-codes download link** is attached to the document before it's clicked (Firefox ignores a detached anchor) and its object URL is revoked after the download starts rather than in the same tick, which cancelled it in some browsers.

### Upgrading

No action for the common setup. Two narrow cases:

- **If you mount `TwoFactorSetupView` yourself** (rather than the plugin's management UI) **for accounts with no password** — social- or passkey-only, with the twoFactor plugin's `allowPasswordless` — it now shows a password step those users can't answer, because `hasPassword` defaults to `true`. Render `TwoFactorSetupViewWrapper` from `/rsc` instead, which resolves it server-side, or pass `hasPassword={false}`.
- **If you pass `admin.beforeLoginComponent`** and have not set `admin.disableLoginView: true`, it is no longer injected. It never rendered either way; the plugin now says so at config-build time instead of staying quiet.

## [0.11.1] - 2026-08-21

Documentation fix. No code change — but if you followed 0.11.0's migration guidance and use Google, Facebook, Apple, LINE, Cognito, Paybin or Microsoft Entra ID sign-in, **your `account.issuer` backfill is wrong and needs repairing.** See Migration under 0.11.0, now corrected.

### Fixed

- **Corrected the `account.issuer` backfill values.** 0.11.0 stated that built-in social providers use the synthetic `local:oauth:<providerId>` form. That is the **fallback**, applied only where a provider declares no issuer of its own — and in Better Auth 1.7.1 seven built-ins declare one: `google` (`https://accounts.google.com`), `facebook` (`https://www.facebook.com`), `apple` (`https://appleid.apple.com`), `line`, `cognito`, `paybin` and `microsoft` (per-tenant).

  The claim came from grepping `better-auth/dist/social-providers/`, which is a two-line re-export of `@better-auth/core/social-providers`. Zero matches read as "no provider declares one". The docs now name the affected providers, and give a one-liner that reads the value off the provider rather than restating it:

  ```sh
  node -e "import('better-auth/social-providers').then(m => console.log(m.google({clientId:'x',clientSecret:'y'}).accountIssuer))"
  ```

- **Documented that Microsoft Entra ID's `accountId` moves as well.** 1.7 keys the subject on the `oid` claim where 1.6 stored `sub`, so an Entra row needs both halves rewritten, per-row, from the `id_token` already on it. 0.11.0 mentioned the issuer change but not this.

- **Documented that Facebook's `accountId` does *not* move**, despite an `accountSubject` that reads like it changed — both the Limited Login (`sub`) and Graph (`id`) branches match what 1.6 stored.

  **Why this matters:** a wrong issuer fails silently. The row is filed under a key Better Auth never queries, so the next sign-in does not match it, takes the new-identity path and writes a *second* account row — which the unique index permits, because the pair differs. Nothing throws. It surfaces later as an unexpected account-link prompt, or `account_not_linked` where policy forbids linking. Confirmed in the wild: one Google user with the same `sub` across two rows, one `local:oauth:google` and one `https://accounts.google.com`.

  To check an existing database: `SELECT provider_id, issuer, count(*) FROM accounts GROUP BY 1,2;`. Two issuer forms for one provider means rows have already re-linked, and a repair has to drop the unique index, refuse where a repaired identity spans two users (that is a merge for a human), collapse the duplicates, then recreate the index.

## [0.11.0] - 2026-08-19

Better Auth 1.7 support. 1.7 is a large release with a wide breaking-change surface; most of it is absorbed here, but it raises the minimum Better Auth version and requires a one-time database migration. See Migration.

### Changed

- **BREAKING: Better Auth >= 1.7.0 is now required** (peer ranges bumped for `better-auth`, `@better-auth/api-key` and `@better-auth/passkey`). This is a hard floor, not a preference: 1.7 added two **required** methods to the database-adapter contract and its factory throws rather than falling back, so the previous release cannot run on 1.7 and this release cannot run on 1.6.
- **BREAKING: `account` gains a required `issuer` field and a unique `(issuer, accountId)` index.** Better Auth 1.7 scopes account identity by issuer instead of `providerId`, so generated collections now emit both. Existing databases need a backfill before the `NOT NULL` column can be added — see Migration.

### Added

- **Adapter `consumeOne` and `incrementOne`.** Better Auth 1.7 requires these atomic primitives on every custom adapter and dispatches to them for single-use credentials (email verification, password reset, magic links, email OTP, device-authorization codes) and guarded counters (API-key quota and rate limits, two-factor backup codes, team member counts). Without them, those flows throw `Adapter "payload-adapter" must implement consumeOne…` at runtime.

  Payload's Local API offers no `DELETE … RETURNING` or `SET n = n + d`, so both are read-then-write with the race window narrowed rather than removed. `consumeOne` returns the row **only if its own delete removed it** (a racing consumer's delete 404s and yields `null`), preserving single-use semantics for tokens. `incrementOne` re-asserts Better Auth's own guard (e.g. `remaining > 0`) plus the counter values it computed from, and re-reads and retries — bounded at five attempts — when a concurrent writer wins, rather than clobbering it. The residual window and how to close it for API-key quota are documented under [Atomic operations](./README.md#atomic-operations).
- **Table-level indexes from the Better Auth schema are passed through to generated collections.** 1.7 moved constraints that were previously implicit into the schema as table `indexes`; the generator now maps them onto Payload's compound `indexes` (renaming reference fields, e.g. `userId` → `user`) and warns rather than emitting an index over a field it did not generate.
- **Compile-time guard against the next adapter-contract change.** The adapter object is returned through an `as CustomAdapter` cast to reconcile the interface's generic return types — but a cast also silently accepts an object that is *missing* methods, which is exactly how 1.7's new requirements cleared the build while the factory would have thrown at runtime. A type-level completeness check now fails the build instead.

### Fixed

- **OAuth JWT bearer verification in `betterAuthStrategy`.** Better Auth 1.7 removed `verifyAccessToken` from `better-auth/oauth2`, splitting it into `verifyBearerToken` (raw token, bearer only) and `verifyAccessTokenRequest` (full request, also handles RFC 9449 DPoP sender-constrained tokens). The strategy now uses `verifyBearerToken`, which is the form its inputs support — Payload hands the strategy only `headers`, with no method or URL. DPoP-bound tokens are rejected here by design.
- **Two-factor setup no longer shows a blank manual-entry secret.** `/two-factor/enable` returns `{ method, totpURI, backupCodes }` and has no `secret` field; `TwoFactorSetupView` was reading `data.secret` and rendering nothing. Both 2FA components now derive the secret from the TOTP URI via a shared helper.
- **`PasskeyLoginView` builds again under 1.7.** The new `hydrateSession(session)` client method puts the plugin-augmented user shape in parameter position, making the client type invariant — a plugin-laden client no longer assigns to a bare `ReturnType<typeof createAuthClient>`. The ref is now typed from the actual client factory.

### Internal

- Both two-factor components request `method: 'totp'` explicitly. It remains Better Auth's default, but 1.7 made the response a discriminated union on `method`, and these views only render the authenticator-app flow — they now narrow on it and surface an error instead of rendering an empty QR code if a server returns something else.
- Test doubles for Payload now recurse through nested `and`/`or` groups, support the `exists` operator, and raise Payload's 404 on a delete-by-id for a missing row — all three are needed to exercise the guarded writes faithfully.
- Plugin-id table re-verified against 1.7.

### Migration

1. **Upgrade the Better Auth peers together** — `better-auth@^1.7`, plus `@better-auth/api-key` / `@better-auth/passkey` at the same major if you use them.

2. **Generate the migration, then edit it to backfill `issuer`.** `payload migrate:create` will produce a migration that adds `issuer` as `NOT NULL` and creates the unique index — and that migration **fails on a populated table**, because every existing row would violate the constraint. Split it into add-nullable → backfill → enforce:

   ```sql
   ALTER TABLE accounts ADD COLUMN issuer varchar;

   -- Email/password rows
   UPDATE accounts SET issuer = 'local:credential' WHERE provider_id = 'credential';
   -- OAuth rows: the issuer each provider DECLARES (see "Issuer values" below)
   UPDATE accounts SET issuer = 'https://accounts.google.com' WHERE provider_id = 'google';
   UPDATE accounts SET issuer = 'https://www.facebook.com'    WHERE provider_id = 'facebook';
   -- Only providers that declare no issuer of their own get the synthetic form
   UPDATE accounts SET issuer = 'local:oauth:' || provider_id WHERE issuer IS NULL;

   ALTER TABLE accounts ALTER COLUMN issuer SET NOT NULL;
   -- then the unique index exactly as Payload generated it
   ```

   Before enforcing, confirm the backfill produced no duplicates — this must return zero rows, or the unique index will fail:

   ```sql
   SELECT issuer, account_id, COUNT(*)
   FROM accounts GROUP BY issuer, account_id HAVING COUNT(*) > 1;
   ```

   Table and column names above assume the plugin's defaults on Postgres (pluralized slug `accounts`, snake_case columns). Adjust for `usePlural: false`, a custom `account` model name, or MongoDB.

   **Issuer values — `local:oauth:<providerId>` is the FALLBACK, not the rule.** Email/password uses `local:credential`. The synthetic OAuth form applies only to providers that declare no issuer of their own. In Better Auth 1.7.1 seven built-ins declare one and must NOT get it: `google` → `https://accounts.google.com`, `facebook` → `https://www.facebook.com`, `apple` → `https://appleid.apple.com`, plus `line`, `cognito`, `paybin` and `microsoft`. Every generic-OAuth/OIDC provider (Okta, Auth0, Keycloak) uses its discovery issuer. Read the value instead of guessing:

   ```sh
   node -e "import('better-auth/social-providers').then(m => console.log(m.google({clientId:'x',clientSecret:'y'}).accountIssuer))"
   ```

   Getting this wrong is silent. The row is filed under a key Better Auth never queries, so the next sign-in does not match it, takes the new-identity path and writes a SECOND account row — which the unique index permits, because the pair differs. Nothing throws. It surfaces later as an unexpected account-link prompt, or `account_not_linked` where the policy forbids linking.

   **Microsoft Entra ID cannot be backfilled with a flat UPDATE, and its `accountId` moves too.** Its issuer is per-tenant — `https://login.microsoftonline.com/<tid>/v2.0` — so there is no single value to write. And 1.7 keys the subject on the `oid` claim (`accountSubject: ({ profile }) => profile.oid`) where 1.6 stored `sub` (its `getUserInfo` returned `id: user.sub`), so every existing Entra `accountId` is wrong as well. Both values are in the `id_token` already stored on the row: decode the claims segment (base64url) and take `iss` and `oid`. Decode only — do not verify the signature. This reads a claim out of a row already in your own database, not a token presented by a caller, so there is nothing to authenticate; stored `id_token`s are short-lived and long expired, so verification would fail regardless. A row with no usable `id_token` cannot be repaired this way — decide per row (delete it and let the user re-link, or look the `oid` up through Graph) rather than guessing.

   **Facebook's `accountId` does NOT move** — worth stating, because its `accountSubject` reads like it changed. 1.7 declares `"sub" in profile ? profile.sub : profile.id`, which is the same branch 1.6 took inside `getUserInfo`: the Limited Login path (a 3-part `id_token`) yields `sub`, the Graph path (`/me?fields=…`) yields `id`. Both are unchanged, so Facebook rows need only the `issuer` update. Rows with no stored `id_token` came via Graph; only a Limited Login / `configId` consumer needs to look further.

   The same question is worth asking for any provider you use: `accountSubject` in 1.7 is an explicit declaration, where 1.6 derived the id inside `getUserInfo`. Where the two disagree, `accountId` needs migrating alongside `issuer`.

3. **Apply the migration** and verify sign-in for each provider you support before rolling out. Better Auth writes `issuer` on every new account row from this point on.

4. **Only if they apply to you** — these are Better Auth changes this package passes through rather than shields you from:
   - **Database joins** moved out of experimental: `experimental: { joins: true }` → `advanced: { database: { joins: true } }`.
   - **Dynamic `baseURL` behind a proxy**: 1.7 resolves the auth origin from `Host` by default. If your proxy exposes the public hostname via `x-forwarded-host`, set `advanced: { trustedProxyHeaders: true }`. Proxies that rewrite the host (Vercel, Cloudflare, Netlify) need no change.
   - **Generic OAuth** was rewritten: `signIn.oauth2({ providerId })` → `signIn.social({ provider })`, `oauth2.link()` → `linkSocial()`, and callbacks moved to `/api/auth/callback/:id`. The bundled admin login already uses `signIn.social`.
   - **The `oidcProvider` plugin was removed** in favor of `@better-auth/oauth-provider`, and the MCP plugin moved to `@better-auth/mcp`.

## [0.10.0] - 2026-08-07

### Fixed

- **`ResetPasswordView` no longer invalidates its own token.** The view strips `?token=` from the URL (correctly — it keeps the token out of history, referrers and analytics), but it re-derived the token from `useSearchParams()` in the same effect that did the stripping. Next's App Router mirrors `history.replaceState` into its router state, so the effect re-ran with an empty query and rendered "Invalid or missing reset token" over a perfectly working form. The token is now captured once, before the URL is touched, and the strip runs in a mount-only effect.
- **`ForgotPasswordView` actually sends the reset email.** It posted to `/forget-password`, which Better Auth 1.6 renamed to `/request-password-reset` — and the anti-enumeration handling treated the resulting 404 as success, so the page said "check your email" while sending nothing, for every consumer. It now uses the Better Auth client's `requestPasswordReset()` (which tracks endpoint renames), and only reports success when the request succeeded: Better Auth already answers unknown emails vaguely server-side, so genuine failures (rate limits, misconfiguration) surface instead of being swallowed. The view also gained an optional `authClient` prop, consistent with the other components.
- **The plugin now works when Payload's API route isn't `/api`** (`routes: { api: '/api/payload' }` previously 404'd every auth request and broke admin sign-in). Two independent mismatches were fixed:
  - **Admin components no longer assume `/api/auth`.** Every component that builds a Better Auth client (`LoginView`, the passkey login/buttons, the 2FA/passkey/API-key management clients) or hand-rolls a fetch (`LogoutButton`, `ForgotPasswordView`, `ResetPasswordView`, `TwoFactorSetupView`, `TwoFactorVerifyView`) now derives the endpoint mount from the live Payload config (`routes.api` + `authBasePath`) via a shared `useAuthMountPath()` / `useAuthClientBaseURL()` hook, exported from `/components` for custom UIs. The plugin exposes `authBasePath` on `admin.custom.betterAuth` (client-readable) and `custom.betterAuth` (server), and the login wrappers pass it across the RSC boundary since the unauthenticated login page's client config strips `admin.custom`.
  - **`basePath` mismatches are flagged at init.** Better Auth's router rejects any request outside its own `basePath` (default `/api/auth`) with an empty 404, and `basePath` also determines the path embedded in emailed reset/magic links. Since `createAuth` is consumer-supplied, the plugin can't set it — instead `onInit` now compares Better Auth's resolved `basePath` against the actual mount and logs an error naming the exact value to pass to `betterAuth()`. Documented in the README: with a custom `routes.api`, set `basePath: '<routes.api><authBasePath>'`.

### Security

- **Secret fields on managed collections are now locked by default** (`secureSecretFields` option on `betterAuthCollections()`, default `true`). Session tokens, TOTP secrets and backup codes, verification identifiers/values, stored OAuth access/refresh/ID tokens, hashed passwords and API keys, JWKS private keys, and OAuth client secrets get `access: { create/read/update: () => false }` and are hidden in the admin UI. Better Auth's own operation is unaffected — the adapter runs with `overrideAccess: true`; this closes the Payload REST/GraphQL and admin-UI read path, where anyone the collection's `access.read` admits (admins, by default) could previously lift a live session token or TOTP secret — enough to hijack a session or clone a second factor. When a locked field was the collection's `useAsTitle` (e.g. `verification.identifier`), the title falls back to `id` so row labels don't render blank. Locking also applies to secret fields *added by augmentation* to your pre-existing collections; fields you defined yourself are never modified. Opt out with `secureSecretFields: false`, or pass a partial map (merged over the defaults, exported as `defaultSecretFieldsByModel`) to customize per model — e.g. `{ session: [] }` to unlock sessions only.

## [0.9.2] - 2026-07-10

### Added

- **Startup warning when `firstUserAdmin` is disabled.** Setting `firstUserAdmin: false` removes the plugin's role-forcing guard from the users collection, making the consumer solely responsible for constraining create access. `betterAuthCollections()` now emits a one-time `console.warn` at config-build time reminding you to reject anonymous/non-admin callers on **both** the collection's `access.create` and the role field's `access.create` — otherwise Payload's auto-REST (`POST /api/<users>`) can let anyone seed a user with a privileged role. Guard behavior is unchanged; this is purely a diagnostic.

## [0.9.1] - 2026-07-02

### Added

- **Passkey-enabled admin login wrapper** (`components/login-passkey#LoginViewWrapperWithPasskey`). 0.9.0 stopped the default `LoginView` from importing the optional `@better-auth/passkey` peer (to fix builds for consumers who don't use passkey), which meant passkey sign-in on the **auto-injected** admin login no longer worked — there was no way to inject a passkey-capable client. This adds a drop-in wrapper that does the same server-side method detection as the default and injects a passkey client. Point your login view at it:
  ```ts
  createBetterAuthPlugin({
    admin: {
      loginViewComponent:
        '@delmaredigital/payload-better-auth/components/login-passkey#LoginViewWrapperWithPasskey',
    },
  })
  ```
  It lives in a separate entry point, so consumers who don't use passkey never pull the peer into their bundle (the default login view stays passkey-free). No change needed unless you use passkey sign-in on the admin login.

### Internal

- `LoginViewWrapper`'s prop resolution extracted to a shared `resolveLoginViewProps()` so the default and passkey wrappers share one source of truth (no prop-forwarding drift).

## [0.9.0] - 2026-07-02

Second hardening pass from the audit — correctness, robustness, and defensive fixes. Contains a few breaking changes (minor bump signals them, pre-1.0). See Migration.

### Security

- **`normalizeRoles` no longer comma-splits a role string.** A value like `"super,admin"` was split into `["super", "admin"]`, letting a fragment coincidentally match `admin` and grant access. A string is now treated as a single role; use an array for multiple roles.
- **`canUpdateOwnFields` no longer verifies the current password via `payload.login`.** That made every access check a full, unthrottled login attempt — a brute-force oracle against the user's own password. Password changes must now go through Better Auth's native, rate-limited change-password flow; the access function denies updates that touch password fields.
- **Endpoint proxy prefers the configured Better Auth `baseURL` over client `x-forwarded-proto`/`host` headers** when building the URL Better Auth signs/validates, reducing host-header influence on cookie/redirect/OAuth origins (falls back to headers only when no baseURL is set).
- **Session JWT field inclusion is now an exact allowlist**, not a suffix match — a future session field ending in `Token` (e.g. a plugin's `refreshToken`) can no longer be auto-embedded in issued JWTs.
- **API-key permission checks prefer the strategy-resolved `req.user.apiKeyScopes`** (a single side-effect-free read) over calling `verifyApiKey` — which consumes the key's usage quota and a rate-limit slot. Multi-permission checks (`requireAllPermissions`/`requireAnyPermission`) no longer burn quota once per permission; the fallback path verifies at most once per request.

### Changed

- **BREAKING: passkey sign-in in the default `LoginView` now requires an injected `authClient`.** The component no longer statically imports the optional `@better-auth/passkey` peer — doing so broke the build of every consumer who hadn't installed it, even those not using passkey. Pass an `authClient` built with `passkeyClient()` to enable passkey; without it, the passkey button shows a guidance message. (The passkey/api-key-specific components still import their peers, which is correct — using those features implies installing the peer.)
- **BREAKING: `starts_with`/`ends_with` are now correctly anchored.** They previously mapped to Payload's `like`, which is not anchored (it matches words/substrings anywhere), so they returned over-broad results. They now narrow with `contains` at the database and anchor the match precisely in a post-filter. Note: deep pagination combined with these operators is best-effort (post-filtering can't use DB-level pagination); they scan a bounded window.
- **BREAKING: `normalizeRoles` / `canUpdateOwnFields` behavior** — see Security and Migration.
- **Adapter `create`/`update` return the raw Payload result** instead of merging input over it. Merging re-injected fields Payload silently dropped (a missing column), making Better Auth believe a field persisted when it did not. The factory maps field names back on output, so return values are unchanged for correctly-configured collections; genuinely dropped fields now emit a warning instead of vanishing silently.

### Fixed

- **Collection augmentation no longer turns non-PK references into relationships.** A non-PK reference (e.g. `oauthRefreshToken.clientId` → `oauthClient.clientId`) added to a pre-existing collection wrongly became a stripped relationship field, mismatching what the adapter writes. It now stays a plain field with its original name, matching `generateCollection`.
- **`getExistingFieldNames` recurses into presentational containers** (`row`, `collapsible`, unnamed `tabs`). A users collection that organizes `email`/`role` inside tabs/rows no longer has those fields re-added by augmentation (which caused duplicate-field config errors).
- **Endpoint proxy fails closed on an unresolvable request path** (falling back to parsing `req.url`) rather than proceeding with an empty pathname — which would target the wrong route and silently disable the api-key authorization guard.
- **Multi-instance safety:** the auth instance and the api-key permissions config are now resolved per Payload instance (stored on the instance, read via `req.payload`) rather than a module-level singleton, so a second plugin instance in one process (monorepo dev, multi-tenant, parallel tests) can't be handed another instance's auth or relax its api-key role guard.
- **Shared plugin-id detection.** `detectEnabledPlugins` and `detectEnabledMethods` now derive from one helper (robust to a non-array `plugins`), fixing drift between them.
- **Mount-effect cleanup.** `LoginView`'s session check and the management clients' initial fetches now bail on unmount (no stale `router.push`/setState, no StrictMode double-apply).

### Notes

- **API-key security parameters (expiry, rate limit, key length) remain the consumer's responsibility**, matching a native Better Auth setup — this package stays a thin adapter and does not impose opinionated key defaults.

### Migration

1. **Passkey in the admin login:** if you use passkey sign-in on the default `LoginView`, pass an `authClient`:
   ```ts
   import { createAuthClient, payloadAuthPlugins } from '@delmaredigital/payload-better-auth/client'
   import { passkeyClient } from '@better-auth/passkey/client'
   const authClient = createAuthClient({ plugins: [...payloadAuthPlugins, passkeyClient()] })
   // <LoginView authClient={authClient} ... />
   ```
2. **Roles:** if you stored multiple roles as a comma-separated string (`"admin,editor"`), switch the field to an array. A comma string is now a single role.
3. **Password changes:** move any "change password" UI from a Payload update on the user collection to Better Auth's `authClient.changePassword({ currentPassword, newPassword })` flow.
4. **`starts_with`/`ends_with`:** if you relied on the old (over-broad) behavior, note these are now correctly anchored.

## [0.8.0] - 2026-07-02

Security-hardening release from a full audit. Contains breaking changes; the minor bump signals them (pre-1.0). **Read the Migration section below before upgrading.**

### Security

- **API keys sent via `x-api-key` are now scope-enforced.** `extractApiKeyFromRequest` only read the `Authorization` header, but the auth strategy authenticates keys via **both** `x-api-key` and `Authorization: Bearer`. As a result, a key sent via `x-api-key` populated `req.user` while the access helpers saw no key — so any access function using `allowSessionOrPermission` / `allowSessionOrAnyPermission` / `allowAuthenticatedUsers: true` treated a scoped (or zero-scope) key as a **full session**, bypassing scope enforcement for write/delete. `extractApiKeyFromRequest` now reads `x-api-key`, and API-key-derived users (those carrying `apiKeyScopes`) are additionally excluded from the "authenticated user" short-circuit as defense-in-depth.
- **2FA TOTP secrets no longer leave the browser.** The 2FA setup/management views rendered the QR code via `https://api.qrserver.com/...`, sending each user's full `otpauth://…?secret=…` provisioning URI (including the shared secret) to a third-party service. QR codes are now generated **client-side** as inline SVG via `qrcode.react`. Anyone who could read that third party's logs could previously generate valid TOTP codes.
- **Roles are assigned authoritatively on the server at sign-up.** The admin login form no longer transmits a `role`, and both first-user-admin hooks now ignore a client-supplied role for non-first users (the Payload collection hook honors a role only when an already-authenticated admin performs the create). Previously a client could `POST { role: 'admin' }` to the sign-up endpoint and self-provision an admin when `role` was an input-writable field. See Migration.
- **First-user-admin concurrent-signup race narrowed.** The auto-injected hook added an `afterChange` guard that resolves a concurrent first-signup race to a single canonical admin (only bootstrap-assigned admins are ever demoted; admins created deliberately by an existing admin are untouched). Note this remains a bootstrap convenience — enable first-user-admin before exposing public sign-up.
- **`detectAuthConfig` no longer misreads `auth: true` as `disableLocalStrategy`.** A collection with `auth: true` (which *enables* Payload's local strategy) wrongly triggered admin-component injection, hijacking a working local login and potentially locking out admins whose credentials live only in Payload's local strategy. Only the object form with `disableLocalStrategy` now counts.
- **Adapter no longer logs credential-bearing query values.** The `findOne` error path logged the full `where` clause unconditionally — which for sessions is the raw token, for verifications the OTP, for api-keys the key hash. It now logs field **names** only (full `where` remains under `enableDebugLogs`).
- **Password-reset token is stripped from the URL** after capture (via `history.replaceState`), so it no longer lingers in browser history or analytics.

### Changed

- **BREAKING: `role` is server-assigned on sign-up.** See Migration for the `input: false` change and `firstUserAdmin.defaultRole`.
- **BREAKING: Node.js `>= 20.9` required.** The prior `^18.20.2` clause was dropped — Node 18 is EOL and the tested toolchain (Next 16, Vite 7) requires ≥ 20.9.
- **BREAKING: peer dependency ranges are capped to tested majors** (`better-auth >=1.6.0 <2`, `payload/@payloadcms/* >=3.69.0 <4`, `next >=15.5.16 <17`, `react >=19.2.1 <20`) to prevent silently installing an untested major.
- **`LoginView` `defaultSignUpRole` prop is deprecated and ignored.** It was previously sent to the server as a client-writable role. Configure the default self-sign-up role via `firstUserAdmin: { defaultRole }` instead.
- **Bumped Better Auth to 1.6.23** (from 1.6.18) across `better-auth` and `@better-auth/*`. Regenerated `generated-types` — the `twoFactor` schema gains `failedVerificationCount` and `lockedUntil` (BA's 2FA lockout hardening), which `betterAuthCollections()` now surfaces.
- **`package.json` `exports` reordered to `types` → `import` → `default`** so the `types` condition resolves under `node16`/`nodenext` module resolution; added a `./package.json` subpath export.

### Added

- **`qrcode.react`** is now a runtime dependency (used to render 2FA QR codes locally).
- **CI now runs `pnpm test` before publishing** (the tag-triggered publish workflow previously had no test gate).

### Fixed

- **Adapter pagination for non-aligned offsets.** `findMany` derived the Payload `page` as `floor(offset/limit)+1`, which is only correct when `offset` is a multiple of `limit`; arbitrary offsets (e.g. admin `listUsers`) returned duplicated/skipped rows. Non-aligned offsets now over-fetch from page 1 and slice to the true offset.
- **Idempotent `delete`/`update` by id.** Id-targeted deletes/updates threw Payload's 404 `APIError` (surfacing as a 500) when the row was already gone; they now no-op / return `null`, matching Better Auth's reference adapters (fixes spurious errors on double sign-out and concurrent session revocation).
- **`sortBy` on renamed reference fields.** `findMany({ sortBy: { field: 'userId' } })` sorted on a non-existent column (the factory maps `where` field names but not `sortBy`); the adapter now maps `sortBy` fields through the same `userId → user` rename, including under `usePlural: true`.
- **Bulk `updateMany`/`deleteMany` partial failures are now surfaced** (previously `docs.length` reported partial failures as success).

### Migration

1. **Make `role` server-only.** In your Better Auth `user.additionalFields`, set the role field to `input: false`:
   ```ts
   user: { additionalFields: { role: { type: 'string', defaultValue: 'user', input: false } } }
   ```
   To change the default role assigned to self-sign-ups, use the collections option:
   ```ts
   betterAuthCollections({ firstUserAdmin: { defaultRole: 'user', adminRole: 'admin' } })
   ```
   Remove any reliance on the `LoginView` `defaultSignUpRole` prop (now ignored). If you need to assign specific roles to non-first users, do it from a trusted context (the Payload admin UI, a seed script, or your own access-gated hook) — not the public sign-up endpoint.
2. **Node.js `>= 20.9`.** Upgrade your runtime/CI if you were on Node 18.
3. **`qrcode.react`** installs automatically as a dependency; no action needed unless you vendor node_modules.
4. **API-key access unchanged in usage** — if you relied on the (insecure) behavior where an `x-api-key` request bypassed scope checks under `allowSessionOrPermission`, note that keys are now scope-enforced on both header transports.
5. **Regenerate collections/types** if you use `betterAuthCollections()` with the `twoFactor` plugin, to pick up the new `failedVerificationCount` / `lockedUntil` columns (a Better Auth 1.6 schema addition).

## [0.7.9] - 2026-06-27

### Security

- **API-key requests no longer risk inheriting another user's scopes via ID collision.** When `betterAuthStrategy` resolves an API key's organization/scope context, it reads the API key row keyed by the mock session's id. Because sessions and API keys are separate Payload collections with independent serial sequences (the default `idType: 'number'`), a cookie session's row id can collide with an unrelated API key's id — so a request carrying a stray `Authorization: Bearer …` header could coerce a lookup of an arbitrary key. The lookup is now **bound to the authenticated user** (`referenceId === session user id`), so only a key the session's user owns is ever read. For a genuine API-key session this binding always holds (Better Auth derives the mock session's user from the key's `referenceId`); a colliding cross-user session simply matches no row. `idType: 'text'` (UUID) was not practically affected.

### Added

- **API-key scopes are now surfaced on `req.user`.** Authenticated API-key requests expose `req.user.apiKeyScopes` — the key's stored permissions flattened to `resource:action` strings (e.g. `{ inquiries: ['write'] }` → `['inquiries:write']`), mirroring `oauthScopes` on the OAuth/JWT path. It is `[]` for a key with no permissions and absent for non-API-key requests, so consumers can distinguish "scoped to nothing" from "not an API key". Previously only OAuth tokens carried scopes; API keys reached access control with no scope information, forcing downstream workarounds and leaving Payload-native collection access effectively un-gated for keys.
- **`apiKeysCollection` option on `betterAuthStrategy`** (default `'apikeys'`; use `'apikey'` when `betterAuthCollections({ usePlural: false })`) — the collection the strategy reads to resolve API-key scopes and organization metadata.

### Changed

- **`betterAuthStrategy` resolves API-key organization context and scopes by reading the API key row directly, instead of calling `auth.api.verifyApiKey`.** `verifyApiKey` is not a read — it consumes the key's usage quota (`remaining`) and a rate-limit slot, and can delete the key on exhaustion/expiry. Combined with the validation Better Auth already performs inside `getSession`, the previous code consumed quota/rate-limit **twice per request** for keys with `remaining` or rate limits configured. The strategy now performs a single, side-effect-free row read, so each API-key request consumes the key exactly once.

## [0.7.8] - 2026-06-24

### Added

- **Social / OAuth provider sign-in buttons on the admin login (opt-in).** A new `admin.login.enableSocial` option surfaces "Continue with {Provider}" buttons for the providers configured in your Better Auth `socialProviders`:
  - `false` (default) — no social buttons.
  - `true` — a button for every configured provider.
  - `string[]` — an allowlist of provider ids (intersected with what's configured).

  Providers are detected **server-side** from the Better Auth instance's resolved `socialProviders` — the same authoritative approach as the other `admin.login` methods, with no endpoint probing. Clicking a button calls Better Auth's core `signIn.social(...)`; on success it returns to the **login page** so the existing session check + role gate run uniformly (a user who lacks the required role lands on Access Denied, not `/admin`). A new `admin.login.socialCallbackURL` overrides the success destination; sign-in errors always return to the login page and are surfaced inline. There is intentionally no `'auto'` mode — social is opt-in.

  > **Account creation:** a social button on a public admin login lets anyone with that provider account create a (non-admin) user row — the role gate blocks admin *access*, but the row (and any creation hooks) is still created. Set Better Auth's `disableImplicitSignUp` (per-provider or global) if you don't want open sign-up. This is why `enableSocial` defaults to `false`. ([#21](https://github.com/delmaredigital/payload-better-auth/issues/21))

### Internal

- **`LoginView` decomposed into focused, independently-tested components** (`src/components/login/`: `AuthCard`, `AuthField`, `AuthButton`, `AuthBanner`, `OrDivider`, `OtpInput`, plus the per-screen forms). No change to the public `LoginView` API or its rendered output. Added a jsdom + React Testing Library component-test suite alongside a behavior characterization safety net; the test suite now stands at 197 tests.

## [0.7.7] - 2026-06-23

### Fixed

- **Login-method auto-detection now resolves server-side instead of probing endpoints.** The `'auto'` mode for `enablePassword`, `enableMagicLink`, `enableEmailOtp`, `enablePasskey`, `enableSignUp`, and `enableForgotPassword` previously probed `OPTIONS /sign-in/*` from the client and treated any non-404 as "enabled". Better Auth answers **every** `OPTIONS` request with `200` (CORS preflight), so detection always reported *enabled* — surfacing magic-link / email-OTP buttons even when those plugins weren't installed, never hiding the password field when `emailAndPassword.enabled: false`, and over-showing the sign-up / forgot-password links. `LoginViewWrapper` (a server component) now reads the Better Auth instance's resolved `options` and passes concrete booleans to `LoginView`:
  - `enablePassword` ← `emailAndPassword.enabled`
  - `enableSignUp` ← `emailAndPassword.enabled && !disableSignUp`
  - `enableForgotPassword` ← `emailAndPassword.enabled && sendResetPassword` configured
  - `enablePasskey` / `enableMagicLink` / `enableEmailOtp` ← the `passkey()` / `magicLink()` / `emailOTP()` plugin being registered

  Explicit `true` / `false` config still takes precedence. The client-side `OPTIONS` probes were removed; for standalone `<LoginView>` use (without the plugin wrapper), an unresolved `'auto'` now falls back to safe defaults — password shown, optional methods hidden. Thanks to [@Tasztalos69](https://github.com/Tasztalos69) for the precise report ([#20](https://github.com/delmaredigital/payload-better-auth/issues/20)).

## [0.7.6] - 2026-06-12

### Changed

- **Better Auth dev dependencies bumped 1.6.17 → 1.6.18** (`better-auth`, `@better-auth/api-key`, `@better-auth/oauth-provider`, `@better-auth/passkey`). Patch-level; the peer floor remains `>=1.6.0`, so consumers are unaffected. Upstream is bug fixes and security hardening only.

### Fixed

- **`createPayloadAuthClient()` declaration build under Better Auth 1.6.18.** 1.6.18's base client type added a `refreshToken` method; because `payloadAuthPlugins` is intentionally widened to `BetterAuthClientPlugin[]` for `.d.ts` portability, the inferred return type dropped `refreshToken` and broke `tsc --emitDeclarationOnly`. The return is now cast back to the stable `PayloadAuthClient` type — the runtime client is unchanged and still exposes `refreshToken`.

### Documentation

- Documented passwordless admin login (magic-link & email-OTP). Added a "Passwordless Sign-In" section to the docs site, refreshed the stale version badge (was v0.7.4), and noted the new login options in the README. (The feature itself shipped in 0.7.5.)

## [0.7.5] - 2026-06-12

### Added

- **Magic-link and email-OTP sign-in in the admin `LoginView`.** The generated login view now surfaces "Email me a link" (magic-link) and "Email me a code" (email-OTP) options, auto-detected when the Better Auth `magicLink()` / `emailOTP()` plugins are configured. Server-side plugin wiring and email delivery remain the integrator's responsibility. New `admin.login` options (each `boolean | 'auto'`, default `'auto'`): `enableMagicLink`, `enableEmailOtp`, plus `magicLinkCallbackURL`.
- **Passwordless-only login.** New `admin.login.enablePassword` option (`boolean | 'auto'`, default `'auto'`) hides the password field when the email/password strategy is disabled (`emailAndPassword.enabled: false`), promoting a passwordless method to the primary sign-in action. Resolves [#20](https://github.com/delmaredigital/payload-better-auth/issues/20).

### Changed

- **Better Auth bumped 1.6.14 → 1.6.17** (dev dependencies `better-auth`, `@better-auth/api-key`, `@better-auth/passkey`, `@better-auth/oauth-provider`). Patch-level upgrade — no breaking changes and no adapter code changes required; the adapter's `updateMany` already returns affected-row counts per the 1.6.17 adapter contract, and the new optional `incrementOne` method falls back transparently. Peer floor remains `>=1.6.0`. Upstream is predominantly security hardening (atomic single-use tokens/counters, OAuth/SSO provider identity validation, rate-limit correctness).

## [0.7.4] - 2026-06-03

### Fixed

- **Disabling two-factor authentication from the admin no longer fails with "Invalid password".** `TwoFactorManagementClient` was calling `client.twoFactor.disable({ password: '' })` with a hardcoded empty string, so Better Auth's `/two-factor/disable` rejected the request with a `400 INVALID_PASSWORD` before the real password was ever checked. The disable flow now prompts for the account password (mirroring the enable flow) and submits it. Enabling 2FA was unaffected.

## [0.7.3] - 2026-05-16

### Changed

- **Payload bumped 3.83.0 → 3.84.1.** Patch-level upgrade — no breaking changes and no adapter/plugin code changes required. Dev dependency versions updated for `payload`, `@payloadcms/next`, and `@payloadcms/ui`. All tests pass against the new version.

## [0.7.2] - 2026-05-16

### Security

- **Raised minimum `next` peer dependency to `>=15.5.16`** to mitigate [CVE-2026-44574](https://github.com/vercel/next.js/security/advisories/GHSA-492v-c6pp-mqqv) — a high-severity middleware/proxy bypass via dynamic route parameter injection affecting Next.js `15.4.0–15.5.15` and `16.0.0–16.2.4`. Fixed upstream in `15.5.16` and `16.2.5`. Dev dependency bumped `next` `16.2.4 → ^16.2.5` (resolves to `16.2.6`). This library doesn't ship middleware, but consumers using `betterAuthStrategy()` for route protection on vulnerable Next.js versions are exposed.

## [0.7.1] - 2026-05-11

### Changed

- **Better Auth bumped 1.6.6 → 1.6.10.** Patch-level upgrade — no breaking changes and no adapter/plugin code changes required. Dev/peer dependency versions updated for `better-auth`, `@better-auth/api-key`, `@better-auth/oauth-provider`, and `@better-auth/passkey`. Consumer-facing fixes inherited from upstream:
  - **OAuth provider:** generated schemas now include FK indexes on referenced fields — consumers running the `@better-auth/oauth-provider` plugin should generate a fresh Payload migration to capture them.
  - **Stripe plugin:** subscription lifecycle hooks (`onSubscriptionUpdate`, `onSubscriptionCancel`, `onTrialEnd`, `onTrialExpired`) now receive the post-update subscription row instead of a stale snapshot.
  - **Auth flows:** duplicate `Set-Cookie` headers removed from social sign-in and magic-link redirects; `useSession` now revalidates after admin impersonation toggles; `callbackURL` honored on `signIn.username`; OAuth provider `prompt=login` is now correctly enforced after consent continuation.
  - **OAuth:** `mapProfileToUser` fallback fixed for providers that omit `email`; OAuth callbacks no longer link accounts under an `undefined` provider account ID.
  - **Organization plugin:** `cancelPendingInvitationsOnReInvite` now functions; dynamic access control roles accepted in invitations; `useActiveMemberRole` no longer retains a stale role after sign-out; `setActiveTeam` validates team membership against the active organization.
  - **Misc:** `additionalFields` TS2742 type error in the organization plugin resolved; SAML2 `/sso/saml2/sp/metadata` works with `defaultSSO`; passkey autofill returns a handled cancellation instead of an unhandled error.

## [0.7.0] - 2026-04-21

### Breaking

- **Better Auth 1.5 → 1.6 upgrade.** Peer dependency requirements raised accordingly. Consumers must upgrade `better-auth`, `@better-auth/api-key`, and `@better-auth/passkey` to `>=1.6.0`. Upstream breaking changes surfaced in this release:
  - **`twoFactor` table: new `verified` column.** Better Auth 1.6.2 added a `verified` boolean field (default `true`) to the `twoFactor` schema to prevent unverified TOTP enrollment from blocking sign-in. Consumers using the `twoFactor` plugin **must run a Payload schema migration** to add the column. Existing rows do not need backfill — the column defaults to `true`.
  - **`session.freshAge` calculation changed.** Better Auth 1.6.0 now computes `freshAge` from `session.createdAt` instead of `updatedAt`. To disable the check entirely, set `session: { freshAge: 0 }`. Not used internally by this library, but consumers relying on the prior behavior should review their `freshAge` config.
- **Client exports widened for declaration-emit portability.** Better Auth 1.6's zod v4 adoption made the inferred plugin/client types non-portable under `tsc --emitDeclarationOnly`. To restore a stable public API surface:
  - `payloadAuthPlugins` is now typed as `BetterAuthClientPlugin[]` (was an `as const` tuple).
  - `createPayloadAuthClient()` return type is now `PayloadAuthClient = ReturnType<typeof createAuthClient>`.
  - **Consumer impact:** the returned client no longer narrows to expose plugin-specific methods (e.g. `client.twoFactor.verifyTotp`) via this helper. Consumers who need typed plugin methods should call `createAuthClient` directly with `twoFactorClient()` passed explicitly, e.g. `createAuthClient({ plugins: [twoFactorClient()] })`.
- **Schema type exports migrated from `oidcProvider` → `@better-auth/oauth-provider`.** The type-generation script now uses the actively maintained plugin since `oidcProvider` is deprecated in Better Auth 1.6 and will be removed in the next major. This changes the shape of OAuth-related generated types:
  - `OauthApplication` type **removed**. Replaced by `OauthClient` with a substantially different field set (adds `scopes`, `redirectUris` array, `postLogoutRedirectUris`, `tokenEndpointAuthMethod`, `grantTypes`, `responseTypes`, `public`, `requirePKCE`, `referenceId`, `contacts`, `tos`, `policy`, `softwareId`/`Version`/`Statement`, etc.; drops `redirectUrls` singular, `metadata` becomes `unknown`).
  - **New** `OauthRefreshToken` type — refresh tokens now live in their own model with `token`, `clientId`, `sessionId`, `referenceId`, `authTime`, `scopes` fields.
  - `OauthAccessToken` fields changed: `accessToken`/`refreshToken` → `token`/`refreshId`, added `sessionId`/`referenceId`, `scopes` is now `string[]` (was `string`).
  - `OauthConsent` fields changed: removed `consentGiven`, added `referenceId`, `scopes` is now `string[]`.
  - `PluginId` string union: `"oidc-provider"` → `"oauth-provider"`.
  - `ModelKey`: `"oauthApplication"` removed; `"oauthClient"` and `"oauthRefreshToken"` added.
  - **Consumer impact:** consumers still using `oidcProvider()` at runtime will continue to function (the runtime collection generator reads from `getAuthTables()` and reflects whichever plugin is configured), but the statically generated types now reflect `oauth-provider`'s schema. Consumers narrowing on `PluginId`/`ModelKey` or importing `OauthApplication` must update to the new names. Recommended: migrate to `@better-auth/oauth-provider` and run the corresponding Payload schema migration.

### Changed

- **Dependency bumps.** `@payloadcms/next` and `@payloadcms/ui` 3.78 → 3.83, `next` 16.1.6 → 16.2.4, `react` 19.2.4 → 19.2.5, plus minor bumps to `@swc/core`/`@swc/cli`, `@types/node`.
- **Generated types regenerated against Better Auth 1.6.6 schema.** `TwoFactorFields.verified?: boolean` added.

### Fixed

- **`tsc --emitDeclarationOnly` build no longer fails with TS2742 / TS7056.** Better Auth 1.6 moved to zod v4 internally, which caused the previously inferred types of `payloadAuthPlugins` and `createPayloadAuthClient` to reference `.pnpm/zod@.../v4/core` — a non-portable path that broke declaration emission. Resolved via the explicit type annotations described above under Breaking.

### Added

- **`@better-auth/oauth-provider`** as a devDependency for type generation. Not a runtime dependency — it is only imported by `src/scripts/generate-types.ts` to produce accurate schema types.

### Known Issues

- **Pre-existing test failure in `tests/adapter/adapter.test.ts`** (`should default to number ID type without warning when generateId is undefined`) — this test was already failing on v0.6.10 and is not introduced by this release. The adapter warns whenever `idType === 'number'` and `generateId !== 'serial'`; the test's comment asserts that `disableIdGeneration: true` should suppress the warning, but the implementation doesn't gate on that. Tracking separately.

## [0.6.10] - 2026-04-16

### Fixed

- **Respect Payload's custom `routes.admin` and `routes.api` config** — Admin UI components previously hardcoded `/admin/*` and `/api/*` paths, breaking projects that customize Payload's route config. All admin components (`LoginView`, `LogoutButton`, `ForgotPasswordView`, `ResetPasswordView`, `BeforeLogin`, `TwoFactorVerifyView`, `TwoFactorSetupView`, `SecurityNavLinks`) now read route prefixes from `useConfig()` and apply them to fetch calls and navigation. Defaults fall through to Payload's standard `/admin` / `/api` so existing consumers are unaffected. Thanks to @luochuanyuewu for [#17](https://github.com/delmaredigital/payload-better-auth/pull/17) which seeded this fix.

## [0.6.9] - 2026-03-24

### Removed

- **Opaque OAuth access token DB lookup** — Removed the direct database lookup for opaque tokens added in v0.6.8. Per Better Auth docs: "only accept JWT-formatted access tokens for your API." OAuth integrations should ensure all tokens (including refreshed ones) are JWTs by sending the `resource` parameter on both initial and refresh token exchanges. The opaque DB lookup bypassed Better Auth's validation logic and is not the recommended approach.

## [0.6.8] - 2026-03-24

### Added (reverted in v0.6.9)

- **Opaque OAuth access token verification** — Direct DB lookup for opaque tokens. Reverted — not aligned with Better Auth best practices.

## [0.6.7] - 2026-03-20

### Fixed

- **Non-PK reference fields no longer create Payload relationships** — Better Auth's `oauthRefreshToken.clientId` and `oauthAccessToken.clientId` reference `oauthClient.clientId` (a non-PK field), not `oauthClient.id`. Payload relationships always FK to `id`, causing constraint violations. These fields are now created as plain text columns when the reference target is not `id`. The adapter factory's `fieldName` stripping (removing `Id` suffix) is also skipped for non-PK references, preserving the original column name. This eliminates the need for the `id = clientId` workaround when registering OAuth clients.

## [0.6.6] - 2026-03-20

### Fixed

- **OAuth JWT verification issuer/audience mismatch** — The `verifyAccessToken` call used `baseURL` for both `issuer` and `audience`, but the JWT issuer includes the auth base path (e.g., `https://example.com/api/auth`) while the audience is the app URL (e.g., `https://example.com`). Now correctly sets `issuer = baseURL + basePath` and `audience = baseURL`.

## [0.6.4] - 2026-03-19

### Fixed

- **Double-s pluralization for models ending in 's'** — Better Auth's `getModelName` factory appends `s` unconditionally, causing model names like `jwks` to become `jwkss`. The adapter's `getCollection()` now normalizes double-s suffixes. This fixes collection lookup failures when using the `jwt()` or any plugin with model names ending in `s`. Upstream issues: [#3069](https://github.com/better-auth/better-auth/issues/3069), [#2659](https://github.com/better-auth/better-auth/issues/2659). This fix is safe and becomes a no-op when upstream is fixed.

## [0.6.3] - 2026-03-19

### Added

- **OAuth JWT access token verification** — The `betterAuthStrategy` now verifies OAuth 2.1 JWT access tokens via JWKS when session cookie auth returns no result. When a `Bearer` token is not a session cookie or API key, the strategy attempts JWT verification using Better Auth's `verifyAccessToken` utility, fetching the signing keys from the `/api/auth/jwks` endpoint. On success, it extracts the user ID (`sub`), scopes, and organization context from JWT claims, enabling OAuth integrations (Zapier, third-party apps) to authenticate Payload REST API requests with access tokens. The `oauthScopes` array is available on `req.user` for scope-based access control.

## [0.6.2] - 2026-03-16

### Fixed

- **nextCookies() incompatibility warning** — Added runtime detection of Better Auth's `nextCookies()` plugin, which causes infinite form-state submissions and input resets in the Payload admin panel. The plugin hooks into every `getSession()` call and writes cookies via `next/headers`, conflicting with Payload's rendering cycle. A clear console warning now alerts users to remove it. The `nextCookies()` plugin is unnecessary with this adapter since the endpoint handler already proxies `Set-Cookie` headers naturally. ([#15](https://github.com/delmaredigital/payload-better-auth/issues/15))

## [0.6.1] - 2026-03-15

### Added

#### Organization-scoped API keys

API keys can now be bound to a specific organization at creation time. When `enableSessionForAPIKeys` is enabled in Better Auth, the `betterAuthStrategy` will automatically resolve the organization context from the key's metadata, enabling org-scoped access control to work with API key authentication.

**How it works:**
- When creating an API key, pass `organizationId` in the request body
- The plugin validates the user is a member of that org, then stores `organizationId` in the key's metadata
- On authentication, if the mock session doesn't have `activeOrganizationId`, the strategy reads it from the key's metadata and verifies membership
- `req.user.activeOrganizationId` and `req.user.organizationRole` are set identically to a normal session

**Usage:**
```ts
// Create an org-scoped API key
const key = await auth.api.createApiKey({
  body: {
    name: 'My API Key',
    organizationId: 'org_123',  // NEW — binds key to this org
    permissions: { clients: ['read'], invoices: ['read', 'write'] },
  },
})

// Authenticate via API key — org context is automatic
curl -H "x-api-key: sk_..." https://app.example.com/api/clients
// req.user.activeOrganizationId === 'org_123'
// req.user.organizationRole === 'owner' (or whatever their role is)
```

**Management UI:** When the organization plugin is detected, the API key creation form shows an organization selector dropdown. Existing keys display their org binding as a badge.

**Backwards compatible:** Keys without `organizationId` metadata continue to work as before.

## [0.6.0] - 2026-03-06

### Breaking Changes

#### API key permissions redesigned — scopes replaced with BA-native permissions

The custom scope system (`requireScope`, `hasScope`, `scopesToPermissions`, etc.) has been replaced with thin wrappers around Better Auth's native `verifyApiKey()` permission system. This is simpler, more robust, and eliminates the round-trip bug where compound scope names were lost during storage.

**Permission model:** Two actions per collection — `read` and `write` (previously read/write/delete).

**Before (0.5.x):**
```ts
import { requireScope, requireAllScopes, allowSessionOrScope } from '@delmaredigital/payload-better-auth'

access: {
  read: requireScope('posts:read'),
  create: requireScope('posts:write'),
  delete: requireAllScopes(['posts:delete', 'admin:write']),
}

read: allowSessionOrScope('posts:read')
```

**After (0.6.0):**
```ts
import { requirePermission, requireAllPermissions, allowSessionOrPermission } from '@delmaredigital/payload-better-auth'

access: {
  read: requirePermission('posts', 'read'),
  create: requirePermission('posts', 'write'),
  update: requirePermission('posts', 'write'),
  delete: requirePermission('posts', 'write'),
}

read: allowSessionOrPermission('posts', 'read')
```

| Removed | Replacement |
|---------|-------------|
| `requireScope(scope)` | `requirePermission(resource, action)` |
| `requireAnyScope(scopes)` | `requireAnyPermission(permissions)` |
| `requireAllScopes(scopes)` | `requireAllPermissions(permissions)` |
| `allowSessionOrScope(scope)` | `allowSessionOrPermission(resource, action)` |
| `allowSessionOrAnyScope(scopes)` | `allowSessionOrAnyPermission(permissions)` |
| `hasScope()`, `hasAnyScope()`, `hasAllScopes()` | Use `requirePermission` (BA verifies natively) |
| `validateApiKey(req)` | `requirePermission` or BA's `verifyApiKey` directly |
| `getApiKeyInfo()` | Removed — BA handles key lookup |
| `scopesToPermissions()` | Removed — pass permissions directly |
| `generateScopesFromCollections()` | `generateCollectionPermissions()` |
| `getApiKeyScopesConfig()` | `getApiKeyPermissionsConfig()` |
| `ScopeDefinition` type | `PermissionDefinition` type |
| `ApiKeyScopesConfig` type | `ApiKeyPermissionsConfig` type |
| `AvailableScope` type | Removed |

#### Config property renamed

```ts
// Before
admin: { apiKey: { scopes: {...}, defaultScopes: [...] } }

// After
admin: { apiKey: { excludeCollections: [...], requiredRole: 'admin' } }
```

Permissions are now auto-generated from collections. Custom scope definitions are no longer needed — use BA's native permission format directly.

### Added

- `requirePermission(resource, action)` — thin wrapper around BA's `verifyApiKey()`
- `requireAnyPermission(permissions)` — any of the permission pairs must match
- `requireAllPermissions(permissions)` — all permission pairs must match
- `allowSessionOrPermission(resource, action)` — session OR API key access
- `allowSessionOrAnyPermission(permissions)` — session OR any matching API key
- `requireApiKey()` — verify API key without checking specific permissions
- `generateCollectionPermissions()` — generates permission definitions for admin UI
- `getApiKeyPermissionsConfig()` — access stored permissions config

### Fixed

- **API key scope round-trip bug**: Compound scope names (e.g., `posts:write`) were decomposed into CRUD actions for storage, then lost during readback. Now uses BA's native permission format — what gets stored is what gets checked.
- **API key list endpoint unguarded**: GET `/api-key/list` now requires admin role (previously only POST mutations were guarded).

### Removed

- All scope-related functions and types (see migration table above)
- `generateScopes.ts` — replaced by `generatePermissions.ts`
- `metadata.scopes` workaround — no longer needed
- "Delete" as a separate permission level — write implies full CRUD

### Backward Compatibility

Existing API keys with old CRUD permissions (`create`, `update`, `delete`) will still work. When `requirePermission('posts', 'write')` is checked, the system falls back to checking for old CRUD actions. Re-creating keys is recommended.

## [0.5.6] - 2026-03-05

### Fixed

- **Turbopack compatibility**: Removed `/* webpackIgnore: true */` from dynamic imports in `LoginView`, `PasskeySignInButton`, `PasskeyRegisterButton`, `PasskeysManagementClient`, and `ApiKeysManagementClient`. The directive caused bare specifier imports to fail in the browser under Turbopack (Next.js 15 default dev server), silently breaking login and passkey flows. ([#14](https://github.com/delmaredigital/payload-better-auth/issues/14))

- **Improved `generateId: 'serial'` warning**: The adapter now warns when `idType` resolves to `'number'` (Postgres default) but `generateId: 'serial'` is not set. Previously only warned for explicit non-serial values, missing the most common misconfiguration where `generateId` is simply omitted. ([#14](https://github.com/delmaredigital/payload-better-auth/issues/14))

### Removed

- **Stale docs**: Removed references to `idFieldsAllowlist` and `idFieldsBlocklist` adapter options from documentation. These were removed in the 0.5.x factory refactor but lingered in the docs.

## [0.5.4] - 2026-03-02

Upgrades to Better Auth 1.5. If upgrading from 0.4.x, review the breaking changes and migration steps below.

### Breaking Changes

#### Requires Better Auth 1.5

```bash
pnpm add better-auth@latest
```

---

#### Client plugins are now opt-in

`payloadAuthPlugins` now only includes `twoFactorClient()` from the core `better-auth` package. Optional plugins (`passkeyClient`, `apiKeyClient`, etc.) must be added explicitly.

**Before:**
```ts
import { createPayloadAuthClient } from '@delmaredigital/payload-better-auth/client'
export const authClient = createPayloadAuthClient()
// passkey + apiKey were included automatically
```

**After:**
```ts
import { createAuthClient, payloadAuthPlugins } from '@delmaredigital/payload-better-auth/client'
import { passkeyClient } from '@better-auth/passkey/client'  // if using passkeys

export const authClient = createAuthClient({
  plugins: [...payloadAuthPlugins, passkeyClient()],
})
```

Add only what you use. `createPayloadAuthClient()` still works for minimal setups (email/password + 2FA only). The built-in admin UI components handle their own client creation internally.

---

#### Passkey and API key components moved to separate entry points

Components that depend on optional peer dependencies (`@better-auth/passkey`, `@better-auth/api-key`) now live in their own entry points instead of the main barrels. This prevents webpack build failures for consumers who don't have those packages installed.

```ts
// Passkey components (requires @better-auth/passkey)
import { PasskeySignInButton, PasskeyRegisterButton, PasskeysField, PasskeysManagementClient }
  from '@delmaredigital/payload-better-auth/components/passkey'

// API key components (requires @better-auth/api-key)
import { ApiKeysManagementClient }
  from '@delmaredigital/payload-better-auth/components/api-key'
```

The built-in admin UI (management views, sidebar nav, user document fields) auto-injects these internally — **no consumer changes needed** for the admin panel.

---

#### API key plugin extracted to `@better-auth/api-key`

Better Auth 1.5 moved the API key plugin to its own package.

```bash
pnpm add @better-auth/api-key
```

```ts
// Server — before                              // Server — after
import { apiKey } from 'better-auth/plugins'    import { apiKey } from '@better-auth/api-key'

// Client — before                                    // Client — after
import { apiKeyClient } from 'better-auth/client/plugins'    import { apiKeyClient } from '@better-auth/api-key/client'
```

---

#### `apiKeyWithDefaults()` removed

```ts
// Before
import { apiKeyWithDefaults } from '@delmaredigital/payload-better-auth'
plugins: [apiKeyWithDefaults()]

// After
import { apiKey } from '@better-auth/api-key'
plugins: [apiKey({ enableMetadata: true })]
```

---

#### API key schema: `userId` → `referenceId`

Better Auth 1.5 renamed the `userId` column to `referenceId` and added `configId`. If you use API keys, generate a Payload migration:

```bash
pnpm payload migrate:create
```

**UP migration choices:**
- `+ config_id` — new column, create it
- `~ user_id → reference_id` — rename (not drop + create)

**DOWN migration choices:**
- `~ reference_id → user_id` — rename back

```bash
pnpm payload migrate
```

Any code referencing `apiKey.userId` must change to `apiKey.referenceId`. A new `referenceType: 'user' | 'organization'` field is also available.

---

#### `Adapter` type → `DBAdapter`

```ts
// Before
import type { Adapter } from '@delmaredigital/payload-better-auth/adapter'
// After
import type { DBAdapter } from '@delmaredigital/payload-better-auth/adapter'
```

---

#### `idFieldsAllowlist` / `idFieldsBlocklist` config removed

The adapter now uses Better Auth's factory transforms via schema introspection. These manual config options are no longer needed.

---

#### Auth instance type invariance

If you store the auth instance with a typed return, widen it:

```ts
// Before — breaks in 1.5
let auth: ReturnType<typeof betterAuth>

// After
import type { Auth } from 'better-auth/types'
let auth: Auth<any>
```

The plugin's `CreateAuthFunction` return type has been widened accordingly.

### Changed

#### Adapter refactored to use factory transforms

Field name transforms (`userId` ↔ `user`) and ID type coercion now use Better Auth's `createAdapterFactory` via schema `fieldName` mutation. Removes ~150 lines of manual transform code and automatically supports all current and future plugins.

#### `BetterAuthReturn` type simplified

Replaced with `Auth<O>` from `better-auth/types`.

#### Dynamic `baseURL` support

`withBetterAuthDefaults()` now handles Better Auth 1.5's object-form `baseURL` (with `fallback`, `allowedHosts`, `protocol` properties) in addition to string URLs.

### Fixed

#### API key list response shape

Fixed the API keys management UI to handle Better Auth 1.5's new response format (`{ apiKeys: [...] }` instead of a plain array).

## [0.4.4] - 2026-02-25

### Fixed

#### Date fields returned as strings instead of Date objects

The adapter's factory config declared `supportsDates: true`, which tells Better Auth's adapter factory that the database returns native `Date` objects. However, Payload's Local API returns dates as ISO strings. This caused date comparisons like `session.expiresAt > new Date()` to silently fail (string vs Date comparison returns `false` due to `NaN` coercion), breaking any Better Auth plugin that compares dates — most notably the **multi-session plugin**, where `list-device-sessions` always returned an empty array.

Changed `supportsDates` to `false` so the factory correctly converts ISO strings to `Date` objects on output, and `Date` objects to ISO strings on input. This is safe across all database types: MongoDB (which may return native Dates that pass through unchanged) and Postgres/SQLite (which return strings that get converted).

## [0.4.3] - 2026-02-23

### Added

#### MongoDB Support

The adapter now auto-detects MongoDB and configures itself accordingly. No special adapter configuration needed — just use Payload's `@payloadcms/db-mongodb` adapter and everything works.

- **Auto-detection**: Reads `payload.db.name` to determine database type (`postgres`, `mongodb`, or `sqlite`)
- **ID type**: Automatically uses `'text'` (ObjectId strings) for MongoDB, `'number'` (SERIAL) for Postgres/SQLite
- **Database-aware operators**: `starts_with` and `ends_with` use `contains` on MongoDB (SQL `LIKE` patterns aren't supported)
- **`not_in` operator**: Added support for the `not_in` where clause operator
- **New `dbType` config option**: Explicit override if auto-detection doesn't work for your adapter

New exported utilities: `detectDbType()`, `resolveIdType()`, and the `DbType` type.

### Changed

#### 2FA and Passkeys moved to user document

Two-Factor Authentication and Passkeys management UI are now embedded directly in the user document edit view as `ui` fields, rather than living as separate admin views in the sidebar. These are per-user security settings (like password) and belong on the user document.

API Keys management remains in the sidebar under the "Security" nav group, as it is an admin-level feature.

### Fixed

#### 2FA and Passkey fields now scoped to the viewed user

The Two-Factor Authentication and Passkeys management UI fields on user documents were displaying the logged-in admin's own data when viewing another user's document. Both fields now compare the document ID with the logged-in user's ID and show an informational message when viewing someone else's profile.

### Security

#### API key endpoints now require admin role

API key mutation endpoints (`/api-key/create`, `/api-key/update`, `/api-key/delete`) now require the user to have an admin role before the request is forwarded to Better Auth. The required role defaults to `admin.login.requiredRole` (or `'admin'` if unset), and can be overridden:

```ts
createBetterAuthPlugin({
  admin: {
    apiKey: {
      requiredRole: 'admin', // only admins can manage API keys
      // requiredRole: null, // disable guard (not recommended)
    },
  },
})
```

API key **verification** is unaffected — existing keys continue to work. This only restricts key management (create, update, delete).

## [0.4.0] - 2026-02-17

### Breaking Changes

#### `@better-auth/passkey` moved to peer dependency

`@better-auth/passkey` is no longer bundled as a direct dependency. If you use passkeys, you must install it yourself:

```bash
pnpm add @better-auth/passkey
```

This gives you direct control over the passkey package version, which is important for receiving upstream bug fixes (e.g., the [passkey challenge expiration fix](https://github.com/better-auth/better-auth/pull/7731)) without waiting for a new release of this package.

**Migration:** If you already have `@better-auth/passkey` in your `package.json` (most passkey users do), no action is needed. If you were relying on this package to provide it, add it to your dependencies.

### Changed

#### Native admin sidebar navigation

Security management links (Two-Factor Auth, API Keys, Passkeys) now use Payload's native `NavGroup` component and `nav__link` CSS classes instead of custom-styled inline elements with emoji icons. The links now match the look and feel of Payload's built-in Collections and Globals navigation groups.

## [0.3.14] - 2026-02-10

### Fixed

#### Session ID Coercion for Serial IDs

Better Auth's `api.getSession()` always returns string IDs, even when the database uses numeric serial IDs. This caused Payload relationship fields to reject values like `"31207"` when they expect `31207`.

**`createSessionHelpers`** now accepts an `idType` option that mirrors the adapter's `adapterConfig.idType`. When set to `'number'`, all ID fields (`id`, `userId`, `activeOrganizationId`, etc.) on both the user and session objects are coerced from strings to numbers before returning.

```ts
import { createSessionHelpers } from '@delmaredigital/payload-better-auth'
import type { User } from '@/payload-types'

export const { getServerSession, getServerUser } = createSessionHelpers<User>({
  idType: 'number',
})

// session.user.id is now 31207 (number), not "31207" (string)
```

The standalone `getServerSession<TUser>()` and `getServerUser<TUser>()` functions are unaffected — coercion is opt-in through the factory only.

#### Strategy Session Field ID Coercion

`betterAuthStrategy` now coerces string IDs in session fields (e.g., `activeOrganizationId`, `impersonatedBy`) to numbers before merging them onto `req.user`. Previously, `req.user.id` was already correct (fetched from Payload's DB), but session fields from Better Auth were still strings.

The new `idType` option defaults to `'number'` to match the adapter's default:

```ts
betterAuthStrategy({
  idType: 'number', // default — coerces session field IDs to numbers
})
```

Set to `'text'` if using UUID IDs.

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
