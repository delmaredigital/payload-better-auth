import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getServerSession, getServerUser } from '../../src/utils/session.js'

/**
 * getServerSession / getServerUser run in server components and other places
 * that have no response to set cookies on. Better Auth's getSession() refreshes
 * the session row once `updateAge` is reached and hands the new cookie back as a
 * Set-Cookie header — which these helpers have nowhere to put. Reading through
 * them must therefore leave the session untouched (`disableRefresh`), or the
 * database expiry drifts away from the cookie the browser still holds.
 * (betterAuthStrategy makes the same call when Payload's `canSetHeaders` is false.)
 */

const headers = new Headers({ cookie: 'better-auth.session_token=abc' })

function payloadWith(getSession: ReturnType<typeof vi.fn> | null) {
  return (getSession ? { betterAuth: { api: { getSession } } } : {}) as any
}

describe('getServerSession', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('reads the session without refreshing it — there is no response to carry a new cookie', async () => {
    const getSession = vi.fn(async () => ({
      user: { id: 'u1', email: 'a@b.c' },
      session: { id: 's1', expiresAt: new Date() },
    }))

    await getServerSession(payloadWith(getSession), headers)

    expect(getSession).toHaveBeenCalledTimes(1)
    expect(getSession).toHaveBeenCalledWith({ headers, query: { disableRefresh: true } })
  })

  it('returns exactly what Better Auth resolved', async () => {
    const resolved = { user: { id: 'u1', email: 'a@b.c' }, session: { id: 's1', expiresAt: new Date() } }
    const getSession = vi.fn(async () => resolved)

    await expect(getServerSession(payloadWith(getSession), headers)).resolves.toBe(resolved)
  })

  it('returns null (and logs) when Better Auth is not initialized on the payload instance', async () => {
    await expect(getServerSession(payloadWith(null), headers)).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('returns null (and logs) when getSession throws', async () => {
    const getSession = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(getServerSession(payloadWith(getSession), headers)).resolves.toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})

describe('getServerUser', () => {
  it('returns the session user, and null when there is no session', async () => {
    const withSession = vi.fn(async () => ({
      user: { id: 'u1', email: 'a@b.c' },
      session: { id: 's1', expiresAt: new Date() },
    }))
    const without = vi.fn(async () => null)

    await expect(getServerUser(payloadWith(withSession), headers)).resolves.toEqual({ id: 'u1', email: 'a@b.c' })
    await expect(getServerUser(payloadWith(without), headers)).resolves.toBeNull()
  })
})
