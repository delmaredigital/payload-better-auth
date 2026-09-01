import { describe, it, expect } from 'vitest'
import {
  resolveAvailability,
  pickPrimaryMethod,
  detectEnabledMethods,
  detectOtpLengths,
  resolveTwoFactorOffer,
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
      twoFactorBackupCode: false,
      twoFactorEmailOtp: false,
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
      twoFactorBackupCode: false,
      twoFactorEmailOtp: false,
    })
    expect(detectEnabledMethods({ emailAndPassword: { enabled: false } }).password).toBe(false)
  })

  it('detects two-factor backup codes and the emailed second factor', () => {
    const withOtp = detectEnabledMethods({
      plugins: [{ id: 'two-factor', options: { otpOptions: { sendOTP: async () => {} } } }],
    })
    expect(withOtp.twoFactorBackupCode).toBe(true)
    expect(withOtp.twoFactorEmailOtp).toBe(true)

    const withoutOtp = detectEnabledMethods({ plugins: [{ id: 'two-factor' }] })
    expect(withoutOtp.twoFactorBackupCode).toBe(true)
    expect(withoutOtp.twoFactorEmailOtp).toBe(false)
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
      twoFactorBackupCode: false,
      twoFactorEmailOtp: false,
    }
    expect(detectEnabledMethods(undefined)).toEqual(allFalse)
    expect(detectEnabledMethods({})).toEqual(allFalse)
    // tolerates malformed plugin entries
    expect(detectEnabledMethods({ plugins: [null, undefined, { id: 'passkey' }] }).passkey).toBe(true)
  })
})

describe('resolveTwoFactorOffer', () => {
  it('follows what sign-in reported for this user', () => {
    expect(resolveTwoFactorOffer(['totp'], true)).toEqual({ totp: true, emailOtp: false })
    expect(resolveTwoFactorOffer(['otp'], true)).toEqual({ totp: false, emailOtp: true })
    expect(resolveTwoFactorOffer(['totp', 'otp'], true)).toEqual({ totp: true, emailOtp: true })
  })

  it('treats an empty report as "neither" — only backup codes are left', () => {
    expect(resolveTwoFactorOffer([], true)).toEqual({ totp: false, emailOtp: false })
  })

  it('falls back to the config when the server reported nothing', () => {
    expect(resolveTwoFactorOffer(null, true)).toEqual({ totp: true, emailOtp: true })
    expect(resolveTwoFactorOffer(null, false)).toEqual({ totp: true, emailOtp: false })
  })

  it('keeps the config as a ceiling over the report', () => {
    expect(resolveTwoFactorOffer(['otp'], false)).toEqual({ totp: false, emailOtp: false })
  })
})

describe('detectOtpLengths', () => {
  it('defaults every code to six', () => {
    expect(detectOtpLengths(undefined)).toEqual({
      emailOtp: 6,
      twoFactorTotp: 6,
      twoFactorEmailOtp: 6,
    })
    expect(detectOtpLengths({ plugins: [{ id: 'two-factor' }, { id: 'email-otp' }] })).toEqual({
      emailOtp: 6,
      twoFactorTotp: 6,
      twoFactorEmailOtp: 6,
    })
  })

  it('reads the configured lengths off each plugin', () => {
    expect(
      detectOtpLengths({
        plugins: [
          { id: 'email-otp', options: { otpLength: 4 } },
          { id: 'two-factor', options: { totpOptions: { digits: 8 }, otpOptions: { digits: 7 } } },
        ],
      })
    ).toEqual({ emailOtp: 4, twoFactorTotp: 8, twoFactorEmailOtp: 7 })
  })

  it('ignores a length that could never render an input', () => {
    const lengths = detectOtpLengths({
      plugins: [
        { id: 'email-otp', options: { otpLength: 0 } },
        { id: 'two-factor', options: { totpOptions: { digits: -1 }, otpOptions: { digits: '6' } } },
      ],
    })
    expect(lengths).toEqual({ emailOtp: 6, twoFactorTotp: 6, twoFactorEmailOtp: 6 })
  })
})

describe('detectSocialProviders', () => {
  it('reads the providers Better Auth resolved on the context', async () => {
    expect(
      await detectSocialProviders({
        socialProviders: [{ id: 'google', name: 'Google' }, { id: 'github', name: 'GitHub' }],
      })
    ).toEqual([
      { id: 'google', name: 'Google' },
      { id: 'github', name: 'GitHub' },
    ])
  })

  it('carries a generic provider display name through', async () => {
    expect(
      await detectSocialProviders({ socialProviders: [{ id: 'zitadel', name: 'Company SSO' }] })
    ).toEqual([{ id: 'zitadel', name: 'Company SSO' }])
  })

  it('omits name when the provider has none', async () => {
    expect(await detectSocialProviders({ socialProviders: [{ id: 'okta' }] })).toEqual([
      { id: 'okta' },
    ])
    expect(await detectSocialProviders({ socialProviders: [{ id: 'okta', name: '  ' }] })).toEqual([
      { id: 'okta' },
    ])
  })

  it('resolves thunk entries, the way Better Auth does before matching a provider', async () => {
    expect(
      await detectSocialProviders({
        socialProviders: [
          () => ({ id: 'sync', name: 'Sync' }),
          async () => ({ id: 'async', name: 'Async' }),
        ],
      })
    ).toEqual([
      { id: 'sync', name: 'Sync' },
      { id: 'async', name: 'Async' },
    ])
  })

  it('skips a thunk that throws instead of losing the rest of the list', async () => {
    expect(
      await detectSocialProviders({
        socialProviders: [
          () => {
            throw new Error('provider blew up')
          },
          { id: 'github' },
        ],
      })
    ).toEqual([{ id: 'github' }])
  })

  it('keeps the first entry for an id, matching how a generic provider shadows a built-in', async () => {
    expect(
      await detectSocialProviders({
        socialProviders: [
          { id: 'github', name: 'Corp GitHub' },
          { id: 'github', name: 'GitHub' },
        ],
      })
    ).toEqual([{ id: 'github', name: 'Corp GitHub' }])
  })

  it('drops entries without a usable id', async () => {
    expect(
      await detectSocialProviders({
        socialProviders: [null, undefined, {}, { id: '' }, { id: 42 }, { id: 'github' }],
      })
    ).toEqual([{ id: 'github' }])
  })

  it('returns [] when the context has no resolved providers', async () => {
    expect(await detectSocialProviders({})).toEqual([])
    expect(await detectSocialProviders(null)).toEqual([])
    expect(await detectSocialProviders(undefined)).toEqual([])
    expect(await detectSocialProviders({ socialProviders: null })).toEqual([])
  })
})

describe('resolveSocialProviders', () => {
  const detected = [
    { id: 'google', name: 'Google' },
    { id: 'github', name: 'GitHub' },
  ]

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

  it('dedupes duplicate allowlist ids', () => {
    expect(resolveSocialProviders(['google', 'google'], detected)).toEqual([
      { id: 'google', label: 'Google' },
    ])
  })

  it('labels a generic provider with its display name, and allowlists it by id', () => {
    const generic = [{ id: 'zitadel', name: 'Company SSO' }, { id: 'github', name: 'GitHub' }]
    expect(resolveSocialProviders(true, generic)).toEqual([
      { id: 'zitadel', label: 'Company SSO' },
      { id: 'github', label: 'GitHub' },
    ])
    expect(resolveSocialProviders(['zitadel'], generic)).toEqual([
      { id: 'zitadel', label: 'Company SSO' },
    ])
  })
})

describe('socialProviderLabel', () => {
  it('uses canonical casing for known providers', () => {
    expect(socialProviderLabel('github')).toBe('GitHub')
    expect(socialProviderLabel('google')).toBe('Google')
    expect(socialProviderLabel('linkedin')).toBe('LinkedIn')
  })

  it("prefers the admin UI's name for a known id over Better Auth's", () => {
    // Better Auth calls this provider 'Microsoft EntraID'.
    expect(socialProviderLabel('microsoft', 'Microsoft EntraID')).toBe('Microsoft')
  })

  it("uses the provider's own display name for an unknown id", () => {
    expect(socialProviderLabel('zitadel', 'Company SSO')).toBe('Company SSO')
    expect(socialProviderLabel('company-sso', 'Company SSO')).toBe('Company SSO')
  })

  it('capitalizes unknown provider ids', () => {
    expect(socialProviderLabel('okta')).toBe('Okta')
    expect(socialProviderLabel('okta', '   ')).toBe('Okta')
  })

  it('returns an empty string unchanged', () => {
    expect(socialProviderLabel('')).toBe('')
  })
})
