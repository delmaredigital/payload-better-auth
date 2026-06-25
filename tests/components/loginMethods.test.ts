import { describe, it, expect } from 'vitest'
import {
  resolveAvailability,
  pickPrimaryMethod,
  detectEnabledMethods,
  detectSocialProviders,
  resolveSocialProviders,
  socialProviderLabel,
} from '../../src/utils/loginMethods.js'

describe('resolveAvailability', () => {
  it('returns true when the setting is explicitly true, regardless of probe', () => {
    expect(resolveAvailability(true, null)).toBe(true)
    expect(resolveAvailability(true, false)).toBe(true)
    expect(resolveAvailability(true, true)).toBe(true)
  })

  it('returns false when the setting is explicitly false, regardless of probe', () => {
    expect(resolveAvailability(false, true)).toBe(false)
    expect(resolveAvailability(false, null)).toBe(false)
  })

  it('defers to the probe result when the setting is "auto"', () => {
    expect(resolveAvailability('auto', true)).toBe(true)
    expect(resolveAvailability('auto', false)).toBe(false)
  })

  it('treats a not-yet-completed (null) probe as unavailable under "auto"', () => {
    expect(resolveAvailability('auto', null)).toBe(false)
  })
})

describe('pickPrimaryMethod', () => {
  it('prefers password when available', () => {
    expect(pickPrimaryMethod({ password: true, magicLink: true, emailOtp: true })).toBe('password')
  })

  it('falls back to magicLink when password is unavailable', () => {
    expect(pickPrimaryMethod({ password: false, magicLink: true, emailOtp: true })).toBe('magicLink')
  })

  it('falls back to emailOtp when only emailOtp is available', () => {
    expect(pickPrimaryMethod({ password: false, magicLink: false, emailOtp: true })).toBe('emailOtp')
  })

  it('returns null when no method is available', () => {
    expect(pickPrimaryMethod({ password: false, magicLink: false, emailOtp: false })).toBe(null)
  })
})

describe('detectEnabledMethods', () => {
  it('detects password + plugin-based methods from resolved auth options', () => {
    expect(
      detectEnabledMethods({
        emailAndPassword: { enabled: true },
        plugins: [{ id: 'magic-link' }, { id: 'email-otp' }],
      }),
    ).toEqual({
      password: true,
      signup: true,
      forgotPassword: false,
      passkey: false,
      magicLink: true,
      emailOtp: true,
    })
  })

  it('treats absent/disabled emailAndPassword as no password, signup, or forgot', () => {
    expect(detectEnabledMethods({ plugins: [{ id: 'passkey' }] })).toEqual({
      password: false,
      signup: false,
      forgotPassword: false,
      passkey: true,
      magicLink: false,
      emailOtp: false,
    })
    expect(detectEnabledMethods({ emailAndPassword: { enabled: false } }).password).toBe(false)
  })

  it('respects disableSignUp and requires sendResetPassword for forgot-password', () => {
    const r = detectEnabledMethods({
      emailAndPassword: { enabled: true, disableSignUp: true, sendResetPassword: async () => {} },
      plugins: [],
    })
    expect(r.password).toBe(true)
    expect(r.signup).toBe(false)
    expect(r.forgotPassword).toBe(true)
  })

  it('returns all-false for empty or undefined options', () => {
    const allFalse = {
      password: false,
      signup: false,
      forgotPassword: false,
      passkey: false,
      magicLink: false,
      emailOtp: false,
    }
    expect(detectEnabledMethods(undefined)).toEqual(allFalse)
    expect(detectEnabledMethods({})).toEqual(allFalse)
    // tolerates malformed plugin entries
    expect(detectEnabledMethods({ plugins: [null, undefined, { id: 'passkey' }] }).passkey).toBe(true)
  })
})

describe('detectSocialProviders', () => {
  it('returns the keys of socialProviders', () => {
    expect(detectSocialProviders({ socialProviders: { google: {}, github: {} } })).toEqual([
      'google',
      'github',
    ])
  })

  it('returns [] when socialProviders is absent, null, or not an object', () => {
    expect(detectSocialProviders({})).toEqual([])
    expect(detectSocialProviders(null)).toEqual([])
    expect(detectSocialProviders(undefined)).toEqual([])
    expect(detectSocialProviders({ socialProviders: null })).toEqual([])
  })
})

describe('resolveSocialProviders', () => {
  const detected = ['google', 'github']

  it('returns [] for false or undefined (the default)', () => {
    expect(resolveSocialProviders(false, detected)).toEqual([])
    expect(resolveSocialProviders(undefined, detected)).toEqual([])
  })

  it('returns all detected providers as {id,label} when true', () => {
    expect(resolveSocialProviders(true, detected)).toEqual([
      { id: 'google', label: 'Google' },
      { id: 'github', label: 'GitHub' },
    ])
  })

  it('intersects an allowlist with detected, preserving allowlist order', () => {
    expect(resolveSocialProviders(['github', 'google'], detected)).toEqual([
      { id: 'github', label: 'GitHub' },
      { id: 'google', label: 'Google' },
    ])
  })

  it('drops allowlist ids that are not configured', () => {
    expect(resolveSocialProviders(['google', 'okta'], detected)).toEqual([
      { id: 'google', label: 'Google' },
    ])
  })

  it('returns [] when nothing is detected even if true', () => {
    expect(resolveSocialProviders(true, [])).toEqual([])
  })
})

describe('socialProviderLabel', () => {
  it('uses canonical casing for known providers', () => {
    expect(socialProviderLabel('github')).toBe('GitHub')
    expect(socialProviderLabel('google')).toBe('Google')
    expect(socialProviderLabel('linkedin')).toBe('LinkedIn')
  })

  it('capitalizes unknown provider ids', () => {
    expect(socialProviderLabel('okta')).toBe('Okta')
  })

  it('returns an empty string unchanged', () => {
    expect(socialProviderLabel('')).toBe('')
  })
})
