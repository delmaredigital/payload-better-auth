import { describe, it, expect, vi, afterEach } from 'vitest'
import { createBetterAuthPlugin } from '../../src/plugin/index.js'
import type { Config } from 'payload'

const BEFORE_LOGIN = '@delmaredigital/payload-better-auth/components#BeforeLogin'

const baseConfig = () =>
  ({
    collections: [
      {
        slug: 'users',
        auth: { disableLocalStrategy: true, strategies: [] },
        fields: [],
      },
    ],
  }) as unknown as Config

const buildWith = (admin: Record<string, unknown> = {}) =>
  createBetterAuthPlugin({ createAuth: () => ({}), admin })(baseConfig())

describe('BeforeLogin injection (issue: dead extension point)', () => {
  it('is NOT injected when the plugin replaces the login view (the default)', () => {
    // Payload renders beforeLogin inside its own login view, which the plugin
    // replaces — injecting there means the component never renders.
    const config = buildWith()
    const beforeLogin = config.admin?.components?.beforeLogin ?? []
    expect(beforeLogin).not.toContain(BEFORE_LOGIN)
    expect(config.admin?.components?.views).toHaveProperty('login')
  })

  it('is injected when disableLoginView keeps Payload’s own login view', () => {
    const config = buildWith({ disableLoginView: true })
    expect(config.admin?.components?.beforeLogin).toContain(BEFORE_LOGIN)
    expect(config.admin?.components?.views ?? {}).not.toHaveProperty('login')
  })

  it('is never injected when disableBeforeLogin is set', () => {
    const config = buildWith({ disableLoginView: true, disableBeforeLogin: true })
    const beforeLogin = config.admin?.components?.beforeLogin ?? []
    expect(beforeLogin).not.toContain(BEFORE_LOGIN)
  })

  describe('warning on a dropped beforeLoginComponent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    afterEach(() => warn.mockClear())

    it('warns when the consumer passed one the plugin cannot inject', () => {
      buildWith({ beforeLoginComponent: './Custom#Banner' })
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('admin.beforeLoginComponent was not injected')
      )
    })

    it('stays quiet when the component is actually injected', () => {
      buildWith({ beforeLoginComponent: './Custom#Banner', disableLoginView: true })
      expect(warn).not.toHaveBeenCalled()
    })

    it('stays quiet when the consumer turned beforeLogin off themselves', () => {
      buildWith({ beforeLoginComponent: './Custom#Banner', disableBeforeLogin: true })
      expect(warn).not.toHaveBeenCalled()
    })

    it('stays quiet when no component was passed', () => {
      buildWith()
      expect(warn).not.toHaveBeenCalled()
    })
  })
})
