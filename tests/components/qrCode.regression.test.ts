import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// C2: the TOTP provisioning URI contains the shared secret and must be rendered
// client-side. It must never be sent to a third-party QR service. These guards
// fail if anyone reintroduces an external QR image URL.
const files = [
  '../../src/components/twoFactor/TwoFactorSetupView.tsx',
  '../../src/components/management/TwoFactorManagementClient.tsx',
]

describe('2FA QR rendering (C2 regression guard)', () => {
  for (const rel of files) {
    const path = fileURLToPath(new URL(rel, import.meta.url))
    const src = readFileSync(path, 'utf8')

    it(`${rel} does not send the TOTP URI to an external QR service`, () => {
      // Allow the word inside an explanatory comment, but never as an <img src>.
      expect(src).not.toMatch(/src=\{`https?:\/\/[^`]*qr/i)
      expect(src).not.toMatch(/create-qr-code/)
    })

    it(`${rel} renders the QR client-side via qrcode.react`, () => {
      expect(src).toMatch(/from 'qrcode\.react'/)
      expect(src).toMatch(/<QRCodeSVG/)
    })
  }
})
