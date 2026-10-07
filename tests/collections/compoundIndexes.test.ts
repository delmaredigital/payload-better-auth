/**
 * Better Auth 1.7 moved constraints that used to be implicit into the schema as
 * table-level `indexes`. Generated collections must carry them through. The
 * original carrier — `account`'s unique `(issuer, accountId)` — was reverted
 * upstream in Better Auth 1.7.3 (the 1.7.0–1.7.2 schema needed a backfill BA
 * chose not to impose), so these tests declare the index on a plugin table
 * instead of depending on a core table's shape.
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

/** A plugin schema declaring a unique compound index on `widget`. */
const indexedPlugin = {
  id: 'index-test',
  schema: {
    widget: {
      fields: {
        label: { type: 'string', required: true },
        slug: { type: 'string', required: true },
      },
      indexes: [{ fields: ['label', 'slug'], unique: true }],
    },
  },
}

function buildWithIndex(options: Parameters<typeof betterAuthCollections>[0] = {}) {
  return build({
    ...options,
    betterAuthOptions: {
      ...options.betterAuthOptions,
      plugins: [indexedPlugin],
    } as never,
  })
}

describe('compound index passthrough', () => {
  it('carries a table-level compound index onto the generated collection', () => {
    const widgets = find(buildWithIndex(), 'widgets')

    expect(widgets).toBeDefined()
    expect(widgets?.indexes).toEqual([{ fields: ['label', 'slug'], unique: true }])
  })

  it('generates the indexed fields alongside it', () => {
    const widgets = find(buildWithIndex(), 'widgets')
    const label = (widgets?.fields ?? []).find(
      (f) => 'name' in f && f.name === 'label'
    ) as { name: string; type: string; required?: boolean } | undefined

    expect(label).toBeDefined()
    expect(label?.type).toBe('text')
    expect(label?.required).toBe(true)
  })

  it('omits `indexes` on collections whose table declares none', () => {
    const sessions = find(build(), 'sessions')

    expect(sessions).toBeDefined()
    expect(sessions?.indexes).toBeUndefined()
  })

  it('respects usePlural: false for the collection carrying the index', () => {
    const widget = find(buildWithIndex({ usePlural: false }), 'widget')

    expect(widget?.indexes).toEqual([{ fields: ['label', 'slug'], unique: true }])
  })

  it('keeps index field names aligned with the fields it generated', () => {
    const collections = buildWithIndex()

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
