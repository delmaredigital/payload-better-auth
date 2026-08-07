import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import {
  useAuthMountPath,
  useAuthClientBaseURL,
} from '../../src/components/useAuthMountPath.js'

// The hook derives the auth endpoint mount from the live client config instead
// of the hardcoded '/api/auth' that only matches routes.api === '/api'.

const { mockUseConfig } = vi.hoisted(() => ({ mockUseConfig: vi.fn() }))

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => mockUseConfig(),
}))

function setConfig(config: Record<string, unknown>) {
  mockUseConfig.mockReturnValue({ config })
}

describe('useAuthMountPath', () => {
  it('returns /api/auth for the default config', () => {
    setConfig({ routes: { api: '/api' } })
    const { result } = renderHook(() => useAuthMountPath())
    expect(result.current).toBe('/api/auth')
  })

  it('follows a non-default routes.api', () => {
    setConfig({ routes: { api: '/api/payload' } })
    const { result } = renderHook(() => useAuthMountPath())
    expect(result.current).toBe('/api/payload/auth')
  })

  it('reads a customized authBasePath from admin.custom (authenticated pages)', () => {
    setConfig({
      routes: { api: '/api/payload' },
      admin: { custom: { betterAuth: { authBasePath: '/better-auth' } } },
    })
    const { result } = renderHook(() => useAuthMountPath())
    expect(result.current).toBe('/api/payload/better-auth')
  })

  it('prefers an explicit authBasePath argument (login page has no admin.custom)', () => {
    setConfig({ routes: { api: '/api/payload' } })
    const { result } = renderHook(() => useAuthMountPath('/better-auth'))
    expect(result.current).toBe('/api/payload/better-auth')
  })

  it('falls back to /api when routes are absent (unauthenticated config edge)', () => {
    setConfig({})
    const { result } = renderHook(() => useAuthMountPath())
    expect(result.current).toBe('/api/auth')
  })
})

describe('useAuthClientBaseURL', () => {
  it('returns an absolute URL on the window origin (Better Auth rejects bare paths)', () => {
    setConfig({ routes: { api: '/api/payload' } })
    const { result } = renderHook(() => useAuthClientBaseURL())
    expect(result.current).toBe(`${window.location.origin}/api/payload/auth`)
  })
})
