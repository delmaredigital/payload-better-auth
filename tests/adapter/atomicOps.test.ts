/**
 * Tests for `consumeOne` and `incrementOne` — the two atomic primitives Better
 * Auth 1.7 requires every custom adapter to implement. The factory throws
 * rather than falling back, so these are load-bearing for verification tokens,
 * API-key quota, rate limits, and device-authorization codes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { payloadAdapter } from '../../src/adapter/index.js'
import { createMockPayload, type MockDocument } from './mocks.js'
import { apiKey } from '@better-auth/api-key'
import type { BetterAuthOptions } from 'better-auth'

const betterAuthOptions: BetterAuthOptions = {
  database: {} as never,
  baseURL: 'http://localhost:3000',
  secret: 'test-secret',
  advanced: { database: { generateId: 'serial' } },
  // The api-key plugin is what actually drives `incrementOne` in production
  // (quota decrement + rate-limit counter), so test against its real schema.
  plugins: [apiKey()],
}

function makeAdapter(documents: Record<string, MockDocument[]>) {
  const payload = createMockPayload({ documents })
  const adapter = payloadAdapter({ payloadClient: payload })(betterAuthOptions)
  return { payload, adapter }
}

describe('consumeOne', () => {
  it('is exposed on the adapter (1.7 requires it)', () => {
    const { adapter } = makeAdapter({ verifications: [] })
    expect(typeof adapter.consumeOne).toBe('function')
  })

  it('deletes the matched row and returns it', async () => {
    const { payload, adapter } = makeAdapter({
      verifications: [
        { id: 1, identifier: 'reset:a@example.com', value: 'token-a', expiresAt: new Date() },
        { id: 2, identifier: 'reset:b@example.com', value: 'token-b', expiresAt: new Date() },
      ],
    })

    const result = await adapter.consumeOne<{ id: string; value: string }>({
      model: 'verification',
      where: [{ field: 'identifier', value: 'reset:a@example.com', operator: 'eq' }],
    })

    expect(result?.value).toBe('token-a')

    // Gone from storage — a second consume of the same identifier finds nothing.
    const second = await adapter.consumeOne({
      model: 'verification',
      where: [{ field: 'identifier', value: 'reset:a@example.com', operator: 'eq' }],
    })
    expect(second).toBeNull()

    // The untouched row survives.
    const remaining = await adapter.findOne({
      model: 'verification',
      where: [{ field: 'identifier', value: 'reset:b@example.com', operator: 'eq' }],
    })
    expect(remaining).not.toBeNull()
    expect(payload.delete).toHaveBeenCalledTimes(1)
  })

  it('returns null when nothing matches', async () => {
    const { payload, adapter } = makeAdapter({ verifications: [] })

    const result = await adapter.consumeOne({
      model: 'verification',
      where: [{ field: 'identifier', value: 'missing', operator: 'eq' }],
    })

    expect(result).toBeNull()
    expect(payload.delete).not.toHaveBeenCalled()
  })

  it('returns null when a concurrent consumer won the race', async () => {
    const { payload, adapter } = makeAdapter({
      verifications: [{ id: 1, identifier: 'otp', value: 'once' }],
    })

    // Simulate the row vanishing between our read and our delete: Payload
    // raises a 404, which must read as "we lost" and not as "we consumed it".
    const notFound = Object.assign(new Error('Not Found'), { status: 404 })
    ;(payload.delete as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(notFound)

    const result = await adapter.consumeOne({
      model: 'verification',
      where: [{ field: 'identifier', value: 'otp', operator: 'eq' }],
    })

    expect(result).toBeNull()
  })

  it('propagates non-404 delete failures', async () => {
    const { payload, adapter } = makeAdapter({
      verifications: [{ id: 1, identifier: 'otp', value: 'once' }],
    })

    ;(payload.delete as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('connection reset')
    )

    await expect(
      adapter.consumeOne({
        model: 'verification',
        where: [{ field: 'identifier', value: 'otp', operator: 'eq' }],
      })
    ).rejects.toThrow('connection reset')
  })

  it('takes the id fast-path without a find', async () => {
    const { payload, adapter } = makeAdapter({
      verifications: [{ id: 1, identifier: 'otp', value: 'once' }],
    })

    const result = await adapter.consumeOne<{ value: string }>({
      model: 'verification',
      where: [{ field: 'id', value: 1, operator: 'eq' }],
    })

    expect(result?.value).toBe('once')
    expect(payload.findByID).toHaveBeenCalled()
    expect(payload.find).not.toHaveBeenCalled()
  })
})

describe('incrementOne', () => {
  const apiKeyDocs = () => [
    { id: 1, name: 'key-one', remaining: 5, requestCount: 0 },
    { id: 2, name: 'key-two', remaining: 1, requestCount: 9 },
  ]

  it('is exposed on the adapter (1.7 requires it)', () => {
    const { adapter } = makeAdapter({ apikeys: apiKeyDocs() })
    expect(typeof adapter.incrementOne).toBe('function')
  })

  it('applies a negative delta and returns the updated row', async () => {
    const { adapter } = makeAdapter({ apikeys: apiKeyDocs() })

    const result = await adapter.incrementOne<{ remaining: number }>({
      model: 'apikey',
      where: [{ field: 'id', value: 1, operator: 'eq' }],
      increment: { remaining: -1 },
    })

    expect(result?.remaining).toBe(4)
  })

  it('applies a positive delta', async () => {
    const { adapter } = makeAdapter({ apikeys: apiKeyDocs() })

    const result = await adapter.incrementOne<{ requestCount: number }>({
      model: 'apikey',
      where: [{ field: 'id', value: 1, operator: 'eq' }],
      increment: { requestCount: 1 },
    })

    expect(result?.requestCount).toBe(1)
  })

  it('honors the caller guard: no row matches, no write, null result', async () => {
    // Better Auth decrements API-key quota with `remaining > 0` as the guard.
    // A key already at zero must not go negative.
    const { payload, adapter } = makeAdapter({
      apikeys: [{ id: 3, name: 'spent', remaining: 0, requestCount: 3 }],
    })

    const result = await adapter.incrementOne({
      model: 'apikey',
      where: [
        { field: 'id', value: 3, operator: 'eq' },
        { field: 'remaining', value: 0, operator: 'gt' },
      ],
      increment: { remaining: -1 },
    })

    expect(result).toBeNull()
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('applies `set` alongside increments in one write', async () => {
    const { adapter } = makeAdapter({ apikeys: apiKeyDocs() })
    const refillAt = new Date('2026-01-01T00:00:00.000Z')

    const result = await adapter.incrementOne<{ remaining: number; lastRefillAt: Date }>({
      model: 'apikey',
      where: [{ field: 'id', value: 1, operator: 'eq' }],
      increment: { requestCount: 1 },
      set: { remaining: 10, lastRefillAt: refillAt },
    })

    expect(result?.remaining).toBe(10)
    expect(result?.lastRefillAt).toEqual(refillAt)
  })

  it('treats a missing counter as zero', async () => {
    const { adapter } = makeAdapter({
      apikeys: [{ id: 4, name: 'fresh' }],
    })

    const result = await adapter.incrementOne<{ requestCount: number }>({
      model: 'apikey',
      where: [{ field: 'id', value: 4, operator: 'eq' }],
      increment: { requestCount: 1 },
    })

    expect(result?.requestCount).toBe(1)
  })

  it('returns null when the row does not exist', async () => {
    const { adapter } = makeAdapter({ apikeys: [] })

    const result = await adapter.incrementOne({
      model: 'apikey',
      where: [{ field: 'id', value: 999, operator: 'eq' }],
      increment: { requestCount: 1 },
    })

    expect(result).toBeNull()
  })

  it('re-reads and retries when a racing writer moves the counter', async () => {
    const docs = [{ id: 1, name: 'key-one', remaining: 5, requestCount: 0 }]
    const { payload, adapter } = makeAdapter({ apikeys: docs })

    // First write loses the compare-and-swap (guard no longer matches), and a
    // racer has meanwhile taken `remaining` from 5 to 4. The retry must compute
    // from 4 — landing on 3 — rather than clobbering back to 4.
    const realUpdate = payload.update as unknown as ReturnType<typeof vi.fn>
    const original = realUpdate.getMockImplementation()!
    realUpdate.mockImplementationOnce(async () => {
      docs[0].remaining = 4
      return { docs: [] }
    })

    const result = await adapter.incrementOne<{ remaining: number }>({
      model: 'apikey',
      where: [{ field: 'id', value: 1, operator: 'eq' }],
      increment: { remaining: -1 },
    })

    expect(result?.remaining).toBe(3)
    expect(realUpdate).toHaveBeenCalledTimes(2)
    realUpdate.mockImplementation(original)
  })

  it('gives up after sustained contention rather than looping forever', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { payload, adapter } = makeAdapter({ apikeys: apiKeyDocs() })

    // Every write loses its guard — the row is always being moved by someone else.
    ;(payload.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ docs: [] })

    const result = await adapter.incrementOne({
      model: 'apikey',
      where: [{ field: 'id', value: 1, operator: 'eq' }],
      increment: { remaining: -1 },
    })

    expect(result).toBeNull()
    expect(payload.update).toHaveBeenCalledTimes(5)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('contended attempts'))
    warn.mockRestore()
  })
})

describe('adapter surface', () => {
  it('implements every method the 1.7 factory dispatches to', () => {
    const { adapter } = makeAdapter({})
    for (const method of [
      'create',
      'findOne',
      'findMany',
      'update',
      'updateMany',
      'delete',
      'deleteMany',
      'consumeOne',
      'incrementOne',
      'count',
    ]) {
      expect(typeof (adapter as unknown as Record<string, unknown>)[method]).toBe('function')
    }
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})
