import type {
  AnswerField,
  Operator
} from '#/features/templates/types/definition'
import type { OperandKind } from './operand-model'

/** Spanish labels for the policy editor's own pickers (kept local to this feature). */

export const OPERAND_KIND_LABELS: Record<OperandKind, string> = {
  answer: 'Respuesta',
  signal: 'Señal',
  flag: 'Marca',
  input: 'Entrada',
  value: 'Valor'
}

export const ANSWER_FIELD_LABELS: Record<AnswerField, string> = {
  choice: 'opción elegida',
  level: 'nivel',
  score: 'puntuación',
  score_norm: 'puntuación (0–1)',
  confidence: 'confianza',
  probability: 'probabilidad de sí',
  prob: 'probabilidad de…'
}

export const OPERATOR_LABELS: Record<Operator, string> = {
  eq: 'es igual a',
  neq: 'es distinto de',
  gt: 'es mayor que',
  gte: 'es mayor o igual que',
  lt: 'es menor que',
  lte: 'es menor o igual que',
  in: 'es uno de',
  between: 'está entre',
  exists: 'existe',
  contains: 'contiene',
  len_gt: 'tiene longitud mayor que',
  len_lt: 'tiene longitud menor que',
  before: 'es anterior a',
  after: 'es posterior a',
  days_since_gt: 'lleva más de … días',
  days_since_lt: 'lleva menos de … días'
}
