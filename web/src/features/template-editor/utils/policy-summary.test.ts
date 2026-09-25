import { describe, expect, it } from 'vitest'
import type {
  Condition,
  DecisionRule,
  FlagRule
} from '#/features/templates/types/definition'
import {
  describeCondition,
  describeFallback,
  describeFlagRules,
  describeOperand,
  describeRules,
  describeSignal,
  describeTarget
} from './policy-summary'

describe('describeOperand()', () => {
  it('describes every operand kind', () => {
    expect(describeOperand({ answer: 'category', field: 'confidence' })).toBe(
      '`category.confidence`'
    )
    expect(
      describeOperand({ answer: 'category', field: 'prob', option: 'billing' })
    ).toBe('`category.prob(billing)`')
    expect(describeOperand({ signal: 'risk' })).toBe('señal `risk`')
    expect(describeOperand({ flag: 'urgent' })).toBe('flag `urgent`')
    expect(describeOperand({ input: 'ticket.message' })).toBe(
      '`ticket.message`'
    )
    expect(describeOperand({ value: 0.8 })).toBe('0.8')
    expect(describeOperand({ value: 'urgente' })).toBe('"urgente"')
    expect(describeOperand({ value: null })).toBe('nulo')
  })
})

describe('describeCondition()', () => {
  it('renders a comparison with its symbol', () => {
    const condition: Condition = {
      op: 'gte',
      left: { answer: 'category', field: 'confidence' },
      right: { value: 0.8 }
    }
    expect(describeCondition(condition)).toBe('`category.confidence` ≥ 0.8')
  })

  it('renders exists, in and between', () => {
    expect(
      describeCondition({ op: 'exists', left: { input: 'ticket.vip' } })
    ).toBe('`ticket.vip` existe')
    expect(
      describeCondition({
        op: 'in',
        left: { input: 'ticket.tag' },
        right: [{ value: 'a' }, { value: 'b' }]
      })
    ).toBe('`ticket.tag` está en ("a", "b")')
    expect(
      describeCondition({
        op: 'between',
        left: { signal: 'risk' },
        right: [{ value: 0 }, { value: 1 }]
      })
    ).toBe('señal `risk` está entre 0 y 1')
  })

  it('joins `all` with "y" and `any` with "o"', () => {
    const condition: Condition = {
      all: [
        { op: 'exists', left: { input: 'a' } },
        { op: 'exists', left: { input: 'b' } }
      ]
    }
    expect(describeCondition(condition)).toBe('`a` existe y `b` existe')

    const any: Condition = {
      any: [
        { op: 'exists', left: { input: 'a' } },
        { op: 'exists', left: { input: 'b' } }
      ]
    }
    expect(describeCondition(any)).toBe('`a` existe o `b` existe')
  })

  it('treats an empty `all` as always true and `any` as always false', () => {
    expect(describeCondition({ all: [] })).toBe('siempre')
    expect(describeCondition({ any: [] })).toBe('nunca')
  })

  it('parenthesizes a compound child of a combinator, and negates `not`', () => {
    const condition: Condition = {
      all: [
        { op: 'exists', left: { input: 'a' } },
        {
          any: [
            { op: 'exists', left: { input: 'b' } },
            { op: 'exists', left: { input: 'c' } }
          ]
        }
      ]
    }
    expect(describeCondition(condition)).toBe(
      '`a` existe y (`b` existe o `c` existe)'
    )

    expect(
      describeCondition({ not: { op: 'exists', left: { input: 'a' } } })
    ).toBe('no se cumple que `a` existe')
  })
})

describe('describeTarget()', () => {
  it('describes a fixed label and a fromAnswer target', () => {
    expect(describeTarget('approve')).toBe('`approve`')
    expect(describeTarget({ fromAnswer: 'category' })).toBe(
      'según la respuesta de `category`'
    )
  })
})

describe('describeRules()', () => {
  it('numbers rules in match order and includes their name', () => {
    const rules: DecisionRule[] = [
      {
        id: 'r1',
        name: 'Alta confianza',
        when: {
          op: 'gte',
          left: { answer: 'category', field: 'confidence' },
          right: { value: 0.8 }
        },
        decision: { fromAnswer: 'category' }
      },
      { id: 'r2', when: { all: [] }, decision: 'needs_review' }
    ]
    expect(describeRules(rules)).toEqual([
      {
        id: 'r1',
        position: 1,
        text: 'si `category.confidence` ≥ 0.8 → según la respuesta de `category` (Alta confianza)'
      },
      { id: 'r2', position: 2, text: 'si siempre → `needs_review`' }
    ])
  })
})

describe('describeFlagRules()', () => {
  it('lists the flags a rule adds', () => {
    const rules: FlagRule[] = [
      {
        id: 'f1',
        when: { op: 'exists', left: { input: 'ticket.vip' } },
        flags: ['priority', 'notify']
      }
    ]
    expect(describeFlagRules(rules)).toEqual([
      {
        id: 'f1',
        position: 1,
        text: 'si `ticket.vip` existe → añade `priority`, `notify`'
      }
    ])
  })
})

describe('describeSignal()', () => {
  it('describes a weighted signal', () => {
    expect(
      describeSignal({
        name: 'risk',
        kind: 'weighted',
        terms: [
          { operand: { answer: 'category', field: 'confidence' }, weight: 0.7 },
          { operand: { input: 'ticket.age' }, weight: 0.3, invert: true }
        ]
      })
    ).toBe(
      '`risk` = media ponderada de `category.confidence` × 0.7 + `ticket.age` invertido × 0.3'
    )
  })

  it('describes min/max/mean signals', () => {
    expect(
      describeSignal({
        name: 'lowest',
        kind: 'min',
        of: [{ input: 'a' }, { input: 'b' }]
      })
    ).toBe('`lowest` = mínimo de `a`, `b`')
    expect(
      describeSignal({ name: 'avg', kind: 'mean', of: [{ input: 'a' }] })
    ).toBe('`avg` = promedio de `a`')
  })
})

describe('describeFallback()', () => {
  it('describes the catch-all decision', () => {
    expect(describeFallback({ decision: 'needs_review' })).toBe(
      'si ninguna regla coincide → `needs_review`'
    )
  })
})
