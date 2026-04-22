/**
 * Auto-generated Better Auth types.
 * DO NOT EDIT - Run `pnpm generate:types` to regenerate.
 *
 * Generated from Better Auth schema introspection.
 * Contains types for all supported plugins and their field additions.
 */

export type BaseUserFields = {
  name: string
  email: string
  emailVerified: boolean
  image?: string
  createdAt: Date
  updatedAt: Date
  role?: string
}

export type UserPluginFields = {
  "username": {
    username?: string
    displayUsername?: string
  }
  "admin": {
    banned?: boolean
    banReason?: string
    banExpires?: Date
  }
  "phone-number": {
    phoneNumber?: string
    phoneNumberVerified?: boolean
  }
  "anonymous": {
    isAnonymous?: boolean
  }
  "two-factor": {
    twoFactorEnabled?: boolean
  }
}

export type User = BaseUserFields & UserPluginFields["username"] & UserPluginFields["admin"] & UserPluginFields["phone-number"] & UserPluginFields["anonymous"] & UserPluginFields["two-factor"]

export type BaseSessionFields = {
  expiresAt: Date
  token: string
  createdAt: Date
  updatedAt: Date
  ipAddress?: string
  userAgent?: string
  userId: string
}

export type SessionPluginFields = {
  "admin": {
    impersonatedBy?: string
  }
  "organization": {
    activeOrganizationId?: string
    activeTeamId?: string
  }
}

export type Session = BaseSessionFields & SessionPluginFields["admin"] & SessionPluginFields["organization"]

export type BaseAccountFields = {
  accountId: string
  providerId: string
  userId: string
  accessToken?: string
  refreshToken?: string
  idToken?: string
  accessTokenExpiresAt?: Date
  refreshTokenExpiresAt?: Date
  scope?: string
  password?: string
  createdAt: Date
  updatedAt: Date
}

export type Account = BaseAccountFields

export type BaseVerificationFields = {
  identifier: string
  value: string
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export type Verification = BaseVerificationFields

export type ApikeyFields = {
  configId: string
  name?: string
  start?: string
  referenceId: string
  prefix?: string
  key: string
  refillInterval?: number
  refillAmount?: number
  lastRefillAt?: Date
  enabled?: boolean
  rateLimitEnabled?: boolean
  rateLimitTimeWindow?: number
  rateLimitMax?: number
  requestCount?: number
  remaining?: number
  lastRequest?: Date
  expiresAt?: Date
  createdAt: Date
  updatedAt: Date
  permissions?: string
  metadata?: string
}

export type Apikey = ApikeyFields

export type PasskeyFields = {
  name?: string
  publicKey: string
  userId: string
  credentialID: string
  counter: number
  deviceType: string
  backedUp: boolean
  transports?: string
  createdAt?: Date
  aaguid?: string
}

export type Passkey = PasskeyFields

export type OauthClientFields = {
  clientId: string
  clientSecret?: string
  disabled?: boolean
  skipConsent?: boolean
  enableEndSession?: boolean
  subjectType?: string
  scopes?: string[]
  userId?: string
  createdAt?: Date
  updatedAt?: Date
  name?: string
  uri?: string
  icon?: string
  contacts?: string[]
  tos?: string
  policy?: string
  softwareId?: string
  softwareVersion?: string
  softwareStatement?: string
  redirectUris: string[]
  postLogoutRedirectUris?: string[]
  tokenEndpointAuthMethod?: string
  grantTypes?: string[]
  responseTypes?: string[]
  public?: boolean
  type?: string
  requirePKCE?: boolean
  referenceId?: string
  metadata?: unknown
}

export type OauthClient = OauthClientFields

export type OauthRefreshTokenFields = {
  token: string
  clientId: string
  sessionId?: string
  userId: string
  referenceId?: string
  expiresAt?: Date
  createdAt?: Date
  revoked?: Date
  authTime?: Date
  scopes: string[]
}

export type OauthRefreshToken = OauthRefreshTokenFields

export type OauthAccessTokenFields = {
  token?: string
  clientId: string
  sessionId?: string
  userId?: string
  referenceId?: string
  refreshId?: string
  expiresAt?: Date
  createdAt?: Date
  scopes: string[]
}

export type OauthAccessToken = OauthAccessTokenFields

export type OauthConsentFields = {
  clientId: string
  userId?: string
  referenceId?: string
  scopes: string[]
  createdAt?: Date
  updatedAt?: Date
}

export type OauthConsent = OauthConsentFields

export type OrganizationFields = {
  name: string
  slug: string
  logo?: string
  createdAt: Date
  metadata?: string
}

export type Organization = OrganizationFields

export type TeamFields = {
  name: string
  organizationId: string
  createdAt: Date
  updatedAt?: Date
}

export type Team = TeamFields

export type TeamMemberFields = {
  teamId: string
  userId: string
  createdAt?: Date
}

export type TeamMember = TeamMemberFields

export type MemberFields = {
  organizationId: string
  userId: string
  role: string
  createdAt: Date
}

export type Member = MemberFields

export type InvitationFields = {
  organizationId: string
  email: string
  role?: string
  teamId?: string
  status: string
  expiresAt: Date
  createdAt: Date
  inviterId: string
}

export type Invitation = InvitationFields

export type JwksFields = {
  publicKey: string
  privateKey: string
  createdAt: Date
  expiresAt?: Date
}

export type Jwks = JwksFields

export type TwoFactorFields = {
  secret: string
  backupCodes: string
  userId: string
  verified?: boolean
}

export type TwoFactor = TwoFactorFields

/**
 * Union of all supported plugin identifiers.
 */
export type PluginId = "username" | "admin" | "api-key" | "passkey" | "bearer" | "email-otp" | "magic-link" | "phone-number" | "one-tap" | "anonymous" | "multi-session" | "one-time-token" | "oauth-provider" | "generic-oauth" | "open-api" | "organization" | "jwt" | "two-factor"

/**
 * Complete schema mapping of all models to their types.
 */
export type BetterAuthFullSchema = {
  "user": User
  "session": Session
  "account": Account
  "verification": Verification
  "apikey": Apikey
  "passkey": Passkey
  "oauthClient": OauthClient
  "oauthRefreshToken": OauthRefreshToken
  "oauthAccessToken": OauthAccessToken
  "oauthConsent": OauthConsent
  "organization": Organization
  "team": Team
  "teamMember": TeamMember
  "member": Member
  "invitation": Invitation
  "jwks": Jwks
  "twoFactor": TwoFactor
}

/**
 * Union of all model names in the schema.
 */
export type ModelKey = keyof BetterAuthFullSchema
