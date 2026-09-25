import { describe, expect, it } from 'vitest'
import {
  defaultFormValues,
  effectiveSlug,
  parseEnumValues,
  type TemplateFormValues,
  toCreateTemplateRequest,
  toInputField
} from './template-form'

const classifyValues = (): TemplateFormValues => ({
  ...defaultFormValues('classify'),
  name: '  Tickets de soporte ',
  slug: 'tickets',
  description: '   ',
  instructions: ' ¿A qué cola va `ticket.message`? ',
  fields: [
    {
      path: ' ticket.message ',
      type: 'string',
      required: true,
      description: 'Lo que escribió el cliente',
      enumValues: 'ignored'
    },
    {
      path: 'customer.plan',
      type: 'enum',
      required: false,
      description: '',
      enumValues: 'free, pro,\nenterprise, pro'
    }
  ],
  labels: [
    { label: 'bug', description: ' Algo está roto ' },
    { label: 'billing', description: '' }
  ],
  minConfidence: 75
})

describe('defaultFormValues()', () => {
  it('starts wizards with one required text field and the API defaults', () => {
    const values = defaultFormValues('decide')
    expect(values.fields).toEqual([
      {
        path: 'text',
        type: 'string',
        required: true,
        description: 'El texto sobre el que decidir',
        enumValues: ''
      }
    ])
    expect(values.minConfidence).toBe(80)
    expect(values.bands).toEqual({ no: 10, yes: 90 })
    expect(values.labels).toHaveLength(2)
  })

  it("prefills a gallery template's basics", () => {
    const values = defaultFormValues('gallery', {
      name: 'Content moderation',
      slug: 'content-moderation',
      description: 'Moderates content'
    })
    expect(values).toMatchObject({
      name: 'Content moderation',
      slug: 'content-moderation',
      description: 'Moderates content'
    })
  })
})

describe('parseEnumValues()', () => {
  it('splits on commas and new lines, trimming and deduplicating', () => {
    expect(parseEnumValues(' a, b ,\n c,, a ')).toEqual(['a', 'b', 'c'])
    expect(parseEnumValues('  ')).toEqual([])
  })
})

describe('toInputField()', () => {
  it('only sends enum values for enum fields and drops empty descriptions', () => {
    const [text, plan] = classifyValues().fields
    expect(text && toInputField(text)).toEqual({
      path: 'ticket.message',
      type: 'string',
      required: true,
      description: 'Lo que escribió el cliente'
    })
    expect(plan && toInputField(plan)).toEqual({
      path: 'customer.plan',
      type: 'enum',
      required: false,
      enum: ['free', 'pro', 'enterprise']
    })
  })
})

describe('toCreateTemplateRequest()', () => {
  it('maps the Classify wizard', () => {
    expect(toCreateTemplateRequest('classify', classifyValues())).toEqual({
      name: 'Tickets de soporte',
      slug: 'tickets',
      source: {
        type: 'classify',
        fields: [
          {
            path: 'ticket.message',
            type: 'string',
            required: true,
            description: 'Lo que escribió el cliente'
          },
          {
            path: 'customer.plan',
            type: 'enum',
            required: false,
            enum: ['free', 'pro', 'enterprise']
          }
        ],
        instructions: '¿A qué cola va `ticket.message`?',
        labels: [
          { label: 'bug', description: 'Algo está roto' },
          { label: 'billing' }
        ],
        minConfidence: 0.75
      }
    })
  })

  it('maps the Score wizard, keeping level order', () => {
    const request = toCreateTemplateRequest('score', {
      ...defaultFormValues('score'),
      name: 'Riesgo de fraude',
      slug: '',
      instructions: 'Evalúa el riesgo de `ticket.message`',
      levels: [
        { label: 'bajo', description: 'Sin señales de alerta' },
        { label: 'medio', description: '' },
        { label: 'alto', description: 'Varias señales de alerta' }
      ],
      minConfidence: 70
    })
    expect(request).toEqual({
      name: 'Riesgo de fraude',
      source: {
        type: 'score',
        fields: [
          {
            path: 'text',
            type: 'string',
            required: true,
            description: 'El texto a puntuar'
          }
        ],
        instructions: 'Evalúa el riesgo de `ticket.message`',
        levels: [
          { label: 'bajo', description: 'Sin señales de alerta' },
          { label: 'medio' },
          { label: 'alto', description: 'Varias señales de alerta' }
        ],
        minConfidence: 0.7
      }
    })
  })

  it('maps the Decide wizard with its bands', () => {
    const request = toCreateTemplateRequest('decide', {
      ...defaultFormValues('decide'),
      name: 'Reembolsos',
      slug: '',
      description: 'Aprueba reembolsos pequeños',
      instructions: '¿Aprobar el reembolso?',
      yes: { label: 'approve', description: 'Cumple la política' },
      no: { label: 'reject', description: '' },
      bands: { no: 20, yes: 85 }
    })
    expect(request).toEqual({
      name: 'Reembolsos',
      description: 'Aprueba reembolsos pequeños',
      source: {
        type: 'decide',
        fields: [
          {
            path: 'text',
            type: 'string',
            required: true,
            description: 'El texto sobre el que decidir'
          }
        ],
        instructions: '¿Aprobar el reembolso?',
        yes: { label: 'approve', description: 'Cumple la política' },
        no: { label: 'reject' },
        yesThreshold: 0.85,
        noThreshold: 0.2
      }
    })
  })

  it('maps the gallery and blank methods to their sources only', () => {
    const values = { ...defaultFormValues('gallery'), name: 'Moderación' }
    expect(
      toCreateTemplateRequest('gallery', values, 'content-moderation')
    ).toEqual({
      name: 'Moderación',
      source: { type: 'gallery', id: 'content-moderation' }
    })
    expect(toCreateTemplateRequest('blank', values)).toEqual({
      name: 'Moderación',
      source: { type: 'blank', kind: 'custom' }
    })
    expect(() => toCreateTemplateRequest('gallery', values)).toThrow()
  })
})

describe('effectiveSlug()', () => {
  it('uses the typed slug or derives one from the name', () => {
    expect(effectiveSlug({ name: 'Reseñas', slug: ' mio ' })).toBe('mio')
    expect(effectiveSlug({ name: 'Reseñas', slug: '' })).toBe('resenas')
  })
})
