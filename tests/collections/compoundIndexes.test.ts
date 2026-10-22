/**
 * Better Auth 1.7 moved constraints that used to be implicit into the schema as
 * table-level `indexes`, and generated collections carry them through as
 * Payload compound indexes.
 *
 * 1.7.0–1.7.2 declared `account`'s unique `(issuer, accountId)` this way; 1.7.3
 * restored the 1.6 account schema (keyed on `providerId` + `accountId`, no
 * `issuer` column, no table-level index). Core tables therefore declare no
 * indexes today, so the passthrough is exercised through a plugin schema — the
 * same mechanism a core table would use.
 */

import { describe, it, expect, vi } from 'vitest'
import { betterAuthCollections } from '../../src/adapter/collections.js'
import type { Config, CollectionConfig } from 'payload'

function build(options: Parameters<typeof betterAuthCollections>[0] = {}): CollectionConfig[] {
  const plugin = betterAuthCollections(options)
  const config = plugin({ collections: [] } as unknown as Config) as Config
  return (config.collections ?? []) as CollectionConfig[]
}

function find(collections: CollectionConfig[], slug: string) {
  return collections.find((c) => c.slug === slug)
}

/** A plugin whose table declares a compound unique index, like BA 1.7.0's account did. */
function withIndexedTable(indexes: { fields: string[]; unique?: boolean }[]) {
  return {
    betterAuthOptions: {
      plugins: [
        {
          id: 'index-test',
          schema: {
            widget: {
              fields: {
                label: { type: 'string', required: true },
                code: { type: 'string', required: true },
                ownerId: { type: 'string', required: true, references: { model: 'user', field: 'id' } },
              },
              indexes,
            },
          },
        },
      ],
    } as never,
  }
}

describe('compound index passthrough', () => {
  it('accounts carry no issuer field or index on Better Auth >= 1.7.3', () => {
    const accounts = find(build(), 'accounts')
    const names = (accounts?.fields ?? []).map((f) => ('name' in f ? f.name : undefined))

    expect(accounts).toBeDefined()
    expect(names).not.toContain('issuer')
    expect(names).toEqual(expect.arrayContaining(['accountId', 'providerId', 'user']))
    expect(accounts?.indexes).toBeUndefined()
  })

  it('passes a table-level unique index through as a Payload compound index', () => {
    const widgets = find(build(withIndexedTable([{ fields: ['label', 'code'], unique: true }])), 'widgets')

    expect(widgets).toBeDefined()
    expect(widgets?.indexes).toEqual([{ fields: ['label', 'code'], unique: true }])
  })

  it('maps reference fields in an index to their relationship name', () => {
    const widgets = find(build(withIndexedTable([{ fields: ['ownerId', 'code'], unique: true }])), 'widgets')

    expect(widgets?.indexes).toEqual([{ fields: ['owner', 'code'], unique: true }])
  })

  it('omits `unique` on a non-unique index and `indexes` on tables that declare none', () => {
    const collections = build(withIndexedTable([{ fields: ['label', 'code'] }]))

    expect(find(collections, 'widgets')?.indexes).toEqual([{ fields: ['label', 'code'] }])
    expect(find(collections, 'sessions')?.indexes).toBeUndefined()
  })

  it('respects usePlural: false for the collection carrying the index', () => {
    const widget = find(
      build({ usePlural: false, ...withIndexedTable([{ fields: ['label', 'code'], unique: true }]) }),
      'widget'
    )

    expect(widget?.indexes).toEqual([{ fields: ['label', 'code'], unique: true }])
  })

  it('keeps index field names aligned with the fields it generated', () => {
    const collections = build(withIndexedTable([{ fields: ['ownerId', 'label'], unique: true }]))

    for (const collection of collections) {
      const names = new Set(
        (collection.fields ?? [])
          .map((f) => ('name' in f ? f.name : undefined))
          .filter(Boolean) as string[]
      )
      for (const index of collection.indexes ?? []) {
        for (const field of index.fields) {
          expect(
            names.has(field),
            `${collection.slug}.indexes references missing field '${field}'`
          ).toBe(true)
        }
      }
    }
  })

  it('skips (and warns about) an index naming a field that was not generated', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // `createdAt` is handled by Payload's `timestamps` rather than emitted as a
    // field, so an index spanning it cannot be expressed on the collection.
    const collections = build({
      betterAuthOptions: {
        plugins: [
          {
            id: 'index-test',
            schema: {
              widget: {
                fields: {
                  label: { type: 'string', required: true },
                  createdAt: { type: 'date', required: true },
                },
                indexes: [{ fields: ['label', 'createdAt'], unique: true }],
              },
            },
          },
        ],
      } as never,
    })

    const widgets = find(collections, 'widgets')
    expect(widgets).toBeDefined()
    expect(widgets?.indexes).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipping index'))

    warn.mockRestore()
  })
})
