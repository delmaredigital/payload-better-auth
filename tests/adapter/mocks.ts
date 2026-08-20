/**
 * Mock helpers for Payload CMS client
 */

import { vi } from 'vitest'
import type { BasePayload, CollectionSlug } from 'payload'

export interface MockDocument {
  id: string | number
  [key: string]: unknown
}

export interface MockPayloadOptions {
  /**
   * Documents to return for find/findByID operations
   */
  documents?: Record<string, MockDocument[]>
  /**
   * Whether to throw on certain operations (for error testing)
   */
  throwOn?: {
    create?: Error
    find?: Error
    findByID?: Error
    update?: Error
    delete?: Error
    count?: Error
  }
}

/**
 * Create a mock Payload client for testing
 */
export function createMockPayload(options: MockPayloadOptions = {}): BasePayload {
  const { documents = {}, throwOn = {} } = options

  // Storage for created/updated documents
  const storage: Record<string, MockDocument[]> = { ...documents }

  const getCollection = (slug: string): MockDocument[] => {
    if (!storage[slug]) {
      storage[slug] = []
    }
    return storage[slug]
  }

  return {
    create: vi.fn(async ({ collection, data }) => {
      if (throwOn.create) throw throwOn.create

      const docs = getCollection(collection)
      const id = data.id ?? String(docs.length + 1)
      const doc = { id, ...data, createdAt: new Date(), updatedAt: new Date() }
      docs.push(doc)
      return doc
    }),

    find: vi.fn(async ({ collection, where, limit = 10, page = 1 }) => {
      if (throwOn.find) throw throwOn.find

      const docs = getCollection(collection)
      const filtered = where ? docs.filter((doc) => matchWhere(doc, where)) : [...docs]

      // Apply pagination
      const start = (page - 1) * limit
      const paginated = filtered.slice(start, start + limit)

      return {
        docs: paginated,
        totalDocs: filtered.length,
        totalPages: Math.ceil(filtered.length / limit),
        page,
        limit,
        hasNextPage: start + limit < filtered.length,
        hasPrevPage: page > 1,
      }
    }),

    findByID: vi.fn(async ({ collection, id }) => {
      if (throwOn.findByID) throw throwOn.findByID

      const docs = getCollection(collection)
      const doc = docs.find((d) => String(d.id) === String(id))

      if (!doc) {
        const error = new Error('Not Found') as Error & { status: number }
        error.status = 404
        throw error
      }

      return doc
    }),

    update: vi.fn(async ({ collection, id, where, data }) => {
      if (throwOn.update) throw throwOn.update

      const docs = getCollection(collection)

      if (id !== undefined) {
        // Single document update
        const index = docs.findIndex((d) => String(d.id) === String(id))
        if (index === -1) {
          const error = new Error('Not Found') as Error & { status: number }
          error.status = 404
          throw error
        }
        docs[index] = { ...docs[index], ...data, updatedAt: new Date() }
        return docs[index]
      }

      // Bulk update with where
      const updated: MockDocument[] = []
      docs.forEach((doc, index) => {
        if (matchWhere(doc, where)) {
          docs[index] = { ...doc, ...data, updatedAt: new Date() }
          updated.push(docs[index])
        }
      })

      return { docs: updated }
    }),

    delete: vi.fn(async ({ collection, id, where }) => {
      if (throwOn.delete) throw throwOn.delete

      const docs = getCollection(collection)

      if (id !== undefined) {
        // Single document delete. Payload 404s when the row is already gone —
        // the adapter leans on that to tell "I consumed it" from "someone else
        // did", so the mock has to raise it too.
        const index = docs.findIndex((d) => String(d.id) === String(id))
        if (index === -1) {
          const error = new Error('Not Found') as Error & { status: number }
          error.status = 404
          throw error
        }
        const deleted = docs.splice(index, 1)
        return deleted[0]
      }

      // Bulk delete with where
      const deleted: MockDocument[] = []
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matchWhere(docs[i], where)) {
          deleted.push(...docs.splice(i, 1))
        }
      }

      return { docs: deleted }
    }),

    count: vi.fn(async ({ collection, where }) => {
      if (throwOn.count) throw throwOn.count

      const docs = getCollection(collection)
      let count = docs.length

      if (where) {
        count = docs.filter((doc) => matchWhere(doc, where)).length
      }

      return { totalDocs: count }
    }),
  } as unknown as BasePayload
}

/**
 * Match a single condition against a document field
 */
function matchCondition(
  doc: MockDocument,
  field: string,
  condition: Record<string, unknown>
): boolean {
  const value = doc[field]

  if ('exists' in condition) {
    const present = value !== undefined && value !== null
    return condition.exists ? present : !present
  }
  if ('equals' in condition) {
    return value === condition.equals
  }
  if ('not_equals' in condition) {
    return value !== condition.not_equals
  }
  if ('in' in condition) {
    return (condition.in as unknown[]).includes(value)
  }
  if ('contains' in condition) {
    return String(value).includes(String(condition.contains))
  }
  if ('greater_than' in condition) {
    return Number(value) > Number(condition.greater_than)
  }
  if ('greater_than_equal' in condition) {
    return Number(value) >= Number(condition.greater_than_equal)
  }
  if ('less_than' in condition) {
    return Number(value) < Number(condition.less_than)
  }
  if ('less_than_equal' in condition) {
    return Number(value) <= Number(condition.less_than_equal)
  }

  return true
}

/**
 * Match a where clause against a document.
 *
 * Recurses through `and`/`or` so nested groups and multi-field branches behave
 * the way Payload's query parser does — the adapter's guarded writes build
 * exactly that shape (`{ and: [ {id}, <converted where>, ...guards ] }`).
 */
function matchWhere(
  doc: MockDocument,
  where: Record<string, unknown> | undefined
): boolean {
  if (!where) return true

  return Object.entries(where).every(([key, condition]) => {
    if (key === 'and') {
      return (condition as Array<Record<string, unknown>>).every((cond) =>
        matchWhere(doc, cond)
      )
    }
    if (key === 'or') {
      return (condition as Array<Record<string, unknown>>).some((cond) =>
        matchWhere(doc, cond)
      )
    }
    return matchCondition(doc, key, condition as Record<string, unknown>)
  })
}

/**
 * Reset all mocks on a mock Payload client
 */
export function resetMockPayload(payload: BasePayload): void {
  const mock = payload as unknown as Record<string, { mockClear?: () => void }>
  Object.values(mock).forEach((fn) => {
    if (typeof fn?.mockClear === 'function') {
      fn.mockClear()
    }
  })
}
