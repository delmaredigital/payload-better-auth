import { describe, it, expect, vi } from 'vitest'
import type { Config } from 'payload'
import { createFirstUserAdminHooks, betterAuthCollections } from '../../src/adapter/collections.js'

type Args = Parameters<ReturnType<typeof createFirstUserAdminHooks>['before']>[0]

function makeReq(opts: {
  user?: unknown
  count?: number
  admins?: Array<{ id: unknown; createdAt?: unknown; role?: string }>
}) {
  const update = vi.fn(async () => ({}))
  const req = {
    user: opts.user,
    payload: {
      count: async () => ({ totalDocs: opts.count ?? 0 }),
      find: async () => ({ docs: opts.admins ?? [] }),
      update,
    },
  }
  return { req, update }
}

const { before, after } = createFirstUserAdminHooks({}, 'users')

describe('collections firstUserAdmin before (H1)', () => {
  it('bootstraps the first user as admin and marks the context', async () => {
    const { req } = makeReq({ count: 0 })
    const context: Record<string, unknown> = {}
    const data = await before({ data: { email: 'a@x.com' }, operation: 'create', req, context } as unknown as Args)
    expect((data as Record<string, unknown>).role).toBe('admin')
    expect(context.__betterAuthFirstUserAdminAssigned).toBe(true)
  })

  it('IGNORES a client-supplied role on self-signup (no authenticated admin)', async () => {
    const { req } = makeReq({ count: 1, user: null })
    const data = await before({ data: { email: 'b@x.com', role: 'admin' }, operation: 'create', req, context: {} } as unknown as Args)
    expect((data as Record<string, unknown>).role).toBe('user')
  })

  it('HONORS a role when an authenticated admin performs the create', async () => {
    const { req } = makeReq({ count: 1, user: { id: 1, role: 'admin' } })
    const data = await before({ data: { email: 'c@x.com', role: 'editor' }, operation: 'create', req, context: {} } as unknown as Args)
    expect((data as Record<string, unknown>).role).toBe('editor')
  })

  it('fails closed to default role when the count check throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const req = {
      user: null,
      payload: { count: async () => { throw new Error('db down') } },
    }
    const data = await before({ data: { email: 'd@x.com', role: 'admin' }, operation: 'create', req, context: {} } as unknown as Args)
    expect((data as Record<string, unknown>).role).toBe('user')
    warn.mockRestore()
  })

  it('does nothing on non-create operations', async () => {
    const { req } = makeReq({ count: 5 })
    const input = { email: 'e@x.com', role: 'admin' }
    const data = await before({ data: input, operation: 'update', req, context: {} } as unknown as Args)
    expect(data).toBe(input)
  })
})

describe('collections firstUserAdmin after (H2 race convergence)', () => {
  const marked = { __betterAuthFirstUserAdminAssigned: true }

  it('demotes a bootstrap admin that is not the canonical first', async () => {
    // Two admins exist; this doc (id 2, later createdAt) is not the first.
    const admins = [
      { id: 1, role: 'admin', createdAt: '2026-01-01T00:00:00Z' },
      { id: 2, role: 'admin', createdAt: '2026-01-01T00:00:01Z' },
    ]
    const { req, update } = makeReq({ admins })
    const doc = { id: 2, role: 'admin', createdAt: '2026-01-01T00:00:01Z' }
    const result = await after({ doc, operation: 'create', req, context: { ...marked } } as never)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, data: { role: 'user' } })
    )
    expect((result as Record<string, unknown>).role).toBe('user')
  })

  it('keeps the canonical first admin', async () => {
    const admins = [
      { id: 1, role: 'admin', createdAt: '2026-01-01T00:00:00Z' },
      { id: 2, role: 'admin', createdAt: '2026-01-01T00:00:01Z' },
    ]
    const { req, update } = makeReq({ admins })
    const doc = { id: 1, role: 'admin', createdAt: '2026-01-01T00:00:00Z' }
    const result = await after({ doc, operation: 'create', req, context: { ...marked } } as never)
    expect(update).not.toHaveBeenCalled()
    expect((result as Record<string, unknown>).role).toBe('admin')
  })

  it('does nothing when the create was not a bootstrap admin (unmarked context)', async () => {
    const { req, update } = makeReq({ admins: [{ id: 1, role: 'admin' }, { id: 2, role: 'admin' }] })
    const doc = { id: 2, role: 'admin' }
    await after({ doc, operation: 'create', req, context: {} } as never)
    expect(update).not.toHaveBeenCalled()
  })

  it('does nothing when only one admin exists', async () => {
    const { req, update } = makeReq({ admins: [{ id: 1, role: 'admin' }] })
    const doc = { id: 1, role: 'admin' }
    await after({ doc, operation: 'create', req, context: { ...marked } } as never)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('betterAuthCollections: firstUserAdmin-disabled security warning', () => {
  const baseConfig = (): Config =>
    ({ collections: [{ slug: 'users', fields: [] }] }) as unknown as Config

  it('warns that the role guard is off when firstUserAdmin is disabled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    betterAuthCollections({ firstUserAdmin: false })(baseConfig())
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('firstUserAdmin is disabled')),
    ).toBe(true)
    warn.mockRestore()
  })

  it('does NOT emit that warning when firstUserAdmin is left at its default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    betterAuthCollections({})(baseConfig())
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('firstUserAdmin is disabled')),
    ).toBe(false)
    warn.mockRestore()
  })
})
