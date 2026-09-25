import {
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  Trash2Icon
} from 'lucide-react'
import { Button } from '#/shared/components/ui/button'
import { Field, FieldError, FieldLabel } from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import { DEFINITION_LIMITS } from '../types/definition'
import { emptyLabel, type LabelFormValues } from '../utils/template-form'

interface LevelsListEditorProps {
  levels: LabelFormValues[]
  errors: Record<string, string>
  onChange: (levels: LabelFormValues[]) => void
}

function move<T>(items: T[], index: number, offset: -1 | 1): T[] {
  const target = index + offset
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  if (item === undefined) return items
  next.splice(target, 0, item)
  return next
}

/**
 * The Score wizard's levels: ordered lowest first, 2..10 — like
 * `LabelsListEditor` but reorderable, since a level's position (not its
 * name) is what the engine reads.
 */
export function LevelsListEditor({
  levels,
  errors,
  onChange
}: LevelsListEditorProps) {
  const update = (index: number, patch: Partial<LabelFormValues>) =>
    onChange(
      levels.map((level, i) => (i === index ? { ...level, ...patch } : level))
    )
  const remove = (index: number) =>
    onChange(levels.filter((_, i) => i !== index))
  const add = () => onChange([...levels, emptyLabel()])
  const canRemove = levels.length > DEFINITION_LIMITS.scoreLevels.min

  return (
    <div className="space-y-3">
      {typeof errors.levels === 'string' ? (
        <p className="text-sm text-destructive" role="alert">
          {errors.levels}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Del más bajo al más alto: la posición de un nivel es lo que el motor
        lee, no su nombre.
      </p>

      <ul className="space-y-3">
        {levels.map((level, index) => {
          const prefix = `levels[${index}]`
          const labelError = errors[`${prefix}.label`]

          return (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are fully controlled by props; add/remove/reorder reindexes safely.
              key={index}
              className="flex flex-wrap items-start gap-3 rounded-2xl p-4 ring-1 ring-foreground/10"
            >
              <span className="mt-2 text-xs text-muted-foreground tabular-nums">
                {index + 1}.
              </span>
              <Field
                className="min-w-32 flex-1"
                data-invalid={Boolean(labelError)}
              >
                <FieldLabel htmlFor={`${prefix}-label`}>Nivel</FieldLabel>
                <Input
                  id={`${prefix}-label`}
                  value={level.label}
                  onChange={event =>
                    update(index, { label: event.target.value })
                  }
                  placeholder="bajo"
                  className="font-mono"
                  aria-invalid={Boolean(labelError)}
                />
                {labelError ? <FieldError>{labelError}</FieldError> : null}
              </Field>

              <Field className="min-w-40 flex-[2]">
                <FieldLabel htmlFor={`${prefix}-description`}>
                  Descripción
                </FieldLabel>
                <Input
                  id={`${prefix}-description`}
                  value={level.description}
                  onChange={event =>
                    update(index, { description: event.target.value })
                  }
                  placeholder="Qué caracteriza este nivel (opcional)"
                />
              </Field>

              <div className="flex items-center gap-1 self-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onChange(move(levels, index, -1))}
                  disabled={index === 0}
                  aria-label={`Subir el nivel ${level.label || index + 1}`}
                >
                  <ChevronUpIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onChange(move(levels, index, 1))}
                  disabled={index === levels.length - 1}
                  aria-label={`Bajar el nivel ${level.label || index + 1}`}
                >
                  <ChevronDownIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Quitar el nivel ${level.label || index + 1}`}
                  onClick={() => remove(index)}
                  disabled={!canRemove}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={levels.length >= DEFINITION_LIMITS.scoreLevels.max}
      >
        <PlusIcon aria-hidden="true" />
        Añadir nivel
      </Button>
    </div>
  )
}
