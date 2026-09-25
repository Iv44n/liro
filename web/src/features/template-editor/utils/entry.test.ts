import { describe, expect, it } from 'vitest'
import {
  asStructured,
  entryMode,
  entryToJson,
  insertAt,
  isBlankEntry,
  parseEntryJson,
  setStructuredKey,
  structuredText,
  structuredToText,
  textToStructured
} from './entry'

describe('asStructured() / entryMode()', () => {
  it('accepts an object of only known keys, string or (for list keys) string[]', () => {
    expect(asStructured({ question: 'x', focus: 'y' }, 'instructions')).toEqual(
      {
        question: 'x',
        focus: 'y'
      }
    )
    expect(asStructured({ inspect: ['a', 'b'] }, 'instructions')).toEqual({
      inspect: ['a', 'b']
    })
  })

  it('rejects unknown keys, a non-list key holding an array, or an array/string entry', () => {
    expect(asStructured({ other: 'x' }, 'instructions')).toBeNull()
    expect(asStructured({ question: ['x'] }, 'instructions')).toBeNull()
    expect(asStructured(['x'], 'instructions')).toBeNull()
  })

  it('treats null/undefined as an empty structured entry (mode "text")', () => {
    expect(asStructured(null, 'instructions')).toEqual({})
    expect(entryMode(null, 'instructions')).toBe('text')
    expect(entryMode(undefined, 'criteria')).toBe('text')
  })

  it('picks "structured" or "json" for object entries', () => {
    expect(entryMode({ what: 'x' }, 'criteria')).toBe('structured')
    expect(entryMode({ other: 'x' }, 'criteria')).toBe('json')
    expect(entryMode(['x'], 'criteria')).toBe('json')
  })
})

describe('structuredText() / setStructuredKey()', () => {
  it('joins a list value with newlines for display', () => {
    expect(structuredText(['a', 'b'])).toBe('a\nb')
    expect(structuredText('a')).toBe('a')
    expect(structuredText(undefined)).toBe('')
  })

  const inspectSpec = {
    key: 'inspect',
    label: 'Revisar',
    list: true,
    placeholder: ''
  }
  const questionSpec = {
    key: 'question',
    label: 'Pregunta',
    list: false,
    placeholder: ''
  }

  it('a non-list key: blank text removes the key', () => {
    expect(setStructuredKey({ question: 'x' }, questionSpec, '  ')).toEqual(
      null
    )
    expect(setStructuredKey({}, questionSpec, 'y')).toEqual({ question: 'y' })
  })

  it('a list key: single line keeps a string shape once it was one; else becomes an array', () => {
    expect(setStructuredKey({}, inspectSpec, 'one')).toEqual({
      inspect: ['one']
    })
    expect(
      setStructuredKey({ inspect: 'one' }, inspectSpec, 'still one')
    ).toEqual({
      inspect: 'still one'
    })
    expect(setStructuredKey({}, inspectSpec, 'a\nb')).toEqual({
      inspect: ['a', 'b']
    })
    expect(setStructuredKey({ inspect: ['a'] }, inspectSpec, '  \n ')).toEqual(
      null
    )
  })
})

describe('structuredToText() / textToStructured()', () => {
  it('round-trips a single-field entry losslessly enough to keep the content', () => {
    const text = 'lo que hay que preguntar'
    const structured = textToStructured(text, 'instructions')
    expect(structured).toEqual({ question: text })
    expect(structuredToText(structured, 'instructions')).toBe(text)
  })

  it('renders list items as "- item" lines, blocks separated by a blank line', () => {
    const text = structuredToText(
      { question: 'q', inspect: ['a', 'b'] },
      'instructions'
    )
    expect(text).toBe('q\n\n- a\n- b')
  })

  it('blank text converts to an empty structured object', () => {
    expect(textToStructured('  ', 'instructions')).toEqual({})
  })
})

describe('parseEntryJson()', () => {
  it('blank text is "no entry" (null)', () => {
    expect(parseEntryJson('')).toEqual({ ok: true, entry: null })
  })

  it('accepts a JSON string, object or array', () => {
    expect(parseEntryJson('"hola"')).toEqual({ ok: true, entry: 'hola' })
    expect(parseEntryJson('{"a":1}')).toEqual({ ok: true, entry: { a: 1 } })
    expect(parseEntryJson('[1,2]')).toEqual({ ok: true, entry: [1, 2] })
  })

  it('rejects invalid JSON, an empty string, numbers and booleans', () => {
    expect(parseEntryJson('{not json}').ok).toBe(false)
    expect(parseEntryJson('""').ok).toBe(false)
    expect(parseEntryJson('42').ok).toBe(false)
    expect(parseEntryJson('true').ok).toBe(false)
  })
})

describe('entryToJson() / isBlankEntry()', () => {
  it('pretty-prints, blank for null/undefined', () => {
    expect(entryToJson({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(entryToJson(null)).toBe('')
    expect(entryToJson(undefined)).toBe('')
  })

  it('a blank entry is null, undefined, or an all-whitespace string', () => {
    expect(isBlankEntry(null)).toBe(true)
    expect(isBlankEntry(undefined)).toBe(true)
    expect(isBlankEntry('   ')).toBe(true)
    expect(isBlankEntry('x')).toBe(false)
    expect(isBlankEntry({})).toBe(false)
  })
})

describe('insertAt()', () => {
  it('inserts at the caret and reports the new caret position', () => {
    expect(insertAt('ab', '`x`', 1)).toEqual({ text: 'a`x`b', caret: 4 })
  })

  it('replaces a selection [start, end)', () => {
    expect(insertAt('hello world', 'bye', 6, 11)).toEqual({
      text: 'hello bye',
      caret: 9
    })
  })

  it('clamps out-of-range offsets', () => {
    expect(insertAt('ab', 'X', -5, 50)).toEqual({ text: 'X', caret: 1 })
  })
})
