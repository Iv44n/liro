import { describe, expect, it } from 'vitest'
import { can, isOwner } from './permissions'
import { slugify } from './slug'

describe('can()', () => {
  it('grants organization management to owners and admins only', () => {
    expect(can('owner', 'org:delete')).toBe(true)
    expect(can('admin', 'org:delete')).toBe(false)
    expect(can('admin', 'invitation:create')).toBe(true)
    expect(can('member', 'invitation:create')).toBe(false)
  })

  it('handles comma-separated roles and missing roles', () => {
    expect(can('member, admin', 'member:remove')).toBe(true)
    expect(can(null, 'member:list')).toBe(false)
    expect(can(undefined, 'org:leave')).toBe(false)
  })

  it('detects owners among multiple roles', () => {
    expect(isOwner('admin,owner')).toBe(true)
    expect(isOwner('admin')).toBe(false)
  })
})

describe('slugify()', () => {
  it('produces stable, URL-safe slugs', () => {
    expect(slugify('Mi Organización Ñandú')).toBe('mi-organizacion-nandu')
    expect(slugify('  ---  ')).toBe('organizacion')
  })
})
