/**
 * Passkey Components
 *
 * Requires @better-auth/passkey peer dependency.
 * These are separated from the main /components barrel to avoid
 * webpack resolution errors for consumers without @better-auth/passkey.
 */

export type { PasskeySignInButtonProps } from '../PasskeySignInButton.js'
export { PasskeySignInButton } from '../PasskeySignInButton.js'
export type { PasskeyRegisterButtonProps } from '../PasskeyRegisterButton.js'
export { PasskeyRegisterButton } from '../PasskeyRegisterButton.js'
export { PasskeysField } from '../management/fields/PasskeysField.js'
export type { PasskeysManagementClientProps } from '../management/PasskeysManagementClient.js'
export { PasskeysManagementClient } from '../management/PasskeysManagementClient.js'
