/**
 * Better Auth 1.7.3 silently reverted account.issuer and its unique index; the
 * generated consumer schema changed without a change to this package.
 * Two version-free snapshots cover the default and full-plugin schemas; a
 * separate third test records the installed Better Auth version, so failures
 * distinguish a version-only bump from a change to the schema consumers get.
 * Review the diff and document any migration impact in CHANGELOG, then run
 * `pnpm vitest run -u tests/collections/schemaSnapshot.test.ts` — never update blindly.
 */

import { apiKey } from '@better-auth/api-key'
import { oauthProvider } from '@better-auth/oauth-provider'
import { passkey } from '@better-auth/passkey'
import {
  admin,
  anonymous,
  bearer,
  emailOTP,
  genericOAuth,
  jwt,
  magicLink,
  multiSession,
  oneTap,
  oneTimeToken,
  openAPI,
  organization,
  phoneNumber,
  twoFactor,
  username,
} from 'better-auth/plugins'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { CollectionConfig, Config } from 'payload'
import { betterAuthCollections } from '../../src/adapter/collections.js'

const require = createRequire(import.meta.url)
// The manifest is not exported, and the entry point may move within the package.
function getBetterAuthVersion(): string {
  let directory = dirname(require.resolve('better-auth'))
  while (true) {
    const manifestPath = resolve(directory, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = require(manifestPath)
      if (manifest.name === 'better-auth' && typeof manifest.version === 'string') {
        return manifest.version
      }
    }
    const parent = dirname(directory)
    if (parent === directory) throw new Error('Could not find the better-auth package manifest')
    directory = parent
  }
}

const fieldKeys = ['name', 'type', 'required', 'unique', 'index', 'hasMany', 'relationTo', 'defaultValue'] as const

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([key, item]) => [key, sortKeys(item)])
    )
  }
  return value
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function schemaSnapshot(options: Parameters<typeof betterAuthCollections>[0] = {}): string {
  const config = betterAuthCollections(options)({ collections: [] } as unknown as Config) as Config
  const collections = (config.collections ?? []).map((collection: CollectionConfig) => ({
    slug: collection.slug,
    fields: collection.fields.map((field) => Object.fromEntries(
      fieldKeys.filter((key) => key in field && (
        key !== 'defaultValue' || ['string', 'number', 'boolean'].includes(typeof Reflect.get(field, key))
      )).map((key) => {
        const value = Reflect.get(field, key)
        return [key, Array.isArray(value) ? [...value].sort() : value]
      })
    )).sort((a, b) => compare(String(a.name), String(b.name))),
    ...(collection.indexes && {
      // Index order is immaterial, but field order within a compound index is
      // significant to the database and must remain visible in the snapshot.
      indexes: collection.indexes.map((index) => sortKeys(index))
        .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
    }),
  })).sort((a, b) => compare(a.slug, b.slug))

  return JSON.stringify(sortKeys({ collections }), null, 2) + '\n'
}

describe('generated Better Auth schema', () => {
  it('records the Better Auth version it was generated against', async () => {
    await expect(getBetterAuthVersion() + '\n').toMatchFileSnapshot('__snapshots__/better-auth-version.txt')
  })

  it('matches the default collections', async () => {
    await expect(schemaSnapshot()).toMatchFileSnapshot('__snapshots__/schema-defaults.json')
  })

  it('matches all plugins covered by generated-types', async () => {
    await expect(schemaSnapshot({
      // Include user fields as well as plugin tables, matching generate-types.ts.
      skipCollections: [],
      betterAuthOptions: {
        emailAndPassword: { enabled: true },
        user: {
          additionalFields: {
            role: { type: 'string', defaultValue: 'user', input: false },
          },
        },
        // Keep this set and its options aligned with src/scripts/generate-types.ts.
        plugins: [
          username(),
          admin(),
          apiKey(),
          passkey(),
          bearer(),
          emailOTP({ sendVerificationOTP: async () => {} }),
          magicLink({ sendMagicLink: async () => {} }),
          phoneNumber({ sendOTP: async () => {} }),
          oneTap(),
          anonymous(),
          multiSession(),
          oneTimeToken(),
          oauthProvider({ loginPage: '', consentPage: '' }),
          genericOAuth({
            config: [{ providerId: 'generic', clientId: 'generic', clientSecret: 'generic' }],
          }),
          openAPI(),
          organization({ teams: { enabled: true } }),
          jwt(),
          twoFactor(),
        ],
      },
    })).toMatchFileSnapshot('__snapshots__/schema-plugins.json')
  })
})
