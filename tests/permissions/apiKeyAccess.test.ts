import { describe, it, expect } from 'vitest'
import { extractApiKeyFromRequest } from '../../src/utils/apiKeyAccess.js'

describe('extractApiKeyFromRequest', () => {
  function mockReq(authHeader?: string) {
    return {
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'authorization' ? authHeader ?? null : null,
      },
    } as any
  }

  it('extracts Bearer token', () => {
    expect(extractApiKeyFromRequest(mockReq('Bearer sk_test_123'))).toBe('sk_test_123')
  })

  it('extracts raw Authorization header', () => {
    expect(extractApiKeyFromRequest(mockReq('sk_test_123'))).toBe('sk_test_123')
  })

  it('returns null when no header', () => {
    expect(extractApiKeyFromRequest(mockReq())).toBeNull()
  })

  it('trims whitespace', () => {
    expect(extractApiKeyFromRequest(mockReq('Bearer  sk_test_123  '))).toBe('sk_test_123')
  })
})
