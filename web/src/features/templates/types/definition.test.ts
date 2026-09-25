import { describe, expect, it } from 'vitest'
import {
  CHANGE_SEVERITY,
  type Condition,
  decisionLabels,
  hasLintErrors,
  isComparison,
  isInputPath,
  isKey,
  isLabel,
  isSlug,
  type TemplateDefinition
} from './definition'
import { DEFAULT_EDITOR_TAB, isEditorTab, parseEditorTab } from './editor'

describe('name rules (mirroring the API)', () => {
  it('accepts lower_snake_case keys only', () => {
    expect(isKey('category')).toBe(true)
    expect(isKey('is_spam_2')).toBe(true)
    expect(isKey('2fa')).toBe(false)
    expect(isKey('Category')).toBe(false)
    expect(isKey('with-dash')).toBe(false)
    expect(isKey('a'.repeat(65))).toBe(false)
  })

  it('accepts labels joined by _ or - but no leading/trailing separators', () => {
    expect(isLabel('billing')).toBe(true)
    expect(isLabel('needs-info')).toBe(true)
    expect(isLabel('tier_2')).toBe(true)
    expect(isLabel('1')).toBe(true)
    expect(isLabel('-bad')).toBe(false)
    expect(isLabel('bad_')).toBe(false)
    expect(isLabel('a__b')).toBe(false)
    expect(isLabel('Upper')).toBe(false)
  })

  it('rejects names that collide with Object.prototype', () => {
    expect(isKey('constructor')).toBe(false)
    expect(isLabel('constructor')).toBe(false)
    expect(isKey('__proto__')).toBe(false)
    expect(isInputPath('ticket.__proto__')).toBe(false)
  })

  it('validates dot paths into the input', () => {
    expect(isInputPath('message')).toBe(true)
    expect(isInputPath('ticket.customer_tier')).toBe(true)
    expect(isInputPath('Ticket.Body')).toBe(true)
    expect(isInputPath('ticket..message')).toBe(false)
    expect(isInputPath('ticket.1st')).toBe(false)
    expect(isInputPath('')).toBe(false)
    expect(isInputPath('a.b.c.d.e.f')).toBe(true)
    expect(isInputPath('a.b.c.d.e.f.g')).toBe(false)
  })

  it('validates slugs', () => {
    expect(isSlug('ticket-triage')).toBe(true)
    expect(isSlug('v2')).toBe(true)
    expect(isSlug('ticket--triage')).toBe(false)
    expect(isSlug('ticket_triage')).toBe(false)
    expect(isSlug('-x')).toBe(false)
    expect(isSlug('a'.repeat(65))).toBe(false)
  })
})

describe('definition helpers', () => {
  it('tells comparisons from boolean groups', () => {
    const comparison: Condition = {
      op: 'eq',
      left: { input: 'plan' },
      right: { value: 'pro' }
    }
    expect(isComparison(comparison)).toBe(true)
    expect(isComparison({ all: [comparison] })).toBe(false)
    expect(isComparison({ not: comparison })).toBe(false)
  })

  it('lists decision labels in order', () => {
    const definition = {
      decisions: [{ label: 'yes' }, { label: 'no' }]
    } as TemplateDefinition
    expect(decisionLabels(definition)).toEqual(['yes', 'no'])
  })

  it('detects blocking lint issues', () => {
    expect(hasLintErrors([])).toBe(false)
    expect(
      hasLintErrors([
        { severity: 'warning', code: 'UNUSED_QUESTION', message: '', path: '' }
      ])
    ).toBe(false)
    expect(
      hasLintErrors([
        { severity: 'error', code: 'NO_DECISIONS', message: '', path: '' }
      ])
    ).toBe(true)
  })

  it('keeps the change severities of the API', () => {
    expect(CHANGE_SEVERITY.LABEL_ADDED).toBe('breaking')
    expect(CHANGE_SEVERITY.POLICY_CHANGED).toBe('behavior')
    expect(CHANGE_SEVERITY.DESCRIPTION_CHANGED).toBe('compatible')
  })
})

describe('editor tabs', () => {
  it('parses the tab search param with a default', () => {
    expect(parseEditorTab('policy')).toBe('policy')
    expect(parseEditorTab('nope')).toBe(DEFAULT_EDITOR_TAB)
    expect(parseEditorTab(undefined)).toBe('questions')
    expect(isEditorTab('integrate')).toBe(true)
    expect(isEditorTab(3)).toBe(false)
  })
})
