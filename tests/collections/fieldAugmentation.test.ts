import { describe, it, expect } from 'vitest'
import {
  getExistingFieldNames,
  augmentCollectionWithMissingFields,
} from '../../src/adapter/collections.js'
import type { CollectionConfig, Field } from 'payload'

describe('getExistingFieldNames (M10: recurse into presentational containers)', () => {
  it('collects top-level field names', () => {
    const fields: Field[] = [
      { name: 'email', type: 'text' },
      { name: 'role', type: 'text' },
    ]
    expect(getExistingFieldNames(fields)).toEqual(new Set(['email', 'role']))
  })

  it('finds names nested inside a row', () => {
    const fields: Field[] = [
      { type: 'row', fields: [{ name: 'email', type: 'text' }, { name: 'role', type: 'text' }] },
    ]
    const names = getExistingFieldNames(fields)
    expect(names.has('email')).toBe(true)
    expect(names.has('role')).toBe(true)
  })

  it('finds names inside an unnamed tab', () => {
    const fields: Field[] = [
      { type: 'tabs', tabs: [{ label: 'Account', fields: [{ name: 'role', type: 'text' }] }] },
    ] as unknown as Field[]
    expect(getExistingFieldNames(fields).has('role')).toBe(true)
  })

  it('finds names inside a collapsible', () => {
    const fields: Field[] = [
      { type: 'collapsible', label: 'More', fields: [{ name: 'banned', type: 'checkbox' }] },
    ] as unknown as Field[]
    expect(getExistingFieldNames(fields).has('banned')).toBe(true)
  })

  it('does NOT surface a named group\'s children as top-level (they are namespaced)', () => {
    const fields: Field[] = [
      { name: 'profile', type: 'group', fields: [{ name: 'role', type: 'text' }] },
    ]
    const names = getExistingFieldNames(fields)
    expect(names.has('profile')).toBe(true)
    expect(names.has('role')).toBe(false)
  })
})

describe('augmentCollectionWithMissingFields (M9: non-PK references stay plain fields)', () => {
  const collection: CollectionConfig = { slug: 'oauthrefreshtokens', fields: [] }

  // A table with a non-PK reference: clientId -> oauthClient.clientId (not 'id').
  const table = {
    modelName: 'oauthRefreshToken',
    fields: {
      token: { type: 'string', fieldName: 'token' },
      clientId: {
        type: 'string',
        fieldName: 'clientId',
        references: { model: 'oauthClient', field: 'clientId' },
      },
    },
  } as unknown as Parameters<typeof augmentCollectionWithMissingFields>[1]

  it('emits a non-PK reference as a plain field keeping its original name', () => {
    const result = augmentCollectionWithMissingFields(collection, table, true, 'oauthRefreshToken', false)
    const byName = Object.fromEntries(
      result.fields.filter((f): f is Extract<Field, { name: string }> => 'name' in f && !!f.name).map((f) => [f.name, f])
    )
    // Original name preserved (not stripped to 'client'), and NOT a relationship.
    expect(byName.clientId).toBeDefined()
    expect(byName.client).toBeUndefined()
    expect(byName.clientId.type).not.toBe('relationship')
  })
})
