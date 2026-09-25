import { describe, expect, it } from 'vitest'
import type { LintIssue } from '#/features/templates/types/definition'
import {
  describeLintIssue,
  formatIssuePath,
  issueCountsByTab,
  tabForPath
} from './lint'

describe('tabForPath()', () => {
  it('maps every section to its editor tab', () => {
    expect(tabForPath('input.fields.0.path')).toBe('input')
    expect(tabForPath('state.include.0')).toBe('input')
    expect(tabForPath('questions.category')).toBe('questions')
    expect(tabForPath('decisions.0.label')).toBe('decisions')
    expect(tabForPath('rules.0.when')).toBe('policy')
    expect(tabForPath('fallback.decision')).toBe('policy')
    expect(tabForPath('')).toBeNull()
    expect(tabForPath('model')).toBeNull()
  })
})

describe('describeLintIssue()', () => {
  it("builds the Spanish sentence from the message's backticked tokens", () => {
    const issue: LintIssue = {
      severity: 'error',
      code: 'UNKNOWN_LABEL',
      message: '`urgent` is not a declared decision',
      path: 'rules.0.decision'
    }
    const described = describeLintIssue(issue)
    expect(described.title).toBe('Decisión desconocida')
    expect(described.detail).toBe('`urgent` no es una decisión declarada.')
    expect(described.untranslated).toBe(false)
  })

  it('falls back to the API message for an unknown code', () => {
    const issue: LintIssue = {
      severity: 'warning',
      code: 'SOME_NEW_CODE',
      message: 'Something the editor does not know yet',
      path: ''
    }
    const described = describeLintIssue(issue)
    expect(described.detail).toBe(issue.message)
    expect(described.untranslated).toBe(true)
  })
})

describe('issueCountsByTab()', () => {
  it('counts errors and warnings per tab, skipping paths with no tab', () => {
    const counts = issueCountsByTab([
      { severity: 'error', path: 'questions.a' },
      { severity: 'warning', path: 'questions.b' },
      { severity: 'error', path: 'decisions.0' },
      { severity: 'error', path: 'model' }
    ])
    expect(counts.questions).toEqual({ errors: 1, warnings: 1 })
    expect(counts.decisions).toEqual({ errors: 1, warnings: 0 })
    expect(counts.policy).toBeUndefined()
  })
})

describe('formatIssuePath()', () => {
  it('renders dots as › separators, and a friendly label for the empty path', () => {
    expect(formatIssuePath('questions.category.instructions')).toBe(
      'questions › category › instructions'
    )
    expect(formatIssuePath('')).toBe('Definición completa')
  })
})
