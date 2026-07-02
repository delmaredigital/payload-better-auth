import { describe, it, expect } from 'vitest'
import {
  extractApiKeyFromRequest,
  requirePermission,
  allowSessionOrPermission,
} from '../../src/utils/apiKeyAccess.js'

function mockReq(headers: Record<string, string | undefined> = {}, user?: unknown) {
  const lower: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return {
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    user,
    payload: {},
  } as any
}

describe('extractApiKeyFromRequest', () => {
  it('extracts Bearer token', () => {
    expect(extractApiKeyFromRequest(mockReq({ authorization: 'Bearer sk_test_123' }))).toBe(
      'sk_test_123'
    )
  })

  it('extracts raw Authorization header', () => {
    expect(extractApiKeyFromRequest(mockReq({ authorization: 'sk_test_123' }))).toBe('sk_test_123')
  })

  it('extracts x-api-key header', () => {
    expect(extractApiKeyFromRequest(mockReq({ 'x-api-key': 'sk_test_123' }))).toBe('sk_test_123')
  })

  it('prefers x-api-key over Authorization', () => {
    expect(
      extractApiKeyFromRequest(
        mockReq({ 'x-api-key': 'sk_from_xapikey', authorization: 'Bearer sk_from_bearer' })
      )
    ).toBe('sk_from_xapikey')
  })

  it('returns null when no header', () => {
    expect(extractApiKeyFromRequest(mockReq())).toBeNull()
  })

  it('trims whitespace', () => {
    expect(extractApiKeyFromRequest(mockReq({ authorization: 'Bearer  sk_test_123  ' }))).toBe(
      'sk_test_123'
    )
  })

  it('trims whitespace on x-api-key', () => {
    expect(extractApiKeyFromRequest(mockReq({ 'x-api-key': '  sk_test_123  ' }))).toBe('sk_test_123')
  })
})

describe('allowAuthenticatedUsers short-circuit (C1 scope-bypass guard)', () => {
  // An API-key-derived user carries `apiKeyScopes` (set by the auth strategy).
  // It must NEVER be treated as a full session by the allowAuthenticatedUsers
  // short-circuit — even when no api-key header is extractable.
  const apiKeyUser = { id: 1, apiKeyScopes: [] as string[] }
  const sessionUser = { id: 2 }

  it('grants a real session user with no api key', async () => {
    const access = allowSessionOrPermission('posts', 'read')
    const result = await access({ req: mockReq({}, sessionUser) } as any)
    expect(result).toBe(true)
  })

  it('does NOT short-circuit an api-key user even if the key header is not extractable', async () => {
    // Custom extractor that always returns null simulates a header the extractor misses.
    const access = requirePermission('posts', 'read', {
      allowAuthenticatedUsers: true,
      extractApiKey: () => null,
    })
    const result = await access({ req: mockReq({}, apiKeyUser) } as any)
    expect(result).toBe(false)
  })
})
