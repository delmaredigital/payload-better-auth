import { apiKey } from '@better-auth/api-key'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { twoFactor } from 'better-auth/plugins'
import { boolean, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pg-proxy'
import { buildConfig, type BasePayload, type Config } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { betterAuthCollections, type BetterAuthCollectionsOptions } from '../../src/adapter/collections.js'
import { createPostgresAtomic, payloadTableName } from '../../src/adapter/atomic-postgres.js'

afterEach(() => vi.restoreAllMocks())

async function sanitizedCollections(customizeCollection?: BetterAuthCollectionsOptions['customizeCollection']) {
  const generated = betterAuthCollections({
    betterAuthOptions: { plugins: [twoFactor(), apiKey()] },
    firstUserAdmin: false,
    acknowledgeRoleGuardDisabled: true,
    customizeCollection,
  })({ collections: [{ slug: 'users', auth: true, fields: [] }] } as Config) as Config
  const slugs = generated.collections!.filter(collection => collection.slug !== 'users').map(collection => collection.slug)
  const sanitized = await buildConfig({
    ...generated,
    secret: 'generated-collection-sanitization-test-secret',
    telemetry: false,
    admin: { disable: true, importMap: { autoGenerate: false } },
    typescript: { autoGenerate: false },
    db: postgresAdapter({ pool: {}, idType: 'uuid', push: false }),
  })
  return sanitized.collections.filter(collection => slugs.includes(collection.slug))
}

// Inspect every nested field shape as well as Payload's flattened fields, so a
// future default hook fails here even if the atomic policy learns to ignore it.
function expectNoFieldHooks(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(expectNoFieldHooks)
  } else if (value && typeof value === 'object') {
    const field = value as Record<string, unknown>
    for (const [name, hooks] of Object.entries(field.hooks ?? {})) {
      if (name !== 'beforeDuplicate') expect(hooks, name).toEqual([])
    }
    for (const key of ['fields', 'flattenedFields', 'tabs', 'blocks']) expectNoFieldHooks(field[key])
  }
}

describe('generated collections after real Payload sanitization', () => {
  it('keeps core and plugin collections eligible for atomic Postgres writes by default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const collections = await sanitizedCollections()
    expect(collections.map(collection => collection.slug).sort()).toEqual([
      'accounts', 'apikeys', 'sessions', 'twoFactors', 'verifications',
    ])

    for (const config of collections) {
      // Payload sanitizes versions: false to undefined.
      expect(config.versions, config.slug).toBeFalsy()
      for (const [name, hooks] of Object.entries(config.hooks)) expect(hooks, `${config.slug}.${name}`).toEqual([])
      expectNoFieldHooks(config.fields)
      expectNoFieldHooks(config.flattenedFields)
      expect(config.authorship, config.slug).toEqual({ createdBy: false, updatedBy: false })
      if (config.slug === 'apikeys') {
        expect(config.flattenedFields).toContainEqual(expect.objectContaining({ name: 'requestCount', type: 'number' }))
      }

      // Real Drizzle builders with only the wire driver replaced. Build columns
      // from the sanitized schema so injected stored shapes are checked too.
      const tableName = payloadTableName(config.slug)
      const table = pgTable(tableName, {
        id: uuid('id'),
        ...Object.fromEntries(config.flattenedFields.filter(field => field.name !== 'id').map(field => {
          const column = field.type === 'number' ? numeric(field.name, { mode: 'number' })
            : field.type === 'date' ? timestamp(field.name, { mode: 'string', withTimezone: true })
            : field.type === 'checkbox' ? boolean(field.name)
            : field.type === 'relationship' ? uuid(field.name)
            : text(field.name)
          return [field.name, column]
        })),
      })
      const wire = vi.fn(async () => ({ rows: [] }))
      const payload = {
        db: { name: 'postgres', drizzle: drizzle(wire), tables: { [tableName]: table }, tableNameMap: new Map([[tableName, tableName]]) },
        collections: { [config.slug]: { config } },
      } as unknown as BasePayload
      const atomic = createPostgresAtomic()
      const args = { payload, collection: config.slug, where: [{ field: 'id', value: '00000000-0000-4000-8000-000000000001' }] }
      expect(await atomic({ ...args, consume: true }), config.slug).toBeNull()
      for (const field of config.flattenedFields.filter(field => field.type === 'number')) {
        expect(await atomic({ ...args, increment: { [field.name]: 1 } }), `${config.slug}.${field.name}`).toBeNull()
      }
      expect(wire).toHaveBeenCalled()
    }
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('lets customizeCollection turn authorship back on before Payload sanitization', async () => {
    const defaults: unknown[] = []
    const collections = await sanitizedCollections((modelKey, collection) => {
      defaults.push(collection.authorship)
      return modelKey === 'session' ? { ...collection, authorship: true } : collection
    })
    expect(defaults).toEqual(collections.map(() => false))
    const sessions = collections.find(collection => collection.slug === 'sessions')!
    expect(sessions.authorship).toMatchObject({ createdBy: {}, updatedBy: {} })
    for (const name of ['createdBy', 'updatedBy']) {
      const field = sessions.flattenedFields.find(field => field.name === name)!
      expect(field.type).toBe('relationship')
      expect(field.hooks?.beforeChange?.length).toBeGreaterThan(0)
      expect(field.hooks?.beforeValidate?.length).toBeGreaterThan(0)
    }
    for (const collection of collections.filter(collection => collection !== sessions)) {
      expect(collection.authorship).toEqual({ createdBy: false, updatedBy: false })
    }
  })
})
