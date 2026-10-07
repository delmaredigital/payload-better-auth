/**
 * `roleField` (issue #41): one setting that names the property every role check
 * reads. Each test runs with `roles` (an array) as the field and proves the
 * default `role` property is NOT what grants access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CollectionConfig, Config, Endpoint, PayloadRequest } from 'payload'
import {
  betterAuthCollections,
  createFirstUserAdminHooks,
} from '../../src/adapter/collections.js'
import { createBetterAuthPlugin } from '../../src/plugin/index.js'
import {
  DEFAULT_ROLE_FIELD,
  canUpdateOwnFields,
  getRoleField,
  hasAdminRoles,
  hasAllRoles,
  hasAnyRole,
  hasRole,
  hasRoleField,
  isAdmin,
  isAdminField,
  isAdminOrSelf,
  requireAllRoles,
} from '../../src/utils/access.js'

const betterAuthOptions = {
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      roles: { type: 'string[]' as const, input: false },
    },
  },
}

const usersCollection: CollectionConfig = {
  slug: 'users',
  auth: { disableLocalStrategy: true },
  fields: [{ name: 'roles', type: 'json' }],
}

/** Run betterAuthCollections over a minimal config and return the result. */
function buildCollectionsConfig(
  options: Parameters<typeof betterAuthCollections>[0] = {}
): Config {
  const plugin = betterAuthCollections({ betterAuthOptions, ...options })
  return plugin({ collections: [usersCollection] } as unknown as Config) as Config
}

/** A request whose Payload config carries the resolved roleField. */
function reqFor(user: Record<string, unknown> | null, roleField?: string): PayloadRequest {
  return {
    user,
    payload: {
      config: roleField ? { custom: { betterAuth: { roleField } } } : {},
    },
  } as unknown as PayloadRequest
}

describe('hasAnyRole / hasAllRoles with a roleField', () => {
  it('reads the named property instead of `role`', () => {
    const user = { role: 'admin', roles: ['editor', 'viewer'] }
    expect(hasAnyRole(user, ['editor'], 'roles')).toBe(true)
    expect(hasAnyRole(user, ['admin'], 'roles')).toBe(false)
    expect(hasAllRoles(user, ['editor', 'viewer'], 'roles')).toBe(true)
    expect(hasAllRoles(user, ['editor', 'admin'], 'roles')).toBe(false)
  })

  it('keeps reading `role` when no roleField is passed', () => {
    const user = { role: ['admin'], roles: ['editor'] }
    expect(hasAnyRole(user, ['admin'])).toBe(true)
    expect(hasAnyRole(user, ['editor'])).toBe(false)
    expect(hasAllRoles(user, ['admin'])).toBe(true)
  })

  it('denies a user missing the named property', () => {
    expect(hasAnyRole({ role: 'admin' }, ['admin'], 'roles')).toBe(false)
    expect(hasAllRoles({ role: 'admin' }, ['admin'], 'roles')).toBe(false)
    expect(hasAnyRole(null, ['admin'], 'roles')).toBe(false)
  })
})

describe('getRoleField', () => {
  it('defaults to `role`', () => {
    expect(DEFAULT_ROLE_FIELD).toBe('role')
    expect(getRoleField(undefined)).toBe('role')
    expect(getRoleField({})).toBe('role')
  })

  it('reads config.custom.betterAuth.roleField', () => {
    expect(getRoleField({ custom: { betterAuth: { roleField: 'roles' } } })).toBe('roles')
  })
})

describe('access helpers read roleField from the Payload config', () => {
  const admin = { id: 1, role: 'user', roles: ['admin'] }
  const roleOnlyAdmin = { id: 2, role: 'admin', roles: ['user'] }
  const editor = { id: 3, roles: ['editor', 'verified'] }

  it('isAdmin / isAdminField / hasAdminRoles', () => {
    expect(isAdmin()({ req: reqFor(admin, 'roles') } as never)).toBe(true)
    expect(isAdmin()({ req: reqFor(roleOnlyAdmin, 'roles') } as never)).toBe(false)
    expect(isAdminField()({ req: reqFor(admin, 'roles') } as never)).toBe(true)
    expect(isAdminField()({ req: reqFor(roleOnlyAdmin, 'roles') } as never)).toBe(false)
    expect(hasAdminRoles()({ req: reqFor(admin, 'roles') })).toBe(true)
  })

  it('hasRole / hasRoleField / requireAllRoles', () => {
    expect(hasRole(['editor'])({ req: reqFor(editor, 'roles') } as never)).toBe(true)
    expect(hasRoleField(['editor'])({ req: reqFor(editor, 'roles') } as never)).toBe(true)
    expect(
      requireAllRoles(['editor', 'verified'])({ req: reqFor(editor, 'roles') } as never)
    ).toBe(true)
    expect(
      requireAllRoles(['editor', 'admin'])({ req: reqFor(editor, 'roles') } as never)
    ).toBe(false)
    expect(hasRole(['admin'])({ req: reqFor(roleOnlyAdmin, 'roles') } as never)).toBe(false)
  })

  it('isAdminOrSelf scopes a non-admin to their own record', () => {
    expect(isAdminOrSelf()({ req: reqFor(admin, 'roles') } as never)).toBe(true)
    expect(isAdminOrSelf()({ req: reqFor(roleOnlyAdmin, 'roles') } as never)).toEqual({
      id: { equals: 2 },
    })
  })

  it('canUpdateOwnFields lets an admin update any record', async () => {
    const access = canUpdateOwnFields({ allowedFields: ['name'] })
    await expect(
      access({ req: reqFor(admin, 'roles'), id: 99, data: { roles: ['admin'] } } as never)
    ).resolves.toBe(true)
    await expect(
      access({ req: reqFor(roleOnlyAdmin, 'roles'), id: 99, data: { name: 'x' } } as never)
    ).resolves.toBe(false)
  })

  it('an explicit roleField on the helper beats the config', () => {
    const user = { id: 1, roles: ['user'], permissions: ['admin'] }
    expect(isAdmin({ roleField: 'permissions' })({ req: reqFor(user, 'roles') } as never)).toBe(
      true
    )
  })

  it('without a configured roleField the helpers keep reading `role`', () => {
    expect(isAdmin()({ req: reqFor(roleOnlyAdmin) } as never)).toBe(true)
    expect(isAdmin()({ req: reqFor(admin) } as never)).toBe(false)
  })
})

describe('betterAuthCollections roleField', () => {
  it('publishes the resolved roleField on config.custom.betterAuth', () => {
    const config = buildCollectionsConfig({ roleField: 'roles' })
    expect(getRoleField(config)).toBe('roles')
  })

  it('publishes `role` when nothing is configured', () => {
    expect(getRoleField(buildCollectionsConfig())).toBe('role')
  })

  it('keeps other config.custom.betterAuth keys', () => {
    const plugin = betterAuthCollections({ betterAuthOptions, roleField: 'roles' })
    const config = plugin({
      collections: [usersCollection],
      custom: { betterAuth: { authBasePath: '/auth' }, other: 1 },
    } as unknown as Config)
    expect(config.custom).toEqual({
      betterAuth: { authBasePath: '/auth', roleField: 'roles' },
      other: 1,
    })
  })

  it('accepts firstUserAdmin.roleField as the same setting (back-compat)', () => {
    const config = buildCollectionsConfig({ firstUserAdmin: { roleField: 'roles' } })
    expect(getRoleField(config)).toBe('roles')
  })

  it('accepts both spellings when they agree', () => {
    const config = buildCollectionsConfig({
      roleField: 'roles',
      firstUserAdmin: { roleField: 'roles' },
    })
    expect(getRoleField(config)).toBe('roles')
  })

  it('throws when roleField and firstUserAdmin.roleField disagree', () => {
    expect(() =>
      betterAuthCollections({
        betterAuthOptions,
        roleField: 'roles',
        firstUserAdmin: { roleField: 'role' },
      })
    ).toThrow(/roleField/)
  })

  it('throws on an empty roleField', () => {
    expect(() => betterAuthCollections({ betterAuthOptions, roleField: '' })).toThrow(
      /roleField/
    )
  })

  it('adds the configured field to the JWT, not `role`', () => {
    const plugin = betterAuthCollections({
      betterAuthOptions,
      roleField: 'roles',
      skipCollections: [],
    })
    // No users collection supplied, so the plugin generates one from the schema.
    const config = plugin({
      collections: [],
    } as unknown as Config)
    const users = config.collections?.find((c) => c.slug === 'users')
    expect(users).toBeDefined()
    const roles = users!.fields.find((f) => 'name' in f && f.name === 'roles')
    expect(roles).toMatchObject({ saveToJWT: true })
  })

  it('leaves a field literally named `role` out of the JWT when roleField is elsewhere', () => {
    const plugin = betterAuthCollections({
      betterAuthOptions: {
        user: {
          additionalFields: {
            role: { type: 'string' as const },
            roles: { type: 'string[]' as const },
          },
        },
      },
      roleField: 'roles',
      skipCollections: [],
    })
    const config = plugin({ collections: [] } as unknown as Config)
    const users = config.collections?.find((c) => c.slug === 'users')
    const role = users!.fields.find((f) => 'name' in f && f.name === 'role')
    const roles = users!.fields.find((f) => 'name' in f && f.name === 'roles')
    expect(role).not.toHaveProperty('saveToJWT')
    expect(roles).toMatchObject({ saveToJWT: true })
  })

  it('sets saveToJWT on a role field the consumer defined themselves', () => {
    // `usersCollection` declares `{ name: 'roles', type: 'json' }` — the field
    // exists, so augmentation skips it; without the patch it never reaches JWT.
    const config = buildCollectionsConfig({ roleField: 'roles' })
    const users = config.collections!.find((c) => c.slug === 'users')!
    const roles = users.fields.find((f) => 'name' in f && f.name === 'roles')
    expect(roles).toMatchObject({ saveToJWT: true })
  })

  it('respects an explicit saveToJWT on the consumer-defined role field', () => {
    const plugin = betterAuthCollections({ betterAuthOptions, roleField: 'roles' })
    const config = plugin({
      collections: [
        { ...usersCollection, fields: [{ name: 'roles', type: 'json', saveToJWT: false }] },
      ],
    } as unknown as Config)
    const roles = config.collections![0].fields.find(
      (f) => 'name' in f && f.name === 'roles'
    )
    expect(roles).toMatchObject({ saveToJWT: false })
  })

  it('the first-user-admin hook writes the configured field', async () => {
    const config = buildCollectionsConfig({ roleField: 'roles' })
    const users = config.collections!.find((c) => c.slug === 'users')!
    const before = (users.hooks!.beforeChange as Array<(a: unknown) => unknown>)[0]
    const req = { user: null, payload: { count: async () => ({ totalDocs: 0 }) } }
    const data = (await before({
      data: { email: 'first@x.com' },
      operation: 'create',
      req,
      context: {},
    })) as Record<string, unknown>
    expect(data.roles).toBe('admin')
    expect(data).not.toHaveProperty('role')
  })
})

describe('createFirstUserAdminHooks honors roleField for the creating admin', () => {
  const { before } = createFirstUserAdminHooks({ roleField: 'roles' }, 'users')

  function call(user: unknown, data: Record<string, unknown>) {
    const req = { user, payload: { count: async () => ({ totalDocs: 3 }) } }
    return before({ data, operation: 'create', req, context: {} } as never) as Promise<
      Record<string, unknown>
    >
  }

  it('an admin identified by `roles` may assign a role', async () => {
    const data = await call({ id: 1, roles: ['admin'] }, { roles: ['editor'] })
    expect(data.roles).toEqual(['editor'])
  })

  it('a `role: admin` user without admin in `roles` cannot', async () => {
    const data = await call({ id: 1, role: 'admin', roles: ['user'] }, { roles: ['admin'] })
    expect(data.roles).toBe('user')
  })
})

describe('API-key gate reads roleField end to end', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  async function setup(dbUser: Record<string, unknown>) {
    const getSession = vi.fn(async () => ({ user: { id: 'u1' }, session: { id: 's1' } }))
    const handler = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    const auth = { options: { baseURL: 'https://example.com' }, api: { getSession }, handler }

    // Same order as the README: collections first, then the main plugin.
    let config = betterAuthCollections({ betterAuthOptions, roleField: 'roles' })({
      collections: [usersCollection],
      routes: { api: '/api', admin: '/admin' },
    } as unknown as Config) as Config
    config = createBetterAuthPlugin({ createAuth: () => auth })(config) as Config

    const payload = { config, findByID: vi.fn(async () => dbUser) }
    await config.onInit?.(payload as never)
    const endpoint = (config.endpoints ?? []).find(
      (e: Endpoint) => e.method === 'get' && e.path.startsWith('/auth')
    )!
    const req = {
      method: 'GET',
      pathname: '/api/auth/api-key/list',
      url: 'https://example.com/api/auth/api-key/list',
      headers: new Headers({ cookie: 'better-auth.session_token=abc' }),
      payload,
    } as unknown as PayloadRequest
    return { res: await endpoint.handler(req), handler }
  }

  it('lets a user with admin in `roles` manage API keys', async () => {
    const { res, handler } = await setup({ id: 'u1', roles: ['admin'] })
    expect(res.status).toBe(200)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('refuses a user whose admin role sits only in `role`', async () => {
    const { res, handler } = await setup({ id: 'u1', role: 'admin', roles: ['user'] })
    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })
})
