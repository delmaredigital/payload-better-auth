import { describe, it, expect, vi } from 'vitest'
import { jwt } from 'better-auth/plugins'
import type { BetterAuthOptions } from 'better-auth'
import type { BasePayload } from 'payload'
import { payloadAdapter } from '../../src/adapter/index.js'
import { pluralize } from '../../src/adapter/collections.js'
import { createMockPayload } from './mocks.js'

const options = (jwks?: { modelName: string }): BetterAuthOptions => ({
  database: {} as any,
  baseURL: 'http://localhost:3000',
  secret: 'test-secret',
  advanced: { database: { generateId: 'serial' } },
  plugins: [jwt(jwks ? { schema: { jwks } } : undefined)],
})

const queriedCollection = async (jwks?: { modelName: string }) => {
  const mp = createMockPayload({ documents: {} })
  await payloadAdapter({ payloadClient: mp as BasePayload })(options(jwks)).findMany({
    model: 'jwks',
  })
  return vi.mocked(mp.find).mock.calls[0][0].collection
}

describe('models that already end in s', () => {
  it('queries `jwks` with the jwt plugin at its defaults', async () => {
    expect(await queriedCollection()).toBe('jwks')
  })

  it('queries `jwks` when the model is renamed to the singular `jwk`', async () => {
    expect(await queriedCollection({ modelName: 'jwk' })).toBe('jwks')
  })

  it.each(['class', 'clas', 'jwks', 'jwkss', 'address', 'foo', 'bus'])(
    'modelName `%s` queries the slug betterAuthCollections generates',
    async (modelName) => {
      expect(await queriedCollection({ modelName })).toBe(pluralize(modelName))
    },
  )
})
