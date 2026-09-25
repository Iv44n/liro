import type { GalleryItemView } from '#/sdk/modules/gallery/types'
import type {
  CreateTemplateRequest,
  WizardLabel
} from '#/sdk/modules/templates/types'
import type { InputField, InputFieldType } from '../types/definition'
import { slugify } from './slug'
import {
  CLASSIFY_DEFAULTS,
  DECIDE_DEFAULTS,
  fromPercent,
  type PercentBands,
  SCORE_DEFAULTS,
  toPercent
} from './thresholds'

/**
 * The creation form of `/decisions/new`: one shape for every method (each
 * method validates and sends only its part), mapped to `POST
 * /api/templates` by {@link toCreateTemplateRequest}.
 */

/** How a new template starts. */
export const CREATION_METHODS = [
  'classify',
  'score',
  'decide',
  'gallery',
  'blank'
] as const
export type CreationMethod = (typeof CREATION_METHODS)[number]

/** Methods whose form collects the input fields and instructions. */
export const isWizardMethod = (
  method: CreationMethod
): method is 'classify' | 'score' | 'decide' =>
  method === 'classify' || method === 'score' || method === 'decide'

export interface FieldFormValues {
  path: string
  type: InputFieldType
  required: boolean
  description: string
  /** `enum` only: values separated by commas or new lines. */
  enumValues: string
}

export interface LabelFormValues {
  label: string
  description: string
}

export interface TemplateFormValues {
  name: string
  /** `''` lets the API derive it from the name. */
  slug: string
  description: string
  fields: FieldFormValues[]
  instructions: string
  /** Classify: one per outcome, ≥ 2. */
  labels: LabelFormValues[]
  /** Score: ordered lowest first, 2..10. */
  levels: LabelFormValues[]
  /** Classify/Score: whole percentage shared by every label/level. */
  minConfidence: number
  /** Decide. */
  yes: LabelFormValues
  no: LabelFormValues
  /** Decide: P(sí) bands in whole percentages. */
  bands: PercentBands
}

export const emptyField = (): FieldFormValues => ({
  path: '',
  type: 'string',
  required: false,
  description: '',
  enumValues: ''
})

export const emptyLabel = (): LabelFormValues => ({
  label: '',
  description: ''
})

const textField = (description: string): FieldFormValues => ({
  ...emptyField(),
  path: 'text',
  required: true,
  description
})

const FIELD_DESCRIPTIONS: Record<'classify' | 'score' | 'decide', string> = {
  classify: 'El texto a clasificar',
  score: 'El texto a puntuar',
  decide: 'El texto sobre el que decidir'
}

/** The form a method starts with (for `gallery`, the chosen template's name, slug and description). */
export function defaultFormValues(
  method: CreationMethod,
  gallery?: Pick<GalleryItemView, 'name' | 'slug' | 'description'>
): TemplateFormValues {
  return {
    name: gallery?.name ?? '',
    slug: gallery?.slug ?? '',
    description: gallery?.description ?? '',
    fields: [
      textField(
        FIELD_DESCRIPTIONS[method as 'classify' | 'score' | 'decide'] ??
          FIELD_DESCRIPTIONS.classify
      )
    ],
    instructions: '',
    labels: [emptyLabel(), emptyLabel()],
    levels: [emptyLabel(), emptyLabel()],
    minConfidence:
      method === 'score'
        ? toPercent(SCORE_DEFAULTS.minConfidence)
        : toPercent(CLASSIFY_DEFAULTS.minConfidence),
    yes: { label: 'yes', description: '' },
    no: { label: 'no', description: '' },
    bands: {
      no: toPercent(DECIDE_DEFAULTS.noThreshold),
      yes: toPercent(DECIDE_DEFAULTS.yesThreshold)
    }
  }
}

/** Enum values typed as `a, b` or one per line: trimmed, deduplicated, blanks dropped. */
export function parseEnumValues(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map(value => value.trim())
        .filter(Boolean)
    )
  ]
}

const optionalText = (value: string): string | undefined => {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function toInputField(field: FieldFormValues): InputField {
  const description = optionalText(field.description)
  return {
    path: field.path.trim(),
    type: field.type,
    required: field.required,
    ...(description === undefined ? {} : { description }),
    ...(field.type === 'enum'
      ? { enum: parseEnumValues(field.enumValues) }
      : {})
  }
}

function toWizardLabel(value: LabelFormValues): WizardLabel {
  const description = optionalText(value.description)
  return {
    label: value.label.trim(),
    ...(description === undefined ? {} : { description })
  }
}

/**
 * The `POST /api/templates` body for `method`. `galleryId` is required for
 * the `gallery` method. An empty slug is omitted (the API derives the same
 * one from the name, see {@link slugify}); an empty description too.
 */
export function toCreateTemplateRequest(
  method: CreationMethod,
  values: TemplateFormValues,
  galleryId?: string
): CreateTemplateRequest {
  const slug = optionalText(values.slug)
  const description = optionalText(values.description)
  const basics = {
    name: values.name.trim(),
    ...(slug === undefined ? {} : { slug }),
    ...(description === undefined ? {} : { description })
  }

  switch (method) {
    case 'classify':
      return {
        ...basics,
        source: {
          type: 'classify',
          fields: values.fields.map(toInputField),
          instructions: values.instructions.trim(),
          labels: values.labels.map(toWizardLabel),
          minConfidence: fromPercent(values.minConfidence)
        }
      }
    case 'score':
      return {
        ...basics,
        source: {
          type: 'score',
          fields: values.fields.map(toInputField),
          instructions: values.instructions.trim(),
          levels: values.levels.map(toWizardLabel),
          minConfidence: fromPercent(values.minConfidence)
        }
      }
    case 'decide':
      return {
        ...basics,
        source: {
          type: 'decide',
          fields: values.fields.map(toInputField),
          instructions: values.instructions.trim(),
          yes: toWizardLabel(values.yes),
          no: toWizardLabel(values.no),
          yesThreshold: fromPercent(values.bands.yes),
          noThreshold: fromPercent(values.bands.no)
        }
      }
    case 'gallery':
      if (!galleryId) {
        throw new Error('A gallery template must be chosen first')
      }
      return { ...basics, source: { type: 'gallery', id: galleryId } }
    case 'blank':
      return { ...basics, source: { type: 'blank', kind: 'custom' } }
  }
}

/** The slug the API will use for `values` (its own when given, else derived from the name). */
export const effectiveSlug = (
  values: Pick<TemplateFormValues, 'name' | 'slug'>
) => values.slug.trim() || slugify(values.name)
