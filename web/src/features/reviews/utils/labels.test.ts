import { describe, expect, it } from 'vitest'
import {
  decisionForKey,
  decisionOptions,
  isReviewTab,
  isShortcutEvent,
  REVIEW_REASON_LABELS
} from './labels'

describe('REVIEW_REASON_LABELS', () => {
  it('names every reason in Spanish', () => {
    expect(REVIEW_REASON_LABELS.low_confidence.label).toBe('Confianza baja')
    expect(REVIEW_REASON_LABELS.always_review.label).toBe('Siempre revisar')
    expect(REVIEW_REASON_LABELS.rule.label).toBe('Regla')
    expect(REVIEW_REASON_LABELS.fallback.label).toBe('Sin regla')
  })
})

describe('decisionOptions()', () => {
  it('numbers the allowed decisions and marks the suggestion', () => {
    const options = decisionOptions({
      allowedDecisions: ['approve', 'reject'],
      decisions: [
        { label: 'reject', description: 'No cumple' },
        { label: 'approve', description: null }
      ],
      suggestedDecision: 'reject'
    })

    expect(options).toEqual([
      {
        label: 'approve',
        description: null,
        shortcut: '1',
        suggested: false
      },
      {
        label: 'reject',
        description: 'No cumple',
        shortcut: '2',
        suggested: true
      }
    ])
    expect(decisionForKey(options, '2')?.label).toBe('reject')
    expect(decisionForKey(options, '3')).toBeUndefined()
  })

  it('stops numbering after nine decisions', () => {
    const labels = Array.from({ length: 11 }, (_, i) => `l${i}`)
    const options = decisionOptions({
      allowedDecisions: labels,
      decisions: [],
      suggestedDecision: null
    })

    expect(options[8]?.shortcut).toBe('9')
    expect(options[9]?.shortcut).toBeNull()
    expect(options.some(option => option.suggested)).toBe(false)
  })
})

describe('isShortcutEvent()', () => {
  const base = {
    key: '1',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    target: { tagName: 'BODY' } as unknown as EventTarget
  }

  it('accepts a bare digit outside of text fields', () => {
    expect(isShortcutEvent(base)).toBe(true)
    expect(
      isShortcutEvent({
        ...base,
        target: { tagName: 'BUTTON' } as unknown as EventTarget
      })
    ).toBe(true)
  })

  it('ignores typing, modifiers, repeats and other keys', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(
        isShortcutEvent({
          ...base,
          target: { tagName } as unknown as EventTarget
        })
      ).toBe(false)
    }
    expect(
      isShortcutEvent({
        ...base,
        target: {
          tagName: 'DIV',
          isContentEditable: true
        } as unknown as EventTarget
      })
    ).toBe(false)
    expect(isShortcutEvent({ ...base, ctrlKey: true })).toBe(false)
    expect(isShortcutEvent({ ...base, metaKey: true })).toBe(false)
    expect(isShortcutEvent({ ...base, repeat: true })).toBe(false)
    expect(isShortcutEvent({ ...base, key: '0' })).toBe(false)
    expect(isShortcutEvent({ ...base, key: 'a' })).toBe(false)
  })
})

describe('isReviewTab()', () => {
  it('accepts the inbox tabs only', () => {
    expect(isReviewTab('pending')).toBe(true)
    expect(isReviewTab('expired')).toBe(false)
    expect(isReviewTab(undefined)).toBe(false)
  })
})
