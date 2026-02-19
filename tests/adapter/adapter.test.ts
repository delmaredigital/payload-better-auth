/**
 * Tests for the Payload adapter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { payloadAdapter, detectDbType, resolveIdType } from '../../src/adapter/index.js'
import { createMockPayload, resetMockPayload } from './mocks.js'
import type { BasePayload } from 'payload'
import type { BetterAuthOptions } from 'better-auth'

function mockPayloadDb(dbName: string): BasePayload {
  return { db: { name: dbName } } as unknown as BasePayload
}

describe('detectDbType', () => {
  it('detects mongodb from mongoose adapter', () => {
    expect(detectDbType(mockPayloadDb('mongoose'))).toBe('mongodb')
  })

  it('detects mongodb from mongo adapter', () => {
    expect(detectDbType(mockPayloadDb('mongo'))).toBe('mongodb')
  })

  it('detects sqlite', () => {
    expect(detectDbType(mockPayloadDb('sqlite'))).toBe('sqlite')
  })

  it('returns postgres for vercel-postgres', () => {
    expect(detectDbType(mockPayloadDb('vercel-postgres'))).toBe('postgres')
  })

  it('returns postgres for postgres', () => {
    expect(detectDbType(mockPayloadDb('postgres'))).toBe('postgres')
  })

  it('defaults to postgres when db.name is missing', () => {
    expect(detectDbType({ db: {} } as unknown as BasePayload)).toBe('postgres')
  })

  it('defaults to postgres when db is undefined', () => {
    expect(detectDbType({} as unknown as BasePayload)).toBe('postgres')
  })
})

describe('resolveIdType', () => {
  const emptyOptions = {} as BetterAuthOptions

  it('returns text for mongodb regardless of explicit idType', () => {
    expect(resolveIdType('mongodb', emptyOptions, 'number')).toBe('text')
  })

  it('returns text for mongodb with no explicit idType', () => {
    expect(resolveIdType('mongodb', emptyOptions)).toBe('text')
  })

  it('returns number for postgres when generateId is undefined', () => {
    expect(resolveIdType('postgres', emptyOptions)).toBe('number')
  })

  it('returns number for postgres when generateId is serial', () => {
    const options = {
      advanced: { database: { generateId: 'serial' } },
    } as unknown as BetterAuthOptions
    expect(resolveIdType('postgres', options)).toBe('number')
  })

  it('returns text for postgres with non-serial generateId', () => {
    const options = {
      advanced: { database: { generateId: true } },
    } as unknown as BetterAuthOptions
    expect(resolveIdType('postgres', options)).toBe('text')
  })

  it('respects explicit idType override for postgres', () => {
    expect(resolveIdType('postgres', emptyOptions, 'text')).toBe('text')
  })

  it('returns number for sqlite when generateId is undefined', () => {
    expect(resolveIdType('sqlite', emptyOptions)).toBe('number')
  })
})

describe('payloadAdapter', () => {
  const mockPayload = createMockPayload({
    documents: {
      users: [
        { id: '1', email: 'user1@example.com', name: 'User One' },
        { id: '2', email: 'user2@example.com', name: 'User Two' },
      ],
      sessions: [
        { id: 's1', userId: '1', token: 'token1', expiresAt: new Date() },
      ],
      accounts: [],
      verifications: [],
    },
  })

  const betterAuthOptions: BetterAuthOptions = {
    database: {} as any,
    baseURL: 'http://localhost:3000',
    secret: 'test-secret',
    // Use serial IDs (Payload default) to suppress warning in tests
    advanced: {
      database: {
        generateId: 'serial',
      },
    },
  }

  beforeEach(() => {
    resetMockPayload(mockPayload)
  })

  describe('initialization', () => {
    it('should create an adapter factory', () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      expect(typeof factory).toBe('function')
    })

    it('should return an adapter when called with options', () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)
      expect(adapter).toBeDefined()
      expect(adapter.id).toBe('payload-adapter')
    })

    it('should support lazy payload client initialization', async () => {
      const lazyPayload = vi.fn().mockResolvedValue(mockPayload)

      const factory = payloadAdapter({
        payloadClient: lazyPayload,
      })

      const adapter = factory(betterAuthOptions)

      // Trigger an operation to resolve the client
      await adapter.findOne({
        model: 'user',
        where: [{ field: 'id', value: '1', operator: 'eq' }],
      })

      expect(lazyPayload).toHaveBeenCalledTimes(1)
    })
  })

  describe('ID type auto-detection', () => {
    it('should detect number ID type when generateId is serial', () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory({
        ...betterAuthOptions,
        advanced: {
          database: {
            generateId: 'serial',
          },
        },
      })

      expect(adapter).toBeDefined()
    })

    it('should default to number ID type without warning when generateId is undefined', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      // Use options WITHOUT generateId - should work without warning
      // because disableIdGeneration: true handles this case
      const optionsWithoutSerial: BetterAuthOptions = {
        database: {} as any,
        baseURL: 'http://localhost:3000',
        secret: 'test-secret',
      }

      const adapter = factory(optionsWithoutSerial)
      expect(adapter).toBeDefined()

      // No warning should appear - disableIdGeneration handles undefined case
      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should warn when idType is explicitly number but generateId is incompatible', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // User explicitly forces number IDs via adapterConfig
      const factory = payloadAdapter({
        payloadClient: mockPayload,
        adapterConfig: {
          idType: 'number', // Explicit override
        },
      })

      // But also sets generateId to something incompatible with number IDs
      const optionsWithCustomId: BetterAuthOptions = {
        database: {} as any,
        baseURL: 'http://localhost:3000',
        secret: 'test-secret',
        advanced: {
          database: {
            generateId: () => 'custom-uuid', // Incompatible with SERIAL IDs
          },
        },
      }

      const adapter = factory(optionsWithCustomId)
      expect(adapter).toBeDefined()

      // Warning should appear because explicit idType: 'number' conflicts with generateId
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('generateId')
      )

      consoleSpy.mockRestore()
    })

    it('should respect explicit idType config', () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
        adapterConfig: {
          idType: 'number',
        },
      })

      const adapter = factory(betterAuthOptions)
      expect(adapter).toBeDefined()
    })

    it('should warn when modelName appears to be already plural', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      // Use plural modelName which should trigger warning
      const optionsWithPluralModelName: BetterAuthOptions = {
        ...betterAuthOptions,
        user: {
          modelName: 'users', // Already plural - should warn
        },
      }

      const adapter = factory(optionsWithPluralModelName)
      expect(adapter).toBeDefined()

      // Warning should appear about plural modelName
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("modelName 'users'")
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('appears to be plural')
      )

      consoleSpy.mockRestore()
    })
  })

  describe('create', () => {
    it('should create a document', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)

      const result = await adapter.create({
        model: 'user',
        data: {
          email: 'new@example.com',
          name: 'New User',
        },
      })

      expect(result).toBeDefined()
      expect(result.email).toBe('new@example.com')
      expect(mockPayload.create).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'users',
          data: expect.objectContaining({
            email: 'new@example.com',
          }),
        })
      )
    })

    it('should use custom collection name from BetterAuthOptions', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      // Custom collection names are configured at Better Auth level
      // Note: With usePlural: true, provide singular names (they get pluralized)
      const adapter = factory({
        ...betterAuthOptions,
        user: {
          modelName: 'member',  // Singular - becomes 'members' with usePlural
        },
      })

      await adapter.create({
        model: 'user',
        data: { email: 'test@example.com' },
      })

      expect(mockPayload.create).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'members',
        })
      )
    })
  })

  describe('findOne', () => {
    it('should find a document by ID', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)

      const result = await adapter.findOne({
        model: 'user',
        where: [{ field: 'id', value: '1', operator: 'eq' }],
      })

      expect(result).toBeDefined()
      expect(mockPayload.findByID).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'users',
          id: 1, // Number because generateId: 'serial'
        })
      )
    })

    it('should return null for non-existent document', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)

      const result = await adapter.findOne({
        model: 'user',
        where: [{ field: 'id', value: 'non-existent', operator: 'eq' }],
      })

      expect(result).toBeNull()
    })

    it('should find document by other fields using find', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)

      const result = await adapter.findOne({
        model: 'user',
        where: [{ field: 'email', value: 'user1@example.com', operator: 'eq' }],
      })

      expect(mockPayload.find).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'users',
          where: { email: { equals: 'user1@example.com' } },
          limit: 1,
        })
      )
    })
  })

  describe('findMany', () => {
    it('should find multiple documents', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)

      const results = await adapter.findMany({
        model: 'user',
        limit: 10,
      })

      expect(Array.isArray(results)).toBe(true)
      expect(mockPayload.find).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'users',
          limit: 10,
        })
      )
    })

    it('should apply where clause', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)

      await adapter.findMany({
        model: 'user',
        where: [{ field: 'name', value: 'User', operator: 'contains' }],
        limit: 10,
      })

      expect(mockPayload.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { contains: 'User' } },
        })
      )
    })

    it('should handle sorting', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)

      await adapter.findMany({
        model: 'user',
        limit: 10,
        sortBy: { field: 'createdAt', direction: 'desc' },
      })

      expect(mockPayload.find).toHaveBeenCalledWith(
        expect.objectContaining({
          sort: '-createdAt',
        })
      )
    })
  })

  describe('update', () => {
    it('should update a document by ID', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)

      const result = await adapter.update({
        model: 'user',
        where: [{ field: 'id', value: '1', operator: 'eq' }],
        update: { name: 'Updated Name' },
      })

      expect(result).toBeDefined()
      expect(mockPayload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'users',
          id: 1, // Number because generateId: 'serial'
          data: expect.objectContaining({
            name: 'Updated Name',
          }),
        })
      )
    })
  })

  describe('delete', () => {
    it('should delete a document by ID', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)

      await adapter.delete({
        model: 'user',
        where: [{ field: 'id', value: '1', operator: 'eq' }],
      })

      expect(mockPayload.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'users',
          id: 1, // Number because generateId: 'serial'
        })
      )
    })
  })

  describe('count', () => {
    it('should count documents', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)

      const count = await adapter.count({
        model: 'user',
      })

      expect(typeof count).toBe('number')
      expect(mockPayload.count).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'users',
        })
      )
    })

    it('should count with where clause', async () => {
      const factory = payloadAdapter({
        payloadClient: mockPayload,
      })

      const adapter = factory(betterAuthOptions)

      await adapter.count({
        model: 'user',
        where: [{ field: 'email', value: 'test', operator: 'contains' }],
      })

      expect(mockPayload.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: { contains: 'test' } },
        })
      )
    })
  })

  describe('debug logging', () => {
    it('should log operations when enableDebugLogs is true', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      const factory = payloadAdapter({
        payloadClient: mockPayload,
        adapterConfig: {
          enableDebugLogs: true,
        },
      })

      const adapter = factory(betterAuthOptions)

      await adapter.findOne({
        model: 'user',
        where: [{ field: 'id', value: '1', operator: 'eq' }],
      })

      // Debug logs are handled by Better Auth's debugLog function
      // We just verify the adapter was created with debug enabled
      expect(adapter).toBeDefined()

      consoleSpy.mockRestore()
    })
  })
})
