import { describe, it, expect } from 'vitest'
import { resolveAvailability, pickPrimaryMethod } from '../../src/utils/loginMethods.js'

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
