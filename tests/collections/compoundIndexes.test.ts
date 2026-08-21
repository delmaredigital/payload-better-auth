/**
 * Better Auth 1.7 moved constraints that used to be implicit into the schema as
 * table-level `indexes`. The most consequential is `account`'s unique
 * `(issuer, accountId)` — the constraint that stops one provider identity from
 * being linked to two users. Generated collections must carry them through.
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

describe('compound index passthrough', () => {
  it('gives accounts the unique (issuer, accountId) index', () => {
    const accounts = find(build(), 'accounts')

    expect(accounts).toBeDefined()
    expect(accounts?.indexes).toEqual([{ fields: ['issuer', 'accountId'], unique: true }])
  })

  it('generates the required issuer field alongside it', () => {
    const accounts = find(build(), 'accounts')
    const issuer = (accounts?.fields ?? []).find(
      (f) => 'name' in f && f.name === 'issuer'
    ) as { name: string; type: string; required?: boolean } | undefined

    expect(issuer).toBeDefined()
    expect(issuer?.type).toBe('text')
    expect(issuer?.required).toBe(true)
  })

  it('omits `indexes` on collections whose table declares none', () => {
    const sessions = find(build(), 'sessions')

    expect(sessions).toBeDefined()
    expect(sessions?.indexes).toBeUndefined()
  })

  it('respects usePlural: false for the collection carrying the index', () => {
    const account = find(build({ usePlural: false }), 'account')

    expect(account?.indexes).toEqual([{ fields: ['issuer', 'accountId'], unique: true }])
  })

  it('keeps index field names aligned with the fields it generated', () => {
    const collections = build()

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
