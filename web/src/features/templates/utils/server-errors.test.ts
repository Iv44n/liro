import { describe, expect, it } from 'vitest'
import { AppError } from '#/sdk/core/app.error'
import {
  apiPathToFormPath,
  createErrorToFormErrors,
  describeError,
  valueAtPath
} from './server-errors'

describe('apiPathToFormPath()', () => {
  it('maps request paths onto form fields', () => {
    expect(apiPathToFormPath('name')).toBe('name')
    expect(apiPathToFormPath('slug')).toBe('slug')
    expect(apiPathToFormPath('source.fields')).toBe('fields')
    expect(apiPathToFormPath('source.fields.2')).toBe('fields[2].path')
    expect(apiPathToFormPath('source.fields.0.path')).toBe('fields[0].path')
    expect(apiPathToFormPath('source.fields.1.enum.3')).toBe(
      'fields[1].enumValues'
    )
    expect(apiPathToFormPath('source.labels')).toBe('labels')
    expect(apiPathToFormPath('source.labels.1.label')).toBe('labels[1].label')
    expect(apiPathToFormPath('source.labels.0.criteria')).toBe(
      'labels[0].description'
    )
    expect(apiPathToFormPath('source.yes.label')).toBe('yes.label')
    expect(apiPathToFormPath('source.no.description')).toBe('no.description')
    expect(apiPathToFormPath('source.instructions')).toBe('instructions')
    expect(apiPathToFormPath('source.minConfidence')).toBe('minConfidence')
    expect(apiPathToFormPath('source.noThreshold')).toBe('bands')
  })

  it('returns null for paths without a field', () => {
    expect(apiPathToFormPath('')).toBeNull()
    expect(apiPathToFormPath('source')).toBeNull()
    expect(apiPathToFormPath('source.id')).toBeNull()
    expect(apiPathToFormPath('definition.decisions.0.label')).toBeNull()
  })
})

describe('createErrorToFormErrors()', () => {
  it('puts SLUG_TAKEN on the slug field', () => {
    const error = new AppError({
      code: 'SLUG_TAKEN',
      message: 'taken',
      status: 409,
      details: { slug: 'soporte' }
    })
    expect(createErrorToFormErrors(error)).toEqual({
      fields: {
        slug: expect.stringContaining('«soporte»')
      },
      form: []
    })
  })

  it('maps validation issues onto fields, keeping the first per field', () => {
    const error = new AppError({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      status: 422,
      details: {
        issues: [
          {
            path: 'source.labels.1.label',
            message: 'Use lowercase letters…',
            code: 'invalid_format'
          },
          {
            path: 'source.labels.1.label',
            message: 'second',
            code: 'too_big'
          },
          { path: 'source', message: 'Too large', code: 'too_big' }
        ]
      }
    })
    const result = createErrorToFormErrors(error)
    expect(Object.keys(result.fields)).toEqual(['labels[1].label'])
    expect(result.fields['labels[1].label']).toMatch(/minúsculas/)
    expect(result.form).toEqual(['source: Too large'])
  })

  it('explains permission, session and network failures', () => {
    expect(
      createErrorToFormErrors(
        new AppError({ code: 'FORBIDDEN', message: 'x', status: 403 })
      ).form[0]
    ).toMatch(/permiso/)
    expect(
      createErrorToFormErrors(
        new AppError({ code: 'UNAUTHORIZED', message: 'x', status: 401 })
      ).form[0]
    ).toMatch(/sesión/)
    expect(
      createErrorToFormErrors(new TypeError('Failed to fetch')).form[0]
    ).toMatch(/conectar/)
    expect(
      createErrorToFormErrors(
        new AppError({ code: 'SOMETHING', message: 'Boom', status: 400 })
      ).form
    ).toEqual(['Boom'])
  })
})

describe('describeError()', () => {
  it('describes failures in Spanish', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toMatch(/conectar/)
    expect(
      describeError(new AppError({ code: 'FORBIDDEN', message: 'x' }))
    ).toMatch(/permiso/)
    expect(
      describeError(new AppError({ code: 'NOT_FOUND', message: 'x' }))
    ).toMatch(/ya no existe/)
    expect(
      describeError(
        new AppError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal Server Error',
          status: 500
        })
      )
    ).toMatch(/servidor/)
    expect(
      describeError(
        new AppError({ code: 'X', message: 'Detalle', status: 409 })
      )
    ).toBe('Detalle')
  })
})

describe('valueAtPath()', () => {
  const values = {
    name: 'x',
    labels: [{ label: 'a' }, { label: 'b' }],
    yes: { label: 'yes' }
  }

  it('reads nested and indexed values', () => {
    expect(valueAtPath(values, 'name')).toBe('x')
    expect(valueAtPath(values, 'labels[1].label')).toBe('b')
    expect(valueAtPath(values, 'yes.label')).toBe('yes')
    expect(valueAtPath(values, 'labels')).toBe(values.labels)
  })

  it('returns undefined for missing steps', () => {
    expect(valueAtPath(values, 'labels[5].label')).toBeUndefined()
    expect(valueAtPath(values, 'name.length.x')).toBeUndefined()
  })
})
