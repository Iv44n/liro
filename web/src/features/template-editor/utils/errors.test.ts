import { describe, expect, it } from 'vitest'
import { AppError } from '#/sdk/core/app.error'
import { draftValidationIssues, errorCode, errorText } from './errors'

describe('errorText()', () => {
  it('translates a known error code to Spanish', () => {
    const error = new AppError({ code: 'DRAFT_CONFLICT', message: 'stale' })
    expect(errorText(error)).toBe(
      'Alguien guardó otros cambios en este borrador desde que lo abriste.'
    )
  })

  it('gives a generic message for a 5xx with no known code', () => {
    const error = new AppError({
      code: 'SOMETHING_ELSE',
      message: 'boom',
      status: 502
    })
    expect(errorText(error)).toContain('servidor')
  })

  it('falls back to the network message for a non-AppError', () => {
    expect(errorText(new Error('network down'))).toContain('conectar')
  })
})

describe('errorCode()', () => {
  it('reads the AppError code, UNKNOWN_ERROR otherwise', () => {
    expect(errorCode(new AppError({ code: 'NO_CHANGES', message: 'x' }))).toBe(
      'NO_CHANGES'
    )
    expect(errorCode(new Error('x'))).toBe('UNKNOWN_ERROR')
  })
})

describe('draftValidationIssues()', () => {
  it('strips the leading "definition." the save endpoint prefixes', () => {
    const error = new AppError({
      code: 'VALIDATION_FAILED',
      message: 'bad',
      details: {
        issues: [
          {
            path: 'definition.input.fields.0.path',
            message: 'Invalid',
            code: 'custom'
          },
          { path: 'definition', message: 'Invalid', code: 'custom' }
        ]
      }
    })
    expect(draftValidationIssues(error)).toEqual([
      { path: 'input.fields.0.path', message: 'Invalid' },
      { path: '', message: 'Invalid' }
    ])
  })

  it('is empty when there are no issues', () => {
    expect(draftValidationIssues(new Error('x'))).toEqual([])
  })
})
