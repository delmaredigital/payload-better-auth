import { describe, it, expect } from 'vitest'
import { twoFactor } from 'better-auth/plugins'
import {
  betterAuthCollections,
  defaultSecretFieldsByModel,
} from '../../src/adapter/collections.js'
import type {
  CollectionConfig,
  Config,
  Field,
  FieldAccess,
} from 'payload'

const betterAuthOptions = { plugins: [twoFactor()] }

function buildCollections(
  pluginOptions: Parameters<typeof betterAuthCollections>[0] = {},
  incoming: Config = { collections: [] } as unknown as Config
): CollectionConfig[] {
  const plugin = betterAuthCollections({
    betterAuthOptions,
    skipCollections: [],
    ...pluginOptions,
  })
  const result = plugin(incoming) as Config
  return (result.collections ?? []) as CollectionConfig[]
}

function getCollection(collections: CollectionConfig[], slug: string) {
  const collection = collections.find((c) => c.slug === slug)
  expect(collection, `collection ${slug} should exist`).toBeDefined()
  return collection as CollectionConfig
}

function getField(collection: CollectionConfig, name: string) {
  const field = collection.fields.find(
    (f): f is Extract<Field, { name: string }> => 'name' in f && f.name === name
  )
  expect(field, `field ${name} on ${collection.slug} should exist`).toBeDefined()
  return field as Extract<Field, { name: string }> & {
    access?: Record<string, FieldAccess>
    admin?: { hidden?: boolean }
  }
}

function expectLocked(collection: CollectionConfig, name: string) {
  const field = getField(collection, name)
  for (const action of ['create', 'read', 'update'] as const) {
    const fn = field.access?.[action]
    expect(typeof fn, `${collection.slug}.${name} access.${action}`).toBe('function')
    expect(fn({} as never)).toBe(false)
  }
  expect(field.admin?.hidden).toBe(true)
}

function expectUnlocked(collection: CollectionConfig, name: string) {
  const field = getField(collection, name)
  expect(field.access).toBeUndefined()
  expect(field.admin?.hidden).not.toBe(true)
}

describe('secureSecretFields (default: enabled)', () => {
  const collections = buildCollections()

  it('locks the session token', () => {
    expectLocked(getCollection(collections, 'sessions'), 'token')
  })

  it('locks the TOTP secret and backup codes', () => {
    const twoFactors = getCollection(collections, 'twoFactors')
    expectLocked(twoFactors, 'secret')
    expectLocked(twoFactors, 'backupCodes')
  })

  it('locks account credentials and provider tokens', () => {
    const accounts = getCollection(collections, 'accounts')
    for (const name of ['password', 'accessToken', 'refreshToken', 'idToken']) {
      expectLocked(accounts, name)
    }
  })

  it('locks verification identifier and value', () => {
    const verifications = getCollection(collections, 'verifications')
    expectLocked(verifications, 'identifier')
    expectLocked(verifications, 'value')
  })

  it('falls back to id for useAsTitle when the title field is locked', () => {
    // generateCollection would otherwise pick 'identifier' for verifications.
    expect(getCollection(collections, 'verifications').admin?.useAsTitle).toBe('id')
  })

  it('keeps useAsTitle for collections whose title field is not a secret', () => {
    expect(getCollection(collections, 'users').admin?.useAsTitle).toBe('name')
  })

  it('leaves non-secret fields untouched', () => {
    expectUnlocked(getCollection(collections, 'sessions'), 'expiresAt')
    expectUnlocked(getCollection(collections, 'accounts'), 'providerId')
  })
})

describe('secureSecretFields: false', () => {
  const collections = buildCollections({ secureSecretFields: false })

  it('locks nothing', () => {
    expectUnlocked(getCollection(collections, 'sessions'), 'token')
    expectUnlocked(getCollection(collections, 'twoFactors'), 'secret')
    expect(getCollection(collections, 'verifications').admin?.useAsTitle).toBe(
      'identifier'
    )
  })
})

describe('secureSecretFields: custom map', () => {
  const collections = buildCollections({
    // Unlock session entirely; defaults still apply to the other models.
    secureSecretFields: { session: [] },
  })

  it('merges over the defaults', () => {
    expectUnlocked(getCollection(collections, 'sessions'), 'token')
    expectLocked(getCollection(collections, 'twoFactors'), 'secret')
    expectLocked(getCollection(collections, 'accounts'), 'password')
  })
})

describe('secureSecretFields on augmented collections', () => {
  const existingSessions: CollectionConfig = {
    slug: 'sessions',
    fields: [
      // Consumer-defined secret-named field: must never be modified.
      { name: 'ipAddress', type: 'text' },
    ],
  }

  const collections = buildCollections(
    {},
    { collections: [existingSessions] } as unknown as Config
  )

  it('locks secret fields the augmentation adds', () => {
    expectLocked(getCollection(collections, 'sessions'), 'token')
  })

  it('never touches fields the consumer defined themselves', () => {
    expectUnlocked(getCollection(collections, 'sessions'), 'ipAddress')
  })
})

describe('defaultSecretFieldsByModel', () => {
  it('covers the core credential-bearing models', () => {
    for (const model of ['account', 'session', 'twoFactor', 'verification']) {
      expect(defaultSecretFieldsByModel[model]?.length).toBeGreaterThan(0)
    }
  })
})
