import { describe, expect, it } from 'vitest'
import {
  backtickedPaths,
  declaredPaths,
  insertReference,
  unknownReferences
} from './instructions'

describe('backtickedPaths()', () => {
  it('keeps only dotted identifier tokens', () => {
    expect(
      backtickedPaths(
        'Lee `ticket.message` y `ticket.subject`; elige `bug` o `a.b-c`.'
      )
    ).toEqual(['ticket.message', 'ticket.subject'])
    expect(backtickedPaths('sin referencias')).toEqual([])
  })
})

describe('declaredPaths()', () => {
  it('includes the implied parent objects', () => {
    expect([...declaredPaths(['ticket.message', 'text'])].sort()).toEqual([
      'text',
      'ticket',
      'ticket.message'
    ])
  })
})

describe('unknownReferences()', () => {
  it('reports undeclared dotted references once, in order', () => {
    expect(
      unknownReferences(
        [
          'Lee `ticket.message`, `ticket.body` y `customer.plan`.',
          'Otra vez `ticket.body`.'
        ],
        ['ticket.message', 'ticket.subject']
      )
    ).toEqual(['ticket.body', 'customer.plan'])
  })

  it('accepts references to implied objects', () => {
    expect(
      unknownReferences(['`order.customer`'], ['order.customer.name'])
    ).toEqual([])
  })
})

describe('insertReference()', () => {
  it('inserts at the caret with a separating space', () => {
    expect(insertReference('Lee', 3, 3, 'text')).toEqual({
      text: 'Lee `text`',
      caret: 10
    })
  })

  it('does not add a space at the start or after whitespace', () => {
    expect(insertReference('', 0, 0, 'text')).toEqual({
      text: '`text`',
      caret: 6
    })
    expect(insertReference('Lee  y más', 4, 4, 'a.b')).toEqual({
      text: 'Lee `a.b` y más',
      caret: 9
    })
  })

  it('replaces the selection and clamps out-of-range positions', () => {
    expect(insertReference('Lee XXX.', 4, 7, 'text').text).toBe('Lee `text`.')
    expect(insertReference('Hola', 99, 120, 'x.y').text).toBe('Hola `x.y`')
  })
})
