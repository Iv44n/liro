import { z } from 'zod'
import {
  DEFINITION_LIMITS,
  INPUT_FIELD_TYPES,
  isInputPath,
  isLabel,
  LABEL_PATTERN,
  NAME_MAX_LENGTH,
  NEEDS_REVIEW,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN
} from '../types/definition'
import {
  type CreationMethod,
  parseEnumValues,
  type TemplateFormValues
} from '../utils/template-form'
import { BAND_LIMITS } from '../utils/thresholds'

/**
 * Client-side validation of `/decisions/new`, mirroring the API's request
 * rules (`templates.service.ts`, `definition.ts`, `wizards.ts`) and the
 * lint errors a wizard could otherwise create (duplicate or reserved
 * labels, fewer than 2 options, duplicate or overlapping fields).
 */

const TEXT_MAX_LENGTH = 2_000
const ENUM_VALUE_MAX_LENGTH = 256
const ENUM_MAX_VALUES = 255

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre es obligatorio.')
  .max(120, 'El nombre no puede superar los 120 caracteres.')

/** Optional: empty lets the API derive it from the name. */
export const slugSchema = z
  .string()
  .trim()
  .max(SLUG_MAX_LENGTH, `Máximo ${SLUG_MAX_LENGTH} caracteres.`)
  .refine(
    slug => slug === '' || SLUG_PATTERN.test(slug),
    'Usa minúsculas y números separados por guiones (p. ej. tickets-soporte).'
  )

const descriptionSchema = z
  .string()
  .max(TEXT_MAX_LENGTH, `Máximo ${TEXT_MAX_LENGTH} caracteres.`)

export const labelSchema = z
  .string()
  .trim()
  .min(1, 'La etiqueta es obligatoria.')
  .max(NAME_MAX_LENGTH, `Máximo ${NAME_MAX_LENGTH} caracteres.`)
  .regex(
    LABEL_PATTERN,
    'Usa minúsculas y números separados por _ o - (p. ej. facturacion).'
  )
  .refine(
    label => label !== NEEDS_REVIEW,
    '«needs_review» está reservada: es la decisión que envía a revisión humana.'
  )
  .refine(label => isLabel(label), 'Ese nombre está reservado; elige otro.')

const labelValuesSchema = z.object({
  label: labelSchema,
  description: descriptionSchema
})

const fieldSchema = z
  .object({
    path: z
      .string()
      .trim()
      .min(1, 'La ruta es obligatoria.')
      .refine(
        isInputPath,
        'Usa identificadores separados por puntos (p. ej. ticket.message), sin espacios ni acentos.'
      ),
    type: z.enum(INPUT_FIELD_TYPES),
    required: z.boolean(),
    description: descriptionSchema,
    enumValues: z.string()
  })
  .superRefine((field, ctx) => {
    if (field.type !== 'enum') return
    const values = parseEnumValues(field.enumValues)
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', path: ['enumValues'], message })
    if (values.length === 0) {
      issue('Escribe al menos un valor permitido.')
    } else if (values.length > ENUM_MAX_VALUES) {
      issue(`Como máximo ${ENUM_MAX_VALUES} valores.`)
    } else if (values.some(value => value.length > ENUM_VALUE_MAX_LENGTH)) {
      issue(`Cada valor admite hasta ${ENUM_VALUE_MAX_LENGTH} caracteres.`)
    }
  })

export const fieldsSchema = z
  .array(fieldSchema)
  .min(1, 'Declara al menos un campo de entrada.')
  .max(
    DEFINITION_LIMITS.fields,
    `Como máximo ${DEFINITION_LIMITS.fields} campos.`
  )
  .superRefine((fields, ctx) => {
    const paths = fields.map(field => field.path.trim())
    const seen = new Set<string>()
    paths.forEach((path, index) => {
      if (path === '') return
      if (seen.has(path)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'path'],
          message: 'Esta ruta ya está declarada.'
        })
        return
      }
      seen.add(path)
      const child = paths.find(other => other.startsWith(`${path}.`))
      if (child !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'path'],
          message: `«${path}» es a la vez un campo y el objeto de «${child}»: declara el objeto o sus campos, no ambos.`
        })
      }
    })
  })

export const instructionsSchema = z
  .string()
  .trim()
  .min(1, 'Escribe las instrucciones para el modelo.')

export const labelsSchema = z
  .array(labelValuesSchema)
  .min(
    DEFINITION_LIMITS.choiceOptions.min,
    'Añade al menos 2 etiquetas: una clasificación necesita opciones.'
  )
  .max(
    DEFINITION_LIMITS.choiceOptions.max,
    `Como máximo ${DEFINITION_LIMITS.choiceOptions.max} etiquetas.`
  )
  .superRefine((labels, ctx) => {
    const seen = new Set<string>()
    labels.forEach(({ label }, index) => {
      const trimmed = label.trim()
      if (trimmed === '') return
      if (seen.has(trimmed)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'label'],
          message: 'Esta etiqueta está repetida.'
        })
      }
      seen.add(trimmed)
    })
  })

/** The Score wizard's levels: ordered lowest first, 2..10 (`DEFINITION_LIMITS.scoreLevels`). */
export const levelsSchema = z
  .array(labelValuesSchema)
  .min(
    DEFINITION_LIMITS.scoreLevels.min,
    `Añade al menos ${DEFINITION_LIMITS.scoreLevels.min} niveles: una escala necesita orden.`
  )
  .max(
    DEFINITION_LIMITS.scoreLevels.max,
    `Como máximo ${DEFINITION_LIMITS.scoreLevels.max} niveles.`
  )
  .superRefine((levels, ctx) => {
    const seen = new Set<string>()
    levels.forEach(({ label }, index) => {
      const trimmed = label.trim()
      if (trimmed === '') return
      if (seen.has(trimmed)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'label'],
          message: 'Este nivel está repetido.'
        })
      }
      seen.add(trimmed)
    })
  })

const percentSchema = z
  .number()
  .int()
  .min(0, 'Debe estar entre 0 % y 100 %.')
  .max(100, 'Debe estar entre 0 % y 100 %.')

const bandsSchema = z.object({
  no: z
    .number()
    .int()
    .min(BAND_LIMITS.no.min)
    .max(BAND_LIMITS.no.max, 'El umbral de «no» debe ser menor que 50 %.'),
  yes: z
    .number()
    .int()
    .min(BAND_LIMITS.yes.min, 'El umbral de «sí» debe ser mayor que 50 %.')
    .max(BAND_LIMITS.yes.max)
})

const basicsShape = {
  name: nameSchema,
  slug: slugSchema,
  description: descriptionSchema
}

const wizardShape = {
  ...basicsShape,
  fields: fieldsSchema,
  instructions: instructionsSchema
}

const classifySchema = z.object({
  ...wizardShape,
  labels: labelsSchema,
  minConfidence: percentSchema
})

const scoreSchema = z.object({
  ...wizardShape,
  levels: levelsSchema,
  minConfidence: percentSchema
})

const decideSchema = z
  .object({
    ...wizardShape,
    yes: labelValuesSchema,
    no: labelValuesSchema,
    bands: bandsSchema
  })
  .superRefine((values, ctx) => {
    const yes = values.yes.label.trim()
    if (yes !== '' && yes === values.no.label.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['no', 'label'],
        message: 'Debe ser distinta de la etiqueta de «sí».'
      })
    }
  })

const basicsSchema = z.object(basicsShape)

const SCHEMAS: Record<CreationMethod, z.ZodType> = {
  classify: classifySchema,
  score: scoreSchema,
  decide: decideSchema,
  gallery: basicsSchema,
  blank: basicsSchema
}

/** A zod issue path as a TanStack Form field name (`['labels', 1, 'label']` → `labels[1].label`). */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((name, segment) => {
    if (typeof segment === 'number') return `${name}[${segment}]`
    const key = String(segment)
    return name === '' ? key : `${name}.${key}`
  }, '')
}

/**
 * The creation form's errors for `method`, by field name (the first message
 * of each field); `{}` when the form is valid.
 */
export function validateTemplateForm(
  method: CreationMethod,
  values: TemplateFormValues
): Record<string, string> {
  const result = SCHEMAS[method].safeParse(values)
  if (result.success) return {}
  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    errors[formatIssuePath(issue.path)] ??= issue.message
  }
  return errors
}
