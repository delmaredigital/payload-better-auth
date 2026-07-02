import { describe, it, expect, vi } from 'vitest'
import { firstUserAdminHooks } from '../../src/utils/firstUserAdmin.js'

// Build a Better Auth-style ctx exposing an adapter with a mocked count.
function ctxWithCount(count: number | (() => Promise<number>)) {
  return {
    context: {
      adapter: {
        count: typeof count === 'function' ? count : async () => count,
      },
    },
  }
}

const before = (opts?: Parameters<typeof firstUserAdminHooks>[0]) =>
  firstUserAdminHooks(opts).user!.create!.before as unknown as (
    user: Record<string, unknown>,
    ctx: unknown
  ) => Promise<{ data: Record<string, unknown> }>

describe('firstUserAdminHooks (H1: server-authoritative role)', () => {
  it('assigns admin to the first user', async () => {
    const { data } = await before()({ email: 'a@x.com' }, ctxWithCount(0))
    expect(data.role).toBe('admin')
  })

  it('first user is admin even if the client supplies a different role', async () => {
    const { data } = await before()({ email: 'a@x.com', role: 'user' }, ctxWithCount(0))
    expect(data.role).toBe('admin')
  })

  // The core escalation: a subsequent signup POSTing { role: 'admin' } must NOT
  // become admin.
  it('IGNORES a client-supplied role for subsequent users (no escalation)', async () => {
    const { data } = await before()({ email: 'b@x.com', role: 'admin' }, ctxWithCount(1))
    expect(data.role).toBe('user')
  })

  it('assigns the default role to subsequent users with no role', async () => {
    const { data } = await before()({ email: 'b@x.com' }, ctxWithCount(1))
    expect(data.role).toBe('user')
  })

  it('fails closed to default role when the adapter is unavailable', async () => {
    const { data } = await before()({ email: 'b@x.com', role: 'admin' }, { context: {} })
    expect(data.role).toBe('user')
  })

  it('fails closed to default role when the count check throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { data } = await before()(
      { email: 'b@x.com', role: 'admin' },
      ctxWithCount(async () => {
        throw new Error('db down')
      })
    )
    expect(data.role).toBe('user')
    warn.mockRestore()
  })

  it('respects custom adminRole/defaultRole/roleField', async () => {
    const opts = { adminRole: 'superadmin', defaultRole: 'member', roleField: 'kind' }
    const first = await before(opts)({ email: 'a@x.com' }, ctxWithCount(0))
    expect(first.data.kind).toBe('superadmin')
    const next = await before(opts)({ email: 'b@x.com', kind: 'superadmin' }, ctxWithCount(1))
    expect(next.data.kind).toBe('member')
  })
})
