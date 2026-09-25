import { describe, expect, it } from 'vitest'
import { pendingReviewsBadge } from './app-sidebar'
import { isNavItemActive } from './nav-main'

describe('isNavItemActive()', () => {
  it('matches the page and its sub-pages only', () => {
    expect(isNavItemActive('/runs', '/runs')).toBe(true)
    expect(isNavItemActive('/runs/run_1', '/runs')).toBe(true)
    expect(isNavItemActive('/decisions/new', '/decisions')).toBe(true)
    expect(isNavItemActive('/runsx', '/runs')).toBe(false)
    expect(isNavItemActive('/dashboard', '/runs')).toBe(false)
  })
})

describe('pendingReviewsBadge()', () => {
  it('hides the badge when nothing is pending or still loading', () => {
    expect(pendingReviewsBadge(undefined)).toBeUndefined()
    expect(pendingReviewsBadge(0)).toBeUndefined()
  })

  it('describes the count in Spanish and caps it at 99+', () => {
    expect(pendingReviewsBadge(1)).toEqual({
      value: 1,
      label: '1 revisión pendiente'
    })
    expect(pendingReviewsBadge(7)).toEqual({
      value: 7,
      label: '7 revisiones pendientes'
    })
    expect(pendingReviewsBadge(250)).toEqual({
      value: '99+',
      label: '250 revisiones pendientes'
    })
  })
})
