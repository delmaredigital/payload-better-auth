import { describe, it, expectTypeOf } from 'vitest'
import type { User, WithRoleField } from '../../src/index.js'

describe('WithRoleField', () => {
  it('moves `role` to the configured name', () => {
    type AppUser = WithRoleField<User, 'roles', string[]>
    expectTypeOf<AppUser['roles']>().toEqualTypeOf<string[] | undefined>()
    expectTypeOf<AppUser>().not.toHaveProperty('role')
    expectTypeOf<AppUser['email']>().toEqualTypeOf<string>()
  })

  it('keeps the default name when no field is given', () => {
    expectTypeOf<WithRoleField<User>['role']>().toEqualTypeOf<string | string[] | undefined>()
  })
})
