import { describe, expect, it } from 'vitest'
import {
  defaultFormValues,
  type TemplateFormValues
} from '../utils/template-form'
import { formatIssuePath, validateTemplateForm } from './template-form'

const classify = (
  overrides: Partial<TemplateFormValues> = {}
): TemplateFormValues => ({
  ...defaultFormValues('classify'),
  name: 'Tickets',
  instructions: '¿A qué cola va?',
  labels: [
    { label: 'bug', description: '' },
    { label: 'billing', description: '' }
  ],
  ...overrides
})

const decide = (
  overrides: Partial<TemplateFormValues> = {}
): TemplateFormValues => ({
  ...defaultFormValues('decide'),
  name: 'Reembolsos',
  instructions: '¿Aprobar?',
  ...overrides
})

const score = (
  overrides: Partial<TemplateFormValues> = {}
): TemplateFormValues => ({
  ...defaultFormValues('score'),
  name: 'Riesgo',
  instructions: '¿Qué tan riesgoso es?',
  levels: [
    { label: 'bajo', description: '' },
    { label: 'medio', description: '' },
    { label: 'alto', description: '' }
  ],
  ...overrides
})

describe('formatIssuePath()', () => {
  it('formats indexes the way TanStack Form names fields', () => {
    expect(formatIssuePath(['labels', 1, 'label'])).toBe('labels[1].label')
    expect(formatIssuePath(['fields'])).toBe('fields')
    expect(formatIssuePath(['no', 'label'])).toBe('no.label')
    expect(formatIssuePath([])).toBe('')
  })
})

describe('validateTemplateForm()', () => {
  it('accepts the valid wizards', () => {
    expect(validateTemplateForm('classify', classify())).toEqual({})
    expect(validateTemplateForm('decide', decide())).toEqual({})
    expect(validateTemplateForm('score', score())).toEqual({})
  })

  it('requires at least two levels for the Score wizard, like Classify', () => {
    expect(
      validateTemplateForm(
        'score',
        score({ levels: [{ label: 'solo', description: '' }] })
      ).levels
    ).toMatch(/al menos 2/)
    expect(
      validateTemplateForm(
        'score',
        score({
          levels: [
            { label: 'bajo', description: '' },
            { label: 'bajo', description: '' }
          ]
        })
      )['levels[1].label']
    ).toMatch(/repetido/)
  })

  it('requires the basics and lets the slug be empty', () => {
    const values = { ...defaultFormValues('blank'), name: '  ' }
    expect(validateTemplateForm('blank', values)).toEqual({
      name: 'El nombre es obligatorio.'
    })
    expect(validateTemplateForm('gallery', { ...values, name: 'x' })).toEqual(
      {}
    )
    expect(
      validateTemplateForm('blank', { ...values, name: 'x', slug: 'Mal Slug' })
    ).toHaveProperty('slug')
  })

  it('only validates the part of the form the method uses', () => {
    // The Classify labels are empty in a Decide form and vice versa.
    expect(validateTemplateForm('decide', decide({ labels: [] }))).toEqual({})
    expect(
      validateTemplateForm(
        'classify',
        classify({ yes: { label: '', description: '' } })
      )
    ).toEqual({})
  })

  it('checks labels like the API and the lint do', () => {
    const errors = validateTemplateForm(
      'classify',
      classify({
        labels: [
          { label: 'Bug', description: '' },
          { label: 'needs_review', description: '' },
          { label: 'ok', description: '' },
          { label: 'ok', description: '' },
          { label: '', description: '' }
        ]
      })
    )
    expect(errors['labels[0].label']).toMatch(/minúsculas/)
    expect(errors['labels[1].label']).toMatch(/reservada/)
    expect(errors['labels[2].label']).toBeUndefined()
    expect(errors['labels[3].label']).toMatch(/repetida/)
    expect(errors['labels[4].label']).toMatch(/obligatoria/)
  })

  it('requires at least two labels', () => {
    expect(
      validateTemplateForm(
        'classify',
        classify({ labels: [{ label: 'solo', description: '' }] })
      ).labels
    ).toMatch(/al menos 2/)
  })

  it('checks input field paths, duplicates, overlaps and enum values', () => {
    const field = defaultFormValues('classify').fields[0]
    if (!field) throw new Error('expected a default field')
    const errors = validateTemplateForm(
      'classify',
      classify({
        fields: [
          { ...field, path: 'ticket' },
          { ...field, path: 'ticket.message' },
          { ...field, path: 'ticket.message' },
          { ...field, path: 'mal campo' },
          { ...field, path: 'plan', type: 'enum', enumValues: ' , ' }
        ]
      })
    )
    expect(errors['fields[0].path']).toMatch(/a la vez un campo/)
    expect(errors['fields[1].path']).toBeUndefined()
    expect(errors['fields[2].path']).toMatch(/ya está declarada/)
    expect(errors['fields[3].path']).toMatch(/separados por puntos/)
    expect(errors['fields[4].enumValues']).toMatch(/al menos un valor/)
    expect(
      validateTemplateForm('classify', classify({ fields: [] })).fields
    ).toMatch(/al menos un campo/)
  })

  it('requires instructions', () => {
    expect(
      validateTemplateForm('decide', decide({ instructions: '  ' }))
        .instructions
    ).toMatch(/instrucciones/)
  })

  it('requires distinct yes/no labels and bands on each side of 50 %', () => {
    const errors = validateTemplateForm(
      'decide',
      decide({
        yes: { label: 'si', description: '' },
        no: { label: 'si', description: '' },
        bands: { no: 50, yes: 50 }
      })
    )
    expect(errors['no.label']).toMatch(/distinta/)
    expect(errors['bands.no']).toMatch(/menor que 50/)
    expect(errors['bands.yes']).toMatch(/mayor que 50/)
  })
})
