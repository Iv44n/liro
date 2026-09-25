import z from 'zod'
import {
  ANSWER_FIELDS,
  type Comparison,
  type Condition,
  type EntryType,
  INPUT_FIELD_TYPES,
  isInputPath,
  isKey,
  isLabel,
  type JsonValue,
  KEY_PATTERN,
  LABEL_PATTERN,
  NAME_MAX_LENGTH,
  NEEDS_REVIEW,
  OPERATORS,
  type Operand,
  RESERVED_NAMES,
  TEMPLATE_KINDS,
  type TemplateDefinition
} from '#/features/templates/types/definition'

/**
 * Web mirror of the API's *structural* definition schema
 * (`api/src/modules/templates/definition.ts`). The API refuses to save a
 * draft that fails it (422 `VALIDATION_FAILED`), so the editor checks the
 * same rules before saving and shows the issues next to the lint, with the
 * same dotted paths. Semantic checks stay on the API (lint).
 */

export const MESSAGES = {
  key: 'Usa lower_snake_case: minúsculas, números y _, empezando por una letra',
  label: 'Usa minúsculas y números, separados por _ o -',
  reserved: 'Este nombre está reservado',
  tooLong: (max: number) => `Máximo ${max} caracteres`,
  path: 'Usa identificadores separados por puntos, p. ej. ticket.message',
  entryEmpty: 'No puede estar vacío',
  enumMissing: 'Un campo enum necesita sus valores permitidos',
  enumOnly: 'Solo los campos enum llevan valores permitidos',
  maxLengthOnly: 'Solo los campos de texto llevan longitud máxima',
  probOption: '`prob` necesita la opción (o nivel) que lee',
  onlyProb: 'Solo `prob` lleva opción',
  existsNoRight: '`exists` no lleva operando derecho',
  needsRight: (op: string) => `\`${op}\` necesita un operando derecho`,
  between: '`between` necesita [mínimo, máximo]',
  singleRight: (op: string) => `\`${op}\` lleva un único operando derecho`,
  modelVersion: 'Usa una versión exacta, p. ej. 1.2.3',
  flags: 'Indica al menos una marca',
  weight: 'El peso debe ser mayor que 0',
  nul: 'No puede contener caracteres NUL'
} as const

const notReserved = (name: string) => !RESERVED_NAMES.has(name)

export const keySchema = z
  .string()
  .max(NAME_MAX_LENGTH, MESSAGES.tooLong(NAME_MAX_LENGTH))
  .regex(KEY_PATTERN, MESSAGES.key)
  .refine(notReserved, MESSAGES.reserved)

export const labelSchema = z
  .string()
  .max(NAME_MAX_LENGTH, MESSAGES.tooLong(NAME_MAX_LENGTH))
  .regex(LABEL_PATTERN, MESSAGES.label)
  .refine(notReserved, MESSAGES.reserved)

export const pathSchema = z
  .string()
  .max(256, MESSAGES.tooLong(256))
  .refine(isInputPath, MESSAGES.path)

export const jsonValueSchema = z.json() as z.ZodType<JsonValue>

export const entrySchema: z.ZodType<EntryType> = z.union([
  z.string().min(1, MESSAGES.entryEmpty),
  z.record(z.string(), jsonValueSchema),
  z.array(jsonValueSchema)
])

const text = (max: number) => z.string().max(max, MESSAGES.tooLong(max))

export const inputFieldSchema = z
  .strictObject({
    path: pathSchema,
    type: z.enum(INPUT_FIELD_TYPES),
    required: z.boolean().default(false),
    description: text(2_000).optional(),
    enum: z
      .array(z.string().min(1, MESSAGES.entryEmpty).max(256))
      .min(1, MESSAGES.enumMissing)
      .max(255)
      .optional(),
    maxLength: z.number().int().positive().optional(),
    pii: z.boolean().optional()
  })
  .superRefine((field, ctx) => {
    if (field.type === 'enum' && !field.enum) {
      ctx.addIssue({
        code: 'custom',
        path: ['enum'],
        message: MESSAGES.enumMissing
      })
    }
    if (field.type !== 'enum' && field.enum) {
      ctx.addIssue({
        code: 'custom',
        path: ['enum'],
        message: MESSAGES.enumOnly
      })
    }
    if (field.type !== 'string' && field.maxLength !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxLength'],
        message: MESSAGES.maxLengthOnly
      })
    }
  })

export const operandSchema: z.ZodType<Operand> = z.union([
  z
    .strictObject({
      answer: keySchema,
      field: z.enum(ANSWER_FIELDS),
      option: labelSchema.optional()
    })
    .superRefine((operand, ctx) => {
      if (operand.field === 'prob' && operand.option === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['option'],
          message: MESSAGES.probOption
        })
      }
      if (operand.field !== 'prob' && operand.option !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['option'],
          message: MESSAGES.onlyProb
        })
      }
    }),
  z.strictObject({ signal: keySchema }),
  z.strictObject({ flag: keySchema }),
  z.strictObject({ input: pathSchema }),
  z.strictObject({ value: jsonValueSchema })
])

export const comparisonSchema: z.ZodType<Comparison> = z
  .strictObject({
    op: z.enum(OPERATORS),
    left: operandSchema,
    right: z.union([operandSchema, z.array(operandSchema)]).optional()
  })
  .superRefine((comparison, ctx) => {
    const { op, right } = comparison
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', path: ['right'], message })

    if (op === 'exists') {
      if (right !== undefined) issue(MESSAGES.existsNoRight)
      return
    }
    if (right === undefined) return issue(MESSAGES.needsRight(op))
    if (op === 'between') {
      if (!Array.isArray(right) || right.length !== 2) issue(MESSAGES.between)
      return
    }
    if (Array.isArray(right) && op !== 'in') issue(MESSAGES.singleRight(op))
  })

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(conditionSchema) }),
    z.strictObject({ any: z.array(conditionSchema) }),
    z.strictObject({ not: conditionSchema }),
    comparisonSchema
  ])
)

const questionBase = {
  instructions: entrySchema,
  note: text(2_000).optional(),
  when: conditionSchema.optional()
}

export const questionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('choice'),
    ...questionBase,
    criteria: z.record(labelSchema, entrySchema.nullable())
  }),
  z.strictObject({
    type: z.literal('score'),
    ...questionBase,
    levels: z.array(
      z.strictObject({ label: labelSchema, criteria: entrySchema.nullable() })
    )
  }),
  z.strictObject({
    type: z.literal('boolean'),
    ...questionBase,
    criteria: z
      .strictObject({
        true: entrySchema.nullable().optional(),
        false: entrySchema.nullable().optional()
      })
      .optional()
  })
])

export const signalSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    name: keySchema,
    kind: z.literal('weighted'),
    terms: z.array(
      z.strictObject({
        operand: operandSchema,
        weight: z.number().positive(MESSAGES.weight),
        invert: z.boolean().optional()
      })
    )
  }),
  z.strictObject({
    name: keySchema,
    kind: z.enum(['min', 'max', 'mean']),
    of: z.array(operandSchema)
  })
])

export const decisionTargetSchema = z.union([
  labelSchema,
  z.strictObject({ fromAnswer: keySchema })
])

export const decisionRuleSchema = z.strictObject({
  id: keySchema,
  name: text(200).optional(),
  when: conditionSchema,
  decision: decisionTargetSchema,
  confidenceFrom: keySchema.optional()
})

export const flagRuleSchema = z.strictObject({
  id: keySchema,
  name: text(200).optional(),
  when: conditionSchema,
  flags: z.array(keySchema).min(1, MESSAGES.flags)
})

export const decisionSchema = z.strictObject({
  label: labelSchema,
  description: text(2_000).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  alwaysReview: z.boolean().optional()
})

export const fallbackSchema = z.strictObject({ decision: labelSchema })

export const templateDefinitionSchema = z.strictObject({
  kind: z.enum(TEMPLATE_KINDS),
  model: z
    .strictObject({
      family: z.literal('jev'),
      version: z
        .string()
        .regex(/^\d+\.\d+\.\d+$/, MESSAGES.modelVersion)
        .optional()
    })
    .default({ family: 'jev' }),
  input: z.strictObject({ fields: z.array(inputFieldSchema) }),
  state: z
    .strictObject({
      include: z.array(pathSchema).optional(),
      context: z.record(z.string(), jsonValueSchema).optional()
    })
    .default({}),
  decisions: z.array(decisionSchema),
  preconditions: z.array(decisionRuleSchema).default([]),
  questions: z.record(keySchema, questionSchema).default({}),
  signals: z.array(signalSchema).default([]),
  flagRules: z.array(flagRuleSchema).default([]),
  rules: z.array(decisionRuleSchema).default([]),
  fallback: fallbackSchema.default({ decision: NEEDS_REVIEW })
})

/**
 * The policy sections the "Editar JSON (avanzado)" editor of the Política
 * tab edits as one object. Every section is required there: the editor
 * always shows all of them.
 */
export const policySectionsSchema = z.strictObject({
  preconditions: z.array(decisionRuleSchema),
  signals: z.array(signalSchema),
  flagRules: z.array(flagRuleSchema),
  rules: z.array(decisionRuleSchema),
  fallback: fallbackSchema
})

export type PolicySections = Pick<
  TemplateDefinition,
  'preconditions' | 'signals' | 'flagRules' | 'rules' | 'fallback'
>

/** Static state context: a JSON object. */
export const stateContextSchema = z.record(z.string(), jsonValueSchema)

// ── Issues ───────────────────────────────────────────────────────────────

export interface StructureIssue {
  /** Dotted, like lint paths (`questions.category.instructions`). */
  path: string
  message: string
}

const GENERIC_MESSAGES: Record<string, string> = {
  invalid_type: 'Tipo de valor no válido',
  invalid_union: 'Valor no válido',
  invalid_value: 'Valor no permitido',
  invalid_key: 'Nombre no válido',
  invalid_element: 'Elemento no válido',
  too_small: 'Valor demasiado pequeño o corto',
  too_big: 'Valor demasiado grande o largo',
  invalid_format: 'Formato no válido',
  not_multiple_of: 'Valor no válido'
}

/** Our own (Spanish) messages are kept; zod's generic ones are translated. */
const OWN_MESSAGES = new Set<string>(
  Object.values(MESSAGES).filter(
    (message): message is Extract<typeof message, string> =>
      typeof message === 'string'
  )
)

function issueMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === 'custom' || OWN_MESSAGES.has(issue.message)) {
    return issue.message
  }
  if (issue.message.startsWith('Máximo ')) return issue.message
  if (issue.code === 'unrecognized_keys') {
    return `Claves no permitidas: ${issue.keys.join(', ')}`
  }
  if (issue.code === 'invalid_union') {
    // The most specific branch error, when zod reports one.
    const nested = issue.errors
      .flat()
      .find(inner => inner.code === 'custom' || OWN_MESSAGES.has(inner.message))
    if (nested) return nested.message
  }
  return GENERIC_MESSAGES[issue.code] ?? 'Valor no válido'
}

const joinPath = (path: readonly PropertyKey[]): string =>
  path.map(segment => String(segment)).join('.')

/** The issues of a failed parse, with dotted paths and Spanish messages. */
export function structureIssues(
  error: z.ZodError,
  prefix: readonly PropertyKey[] = []
): StructureIssue[] {
  return error.issues.map(issue => ({
    path: joinPath([...prefix, ...issue.path]),
    message: issueMessage(issue)
  }))
}

/**
 * Structural problems that would make the API refuse to save `definition`
 * (`[]` when it can be saved). NUL characters are refused too, like the API.
 */
export function validateDefinition(
  definition: TemplateDefinition
): StructureIssue[] {
  const parsed = templateDefinitionSchema.safeParse(definition)
  const issues = parsed.success ? [] : structureIssues(parsed.error)
  return [...issues, ...nulIssues(definition)]
}

function nulIssues(
  value: unknown,
  path: PropertyKey[] = [],
  found: StructureIssue[] = []
): StructureIssue[] {
  if (typeof value === 'string') {
    if (value.includes('\u0000')) {
      found.push({ path: joinPath(path), message: MESSAGES.nul })
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      nulIssues(item, [...path, index], found)
    })
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key.includes('\u0000')) {
        found.push({ path: joinPath([...path, key]), message: MESSAGES.nul })
      } else {
        nulIssues(item, [...path, key], found)
      }
    }
  }
  return found
}

/** Why `value` can't be a question id / signal / flag / rule id (`null` if it can). */
export function keyError(value: string): string | null {
  if (value.length > NAME_MAX_LENGTH) return MESSAGES.tooLong(NAME_MAX_LENGTH)
  if (RESERVED_NAMES.has(value)) return MESSAGES.reserved
  return isKey(value) ? null : MESSAGES.key
}

/** Why `value` can't be a decision label / option / level (`null` if it can). */
export function labelError(value: string): string | null {
  if (value.length > NAME_MAX_LENGTH) return MESSAGES.tooLong(NAME_MAX_LENGTH)
  if (RESERVED_NAMES.has(value)) return MESSAGES.reserved
  return isLabel(value) ? null : MESSAGES.label
}

/** Why `value` can't be an input path (`null` if it can). */
export function pathError(value: string): string | null {
  return isInputPath(value) ? null : MESSAGES.path
}
