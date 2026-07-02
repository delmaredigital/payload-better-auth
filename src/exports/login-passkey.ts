/**
 * Passkey-enabled admin login entry.
 *
 * Kept as a SEPARATE entry point from `/rsc` so that consumers who don't use
 * passkey never pull the optional `@better-auth/passkey` peer into their bundle.
 * Point `admin.loginViewComponent` at
 * `@delmaredigital/payload-better-auth/components/login-passkey#LoginViewWrapperWithPasskey`.
 */
export { LoginViewWrapperWithPasskey } from '../components/LoginViewWrapperWithPasskey.js'
export { PasskeyLoginView } from '../components/PasskeyLoginView.js'
