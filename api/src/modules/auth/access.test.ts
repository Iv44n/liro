import { describe, expect, test } from 'bun:test'
import { can } from './access'

describe('can()', () => {
  test.each([
    ['owner', { template: ['publish'] }, true],
    ['admin', { template: ['publish'] }, true],
    ['member', { template: ['publish'] }, false],
    ['member', { template: ['create', 'update'] }, true],
    ['member', { review: ['resolve'] }, true],
    ['member', { apiKey: ['read'] }, true],
    ['member', { apiKey: ['create'] }, false],
    ['member', { webhook: ['manage'] }, false],
    ['admin', { apiKey: ['create', 'delete'] }, true],
    ['admin', { organization: ['delete'] }, false],
    ['owner', { organization: ['delete'] }, true]
  ] as const)('%s → %o = %p', (role, permission, expected) => {
    expect(can(role, permission)).toBe(expected)
  })

  test('accepts comma-separated roles (better-auth stores multiple roles that way)', () => {
    expect(can('member, admin', { template: ['publish'] })).toBe(true)
  })

  test('unknown roles are denied', () => {
    expect(can('superuser', { template: ['create'] })).toBe(false)
  })

  test('every requested action must be granted', () => {
    expect(can('member', { template: ['create', 'publish'] })).toBe(false)
  })
})
