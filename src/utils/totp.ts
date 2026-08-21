/**
 * TOTP helpers shared by the two-factor setup and management UIs.
 *
 * @packageDocumentation
 */

/**
 * Pull the shared secret out of an `otpauth://` URI.
 *
 * Better Auth's `/two-factor/enable` returns `{ method, totpURI, backupCodes }`
 * — the secret is only carried inside the URI's `secret` parameter. The setup
 * UIs offer it as the manual-entry fallback for users who can't scan the QR
 * code, so both derive it from the URI rather than expecting a `secret` field.
 */
export function extractTotpSecret(totpURI: string | undefined | null): string | null {
  if (!totpURI) return null
  const match = totpURI.match(/[?&]secret=([^&]+)/i)
  return match ? decodeURIComponent(match[1]) : null
}
