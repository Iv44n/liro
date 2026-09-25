import type {
  AnswerField,
  Operand,
  QuestionDef,
  TemplateDefinition
} from '#/features/templates/types/definition'
import { Input } from '#/shared/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'
import { ANSWER_FIELD_LABELS, OPERAND_KIND_LABELS } from '../utils/labels'
import type { OperandTypeInfo } from '../utils/operand-model'
import {
  ALL_ANSWER_FIELDS,
  answerFieldsFor,
  flagNames,
  inputPaths,
  OPERAND_KINDS_BY_CONTEXT,
  type OperandContext,
  type OperandKind,
  operandKind,
  optionsOf,
  questionIds,
  signalNames
} from '../utils/operand-model'
import { LiteralEditor } from './literal-editor'

/** The operand of a fresh `kind`, defaulting to the first thing of that kind the definition declares. */
function defaultOperandForKind(
  kind: OperandKind,
  definition: TemplateDefinition
): Operand {
  switch (kind) {
    case 'answer': {
      const [id] = questionIds(definition)
      const question = id ? definition.questions[id] : undefined
      const [field] = question ? answerFieldsFor(question.type) : []
      return id && field ? { answer: id, field } : { value: '' }
    }
    case 'signal': {
      const [name] = signalNames(definition)
      return { signal: name ?? '' }
    }
    case 'flag': {
      const [name] = flagNames(definition)
      return { flag: name ?? '' }
    }
    case 'input': {
      const [path] = inputPaths(definition)
      return { input: path ?? '' }
    }
    case 'value':
      return { value: '' }
  }
}

function StringSelect({
  id,
  value,
  options,
  onChange,
  placeholder,
  empty
}: {
  id: string
  value: string
  options: readonly string[]
  onChange: (value: string) => void
  placeholder: string
  empty: string
}) {
  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>
  }
  return (
    <Select
      value={value}
      onValueChange={next => {
        if (next !== null) onChange(next)
      }}
    >
      <SelectTrigger id={id} size="sm" className="w-full font-mono">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option} value={option}>
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function AnswerOperandEditor({
  definition,
  value,
  onChange,
  idPrefix
}: {
  definition: TemplateDefinition
  value: Extract<Operand, { answer: string }>
  onChange: (next: Operand) => void
  idPrefix: string
}) {
  const ids = questionIds(definition)
  const question: QuestionDef | undefined = definition.questions[value.answer]
  const fields = question ? answerFieldsFor(question.type) : ALL_ANSWER_FIELDS

  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      <StringSelect
        id={`${idPrefix}-question`}
        value={value.answer}
        options={ids}
        placeholder="Pregunta"
        empty="No hay preguntas declaradas todavía."
        onChange={id => {
          const nextQuestion = definition.questions[id]
          const [field] = nextQuestion ? answerFieldsFor(nextQuestion.type) : []
          onChange(
            field ? { answer: id, field } : { answer: id, field: value.field }
          )
        }}
      />
      <Select
        value={value.field}
        onValueChange={field =>
          onChange({
            answer: value.answer,
            field: field as AnswerField,
            ...(field === 'prob' ? { option: value.option } : {})
          })
        }
      >
        <SelectTrigger id={`${idPrefix}-field`} size="sm" className="w-full">
          <SelectValue placeholder="Dato" />
        </SelectTrigger>
        <SelectContent>
          {fields.map(field => (
            <SelectItem key={field} value={field}>
              {ANSWER_FIELD_LABELS[field]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value.field === 'prob' ? (
        <div className="sm:col-span-2">
          <StringSelect
            id={`${idPrefix}-option`}
            value={value.option ?? ''}
            options={question ? optionsOf(question) : []}
            placeholder="Opción"
            empty="Esa pregunta no tiene opciones."
            onChange={option =>
              onChange({ answer: value.answer, field: 'prob', option })
            }
          />
        </div>
      ) : null}
    </div>
  )
}

export interface OperandEditorProps {
  definition: TemplateDefinition
  value: Operand
  onChange: (next: Operand) => void
  context: OperandContext
  /** The other side's inferred type, so a literal picks the right widget. */
  expectedType?: OperandTypeInfo
  idPrefix: string
  'aria-label'?: string
}

/**
 * One operand: a kind picker (narrowed to `context`) plus the kind's own
 * editor — a question+field(+option) picker for `answer`, a name picker
 * for `signal`/`flag`, a path picker for `input`, or a typed literal for
 * `value` (see `LiteralEditor`).
 */
export function OperandEditor({
  definition,
  value,
  onChange,
  context,
  expectedType,
  idPrefix,
  'aria-label': ariaLabel
}: OperandEditorProps) {
  const kind = operandKind(value)
  const kinds = OPERAND_KINDS_BY_CONTEXT[context]

  return (
    <div className="flex flex-1 flex-wrap items-start gap-1.5">
      <Select
        value={kind}
        onValueChange={next =>
          onChange(defaultOperandForKind(next as OperandKind, definition))
        }
      >
        <SelectTrigger
          id={`${idPrefix}-kind`}
          size="sm"
          aria-label={ariaLabel ?? 'Tipo de operando'}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {kinds.map(k => (
            <SelectItem key={k} value={k}>
              {OPERAND_KIND_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="min-w-40 flex-1">
        {kind === 'answer' && 'answer' in value ? (
          <AnswerOperandEditor
            definition={definition}
            value={value}
            onChange={onChange}
            idPrefix={idPrefix}
          />
        ) : kind === 'signal' && 'signal' in value ? (
          <StringSelect
            id={`${idPrefix}-signal`}
            value={value.signal}
            options={signalNames(definition)}
            placeholder="Señal"
            empty="No hay señales declaradas todavía."
            onChange={signal => onChange({ signal })}
          />
        ) : kind === 'flag' && 'flag' in value ? (
          <FlagOperandEditor
            definition={definition}
            value={value.flag}
            onChange={flag => onChange({ flag })}
            idPrefix={idPrefix}
          />
        ) : kind === 'input' && 'input' in value ? (
          <StringSelect
            id={`${idPrefix}-input`}
            value={value.input}
            options={inputPaths(definition)}
            placeholder="Campo de entrada"
            empty="No hay campos de entrada declarados todavía."
            onChange={input => onChange({ input })}
          />
        ) : 'value' in value ? (
          <LiteralEditor
            id={`${idPrefix}-value`}
            value={value.value}
            expectedType={expectedType}
            onChange={next => onChange({ value: next })}
          />
        ) : null}
      </div>
    </div>
  )
}

/** A flag name: existing ones in a select, or type a new one (flag rules can raise flags not seen yet elsewhere). */
function FlagOperandEditor({
  definition,
  value,
  onChange,
  idPrefix
}: {
  definition: TemplateDefinition
  value: string
  onChange: (value: string) => void
  idPrefix: string
}) {
  const known = flagNames(definition)
  if (known.length === 0 || (value !== '' && !known.includes(value))) {
    return (
      <Input
        id={`${idPrefix}-flag`}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder="nombre_de_marca"
        className="font-mono"
      />
    )
  }
  return (
    <StringSelect
      id={`${idPrefix}-flag`}
      value={value}
      options={known}
      placeholder="Marca"
      empty="Ninguna regla de marcas declara una marca todavía."
      onChange={onChange}
    />
  )
}
