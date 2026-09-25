import {
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  Trash2Icon
} from 'lucide-react'
import { useState } from 'react'
import { WhenBuilder } from '#/features/policy-editor/components/when-builder'
import { usePolicyLint } from '#/features/policy-editor/hooks/use-policy-lint'
import type { LintIssue } from '#/features/templates/types/definition'
import {
  type EntryType,
  QUESTION_TYPES,
  type QuestionDef,
  type QuestionType
} from '#/features/templates/types/definition'
import { Button } from '#/shared/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldLabel
} from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'
import { Textarea } from '#/shared/components/ui/textarea'
import { keyError, labelError } from '../../schemas/definition'
import { useEditorContext, useEditorStore } from '../../store/editor-context'
import {
  addClassifyLabel,
  addQuestion,
  convertQuestion,
  isQuestionReferenced,
  move,
  moveQuestion,
  QUESTION_DEFAULT_IDS,
  removeClassifyLabel,
  removeQuestion,
  renameClassifyLabel,
  renameLevel,
  renameOption,
  renameQuestion,
  setQuestion,
  uniqueName
} from '../../utils/definition-ops'
import {
  QUESTION_TYPE_DESCRIPTIONS,
  QUESTION_TYPE_LABELS
} from '../../utils/format'
import { linkedChoiceQuestion } from '../../utils/thresholds'
import { EntryEditor } from '../entry-editor'

const TYPE_OPTIONS = QUESTION_TYPES.map(type => ({
  value: type,
  label: QUESTION_TYPE_LABELS[type]
}))

function ChoiceEditor({
  id,
  question,
  fieldPaths,
  isLinked
}: {
  id: string
  question: Extract<QuestionDef, { type: 'choice' }>
  fieldPaths: readonly string[]
  isLinked: boolean
}) {
  const update = useEditorStore(state => state.update)
  const options = Object.entries(question.criteria)

  const addOption = () => {
    update(d => {
      if (isLinked) return addClassifyLabel(d, id)
      const label = uniqueName('opcion', Object.keys(question.criteria))
      return setQuestion(d, id, {
        ...question,
        criteria: { ...question.criteria, [label]: null }
      })
    })
  }

  const removeOption = (label: string) => {
    update(d => {
      if (isLinked) return removeClassifyLabel(d, id, label)
      return setQuestion(d, id, {
        ...question,
        criteria: Object.fromEntries(
          Object.entries(question.criteria).filter(([key]) => key !== label)
        )
      })
    })
  }

  const renameOptionTo = (from: string, to: string) => {
    update(d =>
      isLinked
        ? renameClassifyLabel(d, id, from, to)
        : renameOption(d, id, from, to)
    )
  }

  return (
    <div className="space-y-3" data-lint-target={`questions.${id}.criteria`}>
      <div className="flex items-center justify-between">
        <FieldLabel>
          Opciones{' '}
          {isLinked ? (
            <span className="font-normal text-muted-foreground">
              (son las etiquetas de decisión)
            </span>
          ) : null}
        </FieldLabel>
        <Button type="button" variant="outline" size="sm" onClick={addOption}>
          <PlusIcon aria-hidden="true" />
          Añadir opción
        </Button>
      </div>
      {options.map(([label, criteria]) => (
        <OptionRow
          key={label}
          label={label}
          criteria={criteria}
          fieldPaths={fieldPaths}
          canRemove={options.length > 2}
          onRename={next => renameOptionTo(label, next)}
          onRemove={() => removeOption(label)}
          onCriteriaChange={value =>
            update(d =>
              setQuestion(d, id, {
                ...question,
                criteria: { ...question.criteria, [label]: value }
              })
            )
          }
        />
      ))}
    </div>
  )
}

function OptionRow({
  label,
  criteria,
  fieldPaths,
  canRemove,
  onRename,
  onRemove,
  onCriteriaChange
}: {
  label: string
  criteria: EntryType | null
  fieldPaths: readonly string[]
  canRemove: boolean
  onRename: (next: string) => void
  onRemove: () => void
  onCriteriaChange: (value: EntryType | null) => void
}) {
  const [draft, setDraft] = useState(label)
  const issue = draft.trim() ? labelError(draft.trim()) : 'Obligatorio'

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-1">
          <Input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => {
              const trimmed = draft.trim()
              if (trimmed && trimmed !== label && !labelError(trimmed))
                onRename(trimmed)
              else setDraft(label)
            }}
            className="font-mono text-sm"
          />
          {draft !== label && issue ? (
            <p className="text-xs text-destructive">{issue}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={`Quitar la opción ${label}`}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
      <EntryEditor
        label="Criterio"
        kind="criteria"
        value={criteria}
        onChange={onCriteriaChange}
        allowNull
        fieldPaths={fieldPaths}
      />
    </div>
  )
}

function ScoreEditor({
  id,
  question,
  fieldPaths
}: {
  id: string
  question: Extract<QuestionDef, { type: 'score' }>
  fieldPaths: readonly string[]
}) {
  const update = useEditorStore(state => state.update)
  const { levels } = question

  return (
    <div className="space-y-3" data-lint-target={`questions.${id}.levels`}>
      <div className="flex items-center justify-between">
        <FieldLabel>Niveles (del más bajo al más alto)</FieldLabel>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={levels.length >= 10}
          onClick={() =>
            update(d => {
              const label = uniqueName(
                'nivel',
                levels.map(l => l.label)
              )
              return setQuestion(d, id, {
                ...question,
                levels: [...levels, { label, criteria: null }]
              })
            })
          }
        >
          <PlusIcon aria-hidden="true" />
          Añadir nivel
        </Button>
      </div>
      {levels.map((level, index) => (
        <LevelRow
          key={level.label}
          index={index}
          label={level.label}
          criteria={level.criteria}
          total={levels.length}
          fieldPaths={fieldPaths}
          onRename={next => update(d => renameLevel(d, id, index, next))}
          onMove={offset =>
            update(d =>
              setQuestion(d, id, {
                ...question,
                levels: move(levels, index, offset)
              })
            )
          }
          onRemove={() =>
            update(d =>
              setQuestion(d, id, {
                ...question,
                levels: levels.filter((_, position) => position !== index)
              })
            )
          }
          canRemove={levels.length > 2}
          onCriteriaChange={value =>
            update(d =>
              setQuestion(d, id, {
                ...question,
                levels: levels.map((l, position) =>
                  position === index ? { ...l, criteria: value } : l
                )
              })
            )
          }
        />
      ))}
    </div>
  )
}

function LevelRow({
  index,
  label,
  criteria,
  total,
  fieldPaths,
  canRemove,
  onRename,
  onMove,
  onRemove,
  onCriteriaChange
}: {
  index: number
  label: string
  criteria: EntryType | null
  total: number
  fieldPaths: readonly string[]
  canRemove: boolean
  onRename: (next: string) => void
  onMove: (offset: -1 | 1) => void
  onRemove: () => void
  onCriteriaChange: (value: EntryType | null) => void
}) {
  const [draft, setDraft] = useState(label)
  const issue = draft.trim() ? labelError(draft.trim()) : 'Obligatorio'

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex items-start gap-2">
        <span className="mt-2 text-xs text-muted-foreground">{index + 1}.</span>
        <div className="flex-1 space-y-1">
          <Input
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => {
              const trimmed = draft.trim()
              if (trimmed && trimmed !== label && !labelError(trimmed))
                onRename(trimmed)
              else setDraft(label)
            }}
            className="font-mono text-sm"
          />
          {draft !== label && issue ? (
            <p className="text-xs text-destructive">{issue}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label="Subir nivel"
        >
          <ChevronUpIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label="Bajar nivel"
        >
          <ChevronDownIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={`Quitar el nivel ${label}`}
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
      <EntryEditor
        label="Criterio"
        kind="criteria"
        value={criteria}
        onChange={onCriteriaChange}
        allowNull
        fieldPaths={fieldPaths}
      />
    </div>
  )
}

function BooleanEditor({
  id,
  question,
  fieldPaths
}: {
  id: string
  question: Extract<QuestionDef, { type: 'boolean' }>
  fieldPaths: readonly string[]
}) {
  const update = useEditorStore(state => state.update)
  const setOutcome = (outcome: 'true' | 'false', value: EntryType | null) =>
    update(d =>
      setQuestion(d, id, {
        ...question,
        criteria: { ...question.criteria, [outcome]: value }
      })
    )

  return (
    <div
      className="grid gap-3 sm:grid-cols-2"
      data-lint-target={`questions.${id}.criteria`}
    >
      <EntryEditor
        label="Criterio para «sí»"
        kind="criteria"
        value={question.criteria?.true ?? null}
        onChange={value => setOutcome('true', value)}
        allowNull
        fieldPaths={fieldPaths}
      />
      <EntryEditor
        label="Criterio para «no»"
        kind="criteria"
        value={question.criteria?.false ?? null}
        onChange={value => setOutcome('false', value)}
        allowNull
        fieldPaths={fieldPaths}
      />
    </div>
  )
}

function QuestionCard({
  id,
  question,
  index,
  total,
  fieldPaths,
  isLinked,
  issues,
  onMove
}: {
  id: string
  question: QuestionDef
  index: number
  total: number
  fieldPaths: readonly string[]
  isLinked: boolean
  issues: readonly LintIssue[]
  onMove: (offset: -1 | 1) => void
}) {
  const update = useEditorStore(state => state.update)
  const definition = useEditorStore(state => state.definition)
  const [draftId, setDraftId] = useState(id)
  const idIssue = draftId.trim() ? keyError(draftId.trim()) : 'Obligatorio'
  const referenced = definition ? isQuestionReferenced(definition, id) : true

  return (
    <div
      className="space-y-3 rounded-2xl border p-3"
      data-lint-target={`questions.${id}`}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-32 flex-1 space-y-1">
          <FieldLabel className="text-xs font-medium text-muted-foreground">
            Id
          </FieldLabel>
          <Input
            value={draftId}
            onChange={event => setDraftId(event.target.value)}
            onBlur={() => {
              const trimmed = draftId.trim()
              if (
                trimmed &&
                trimmed !== id &&
                !keyError(trimmed) &&
                definition &&
                !Object.hasOwn(definition.questions, trimmed)
              ) {
                update(d => renameQuestion(d, id, trimmed))
              } else {
                setDraftId(id)
              }
            }}
            className="font-mono text-sm"
            disabled={isLinked}
          />
          {draftId !== id && idIssue ? (
            <p className="text-xs text-destructive">{idIssue}</p>
          ) : null}
        </div>
        <div className="w-40 space-y-1">
          <FieldLabel className="text-xs font-medium text-muted-foreground">
            Tipo
          </FieldLabel>
          <Select
            items={TYPE_OPTIONS}
            value={question.type}
            onValueChange={value =>
              update(d =>
                setQuestion(
                  d,
                  id,
                  convertQuestion(question, value as QuestionType)
                )
              )
            }
          >
            <SelectTrigger className="w-full" disabled={isLinked}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ms-auto flex items-center gap-1 self-end pb-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Subir pregunta"
          >
            <ChevronUpIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Bajar pregunta"
          >
            <ChevronDownIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => update(d => removeQuestion(d, id))}
            disabled={isLinked}
            aria-label={`Quitar la pregunta ${id}`}
            title={
              isLinked
                ? 'Esta pregunta define las etiquetas de decisión'
                : undefined
            }
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </div>
      </div>

      {!referenced ? (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Nada lee esta pregunta todavía, pero se le pregunta al modelo en cada
          ejecución.
        </p>
      ) : null}

      <EntryEditor
        label="Instrucciones"
        kind="instructions"
        value={question.instructions}
        onChange={value =>
          update(d =>
            setQuestion(d, id, { ...question, instructions: value ?? '' })
          )
        }
        fieldPaths={fieldPaths}
        placeholder="Qué debe determinar el modelo con esta pregunta"
        dataLintTarget={`questions.${id}.instructions`}
      />

      {question.type === 'choice' ? (
        <ChoiceEditor
          id={id}
          question={question}
          fieldPaths={fieldPaths}
          isLinked={isLinked}
        />
      ) : question.type === 'score' ? (
        <ScoreEditor id={id} question={question} fieldPaths={fieldPaths} />
      ) : (
        <BooleanEditor id={id} question={question} fieldPaths={fieldPaths} />
      )}

      {definition ? (
        <WhenBuilder
          definition={definition}
          questionId={id}
          issues={issues}
          onChange={recipe =>
            update(d => {
              const current = d.questions[id]
              if (!current) return d
              const when = recipe(current.when)
              const { when: _current, ...rest } = current
              return setQuestion(
                d,
                id,
                (when ? { ...rest, when } : rest) as QuestionDef
              )
            })
          }
        />
      ) : null}

      <Field className="gap-1">
        <FieldLabel className="text-xs text-muted-foreground">
          Nota interna (opcional)
        </FieldLabel>
        <Textarea
          value={question.note ?? ''}
          onChange={event =>
            update(d =>
              setQuestion(d, id, {
                ...question,
                note: event.target.value || undefined
              })
            )
          }
          placeholder="Para quien edite esta decisión después; nunca se envía al modelo."
          rows={2}
        />
        <FieldDescription>
          Solo la ven quienes editan la decisión.
        </FieldDescription>
      </Field>
    </div>
  )
}

export function QuestionsTab() {
  const definition = useEditorStore(state => state.definition)
  const update = useEditorStore(state => state.update)
  const [newType, setNewType] = useState<QuestionType>('choice')
  const { templateId } = useEditorContext()
  const { issues } = usePolicyLint(templateId, definition)
  if (!definition) return null

  const entries = Object.entries(definition.questions)
  const linked = linkedChoiceQuestion(definition)
  const fieldPaths = definition.input.fields.map(field => field.path)

  const handleAdd = () => {
    const id = uniqueName(
      QUESTION_DEFAULT_IDS[newType],
      Object.keys(definition.questions)
    )
    update(d => addQuestion(d, id, newType))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Preguntas</h2>
        <div className="flex items-center gap-2">
          <Select
            value={newType}
            onValueChange={value => setNewType(value as QuestionType)}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={handleAdd}>
            <PlusIcon aria-hidden="true" />
            Añadir pregunta
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {QUESTION_TYPE_DESCRIPTIONS[newType]}
      </p>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Sin preguntas todavía. El modelo necesita al menos una para poder
          decidir.
        </p>
      ) : (
        <div className="space-y-3">
          {entries.map(([id, question], index) => (
            <QuestionCard
              key={id}
              id={id}
              question={question}
              index={index}
              total={entries.length}
              fieldPaths={fieldPaths}
              isLinked={linked === id}
              issues={issues}
              onMove={offset => update(d => moveQuestion(d, id, offset))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
