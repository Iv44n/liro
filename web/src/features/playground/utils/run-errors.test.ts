import { describe, expect, it } from 'vitest'
import type { InputField } from '#/features/templates/types/definition'
import { AppError } from '#/sdk/core/app.error'
import type { ValidationIssue } from '#/sdk/modules/templates/types'
import {
  describeRunError,
  inputPathOf,
  mapValidationIssues,
  translateIssue
} from './run-errors'

describe('inputPathOf()', () => {
  it('strips the "input." prefix, and treats "input" itself as the root', () => {
    expect(inputPathOf('input.ticket.message')).toBe('ticket.message')
    expect(inputPathOf('input')).toBe('')
    expect(inputPathOf('source.labels.0.label')).toBeNull()
  })
})

describe('translateIssue()', () => {
  it('translates the common zod codes to Spanish', () => {
    expect(
      translateIssue({
        path: 'input.x',
        code: 'invalid_type',
        message: 'invalid_type: received undefined'
      })
    ).toBe('Campo obligatorio.')
    expect(
      translateIssue({
        path: 'input.x',
        code: 'invalid_type',
        message: 'invalid_type: received null'
      })
    ).toBe('No admite null: deja el campo vacío para omitirlo.')
    expect(
      translateIssue({
        path: 'input.x',
        code: 'invalid_type',
        message: 'invalid_type: expected string, received number'
      })
    ).toBe('Debe ser un texto.')
    expect(
      translateIssue({
        path: 'input.x',
        code: 'too_big',
        message: 'too_big: string must be <= 10 chars'
      })
    ).toBe('Máximo 10 caracteres.')
  })

  it('falls back to the API message for an unmapped code', () => {
    expect(
      translateIssue({ path: 'x', code: 'custom', message: 'a custom issue' })
    ).toBe('a custom issue')
  })
})

describe('mapValidationIssues()', () => {
  const fields: InputField[] = [
    { path: 'ticket.message', type: 'string', required: true },
    { path: 'tags', type: 'array', required: false }
  ]

  it('attaches an issue to the field whose path it or a prefix of it is', () => {
    const issues: ValidationIssue[] = [
      {
        path: 'input.ticket.message',
        code: 'invalid_type',
        message: 'invalid_type: received undefined'
      },
      { path: 'input.tags.0', code: 'invalid_type', message: 'x' }
    ]
    const { fieldErrors, issues: rest } = mapValidationIssues(fields, issues)
    expect(fieldErrors).toEqual({
      'ticket.message': 'Campo obligatorio.',
      tags: 'Tipo de dato incorrecto.'
    })
    expect(rest).toEqual([])
  })

  it('keeps a non-field issue (e.g. the whole input) out of fieldErrors', () => {
    const issues: ValidationIssue[] = [
      {
        path: 'input',
        code: 'invalid_type',
        message: 'invalid_type: expected object, received string'
      }
    ]
    const { fieldErrors, issues: rest } = mapValidationIssues(fields, issues)
    expect(fieldErrors).toEqual({})
    expect(rest).toEqual([{ path: '', message: 'Debe ser un objeto.' }])
  })

  it('keeps only the first issue per field', () => {
    const issues: ValidationIssue[] = [
      {
        path: 'input.ticket.message',
        code: 'too_big',
        message: 'too_big: <= 5'
      },
      { path: 'input.ticket.message', code: 'invalid_type', message: 'other' }
    ]
    const { fieldErrors } = mapValidationIssues(fields, issues)
    expect(fieldErrors['ticket.message']).toBe('Máximo 5 caracteres.')
  })
})

describe('describeRunError()', () => {
  it('gives lint issues from a LINT_FAILED error', () => {
    const error = new AppError({
      code: 'LINT_FAILED',
      message: 'lint failed',
      status: 422,
      details: {
        issues: [
          { severity: 'error', code: 'NO_DECISIONS', message: 'x', path: '' }
        ]
      }
    })
    const view = describeRunError(error)
    expect(view.title).toBe('La definición tiene errores')
    expect(view.retryable).toBe(false)
    expect(view.lint).toHaveLength(1)
  })

  it('maps VALIDATION_FAILED onto the given fields', () => {
    const fields: InputField[] = [
      { path: 'message', type: 'string', required: true }
    ]
    const error = new AppError({
      code: 'VALIDATION_FAILED',
      message: 'validation failed',
      status: 422,
      details: {
        issues: [
          {
            path: 'input.message',
            code: 'invalid_type',
            message: 'invalid_type: received undefined'
          }
        ]
      }
    })
    const view = describeRunError(error, fields)
    expect(view.fieldErrors).toEqual({ message: 'Campo obligatorio.' })
    expect(view.issues).toEqual([])
  })

  it('flags a rate-limit or Jev outage as retryable, with Spanish copy', () => {
    expect(
      describeRunError(
        new AppError({ code: 'RATE_LIMITED', message: '', status: 429 })
      ).retryable
    ).toBe(true)
    expect(
      describeRunError(
        new AppError({ code: 'JEV_UNAVAILABLE', message: '', status: 503 })
      ).retryable
    ).toBe(true)
    expect(
      describeRunError(
        new AppError({ code: 'TEMPLATE_ARCHIVED', message: '', status: 410 })
      ).retryable
    ).toBe(false)
  })

  it('falls back on the HTTP status when the code is unknown', () => {
    expect(
      describeRunError(
        new AppError({ code: 'WEIRD', message: '', status: 500 })
      ).retryable
    ).toBe(true)
    expect(
      describeRunError(
        new AppError({ code: 'WEIRD', message: '', status: 400 })
      ).retryable
    ).toBe(false)
  })
})
