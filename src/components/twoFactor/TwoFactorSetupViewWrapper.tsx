import type { AdminViewProps } from 'payload'
import type { PayloadWithAuth } from '../../types/betterAuth.js'
import { TwoFactorSetupView, type TwoFactorSetupViewProps } from './TwoFactorSetupView.js'

export type TwoFactorSetupViewWrapperProps = AdminViewProps &
  Omit<TwoFactorSetupViewProps, 'hasPassword' | 'onSetupComplete'>

/**
 * Server component wrapper for TwoFactorSetupView.
 *
 * Resolves `hasPassword` server-side by listing the signed-in user's Better
 * Auth accounts and looking for a credential one — so the view can ask
 * credential accounts to confirm their password and start enablement directly
 * for passwordless (social/passkey-only) accounts, without ever asking the
 * user which kind of account they have.
 *
 * Falls back to `hasPassword: true` (the password step) if the accounts can't
 * be read — the safe default, since most admin accounts hold a password.
 */
export async function TwoFactorSetupViewWrapper({
  initPageResult,
  logo,
  title,
  afterSetupPath,
}: TwoFactorSetupViewWrapperProps) {
  const { headers, payload } = initPageResult.req
  const api = (payload as PayloadWithAuth).betterAuth?.api

  let hasPassword = true
  if (api) {
    try {
      const accounts = await api.listUserAccounts({ headers })
      hasPassword = accounts.some((account) => account.providerId === 'credential')
    } catch {
      // No session / API unavailable: keep the safe default.
    }
  }

  return (
    <TwoFactorSetupView
      logo={logo}
      title={title}
      afterSetupPath={afterSetupPath}
      hasPassword={hasPassword}
    />
  )
}

export default TwoFactorSetupViewWrapper
