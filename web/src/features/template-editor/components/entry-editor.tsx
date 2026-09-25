import { useRef, useState } from 'react'
import type { EntryType } from '#/features/templates/types/definition'
import { Field, FieldError, FieldLabel } from '#/shared/components/ui/field'
import { Textarea } from '#/shared/components/ui/textarea'
import {
  ToggleGroup,
  ToggleGroupItem
} from '#/shared/components/ui/toggle-group'
import {
  asStructured,
  type EntryKind,
  entryMode,
  entryToJson,
  isBlankEntry,
  parseEntryJson,
  STRUCTURED_KEYS,
  setStructuredKey,
  structuredText,
  structuredToText,
  textToStructured
} from '../utils/entry'
import { InsertFieldMenu } from './insert-field-menu'

/**
 * Editor for one `EntryType` — a question's `instructions`, or one criteria
 * entry (a Choice option, a Score level, a boolean outcome): plain text, a
 * small structured form (the fields differ by `kind`), or raw JSON for
 * anything that doesn't fit the form. Switching between text and structured
 * converts the content instead of discarding it.
 */
export function EntryEditor({
  label,
  kind,
  value,
  onChange,
  allowNull = false,
  fieldPaths,
  placeholder,
  dataLintTarget
}: {
  label: string
  kind: EntryKind
  value: EntryType | null
  onChange: (value: EntryType | null) => void
  /** Criteria may be absent ("sin criterio propio"); instructions may not. */
  allowNull?: boolean
  fieldPaths: readonly string[]
  placeholder?: string
  dataLintTarget?: string
}) {
  const textRef = useRef<HTMLTextAreaElement>(null)

  if (allowNull && value === null) {
    return (
      <Field className="gap-1.5" data-lint-target={dataLintTarget}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FieldLabel className="text-muted-foreground">{label}</FieldLabel>
          <button
            type="button"
            className="text-xs text-primary underline underline-offset-2 hover:no-underline"
            onClick={() => onChange('')}
          >
            Añadir criterio propio
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Sin criterio propio: Jev decide solo con el nombre y las instrucciones
          generales.
        </p>
      </Field>
    )
  }

  const mode = entryMode(value, kind)
  const structured = asStructured(value, kind) ?? {}

  const switchMode = (next: 'text' | 'structured') => {
    if (next === mode) return
    if (next === 'text') {
      onChange(mode === 'structured' ? structuredToText(structured, kind) : '')
    } else {
      const converted = textToStructured(
        typeof value === 'string' ? value : '',
        kind
      )
      onChange(converted)
    }
  }

  return (
    <Field className="gap-1.5" data-lint-target={dataLintTarget}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        <div className="flex items-center gap-2">
          {mode === 'json' ? (
            <span className="text-xs text-muted-foreground">JSON avanzado</span>
          ) : (
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              value={[mode]}
              onValueChange={values => {
                const [next] = values
                if (next === 'text' || next === 'structured') switchMode(next)
              }}
              aria-label={`Tipo de ${label.toLowerCase()}`}
            >
              <ToggleGroupItem value="text">Texto</ToggleGroupItem>
              <ToggleGroupItem value="structured">Estructurado</ToggleGroupItem>
            </ToggleGroup>
          )}
          {allowNull ? (
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => onChange(null)}
            >
              Quitar
            </button>
          ) : null}
        </div>
      </div>

      {mode === 'text' ? (
        <div className="space-y-1.5">
          <Textarea
            ref={textRef}
            value={typeof value === 'string' ? value : ''}
            onChange={event => onChange(event.target.value)}
            placeholder={placeholder}
            rows={3}
          />
          <InsertFieldMenu
            paths={fieldPaths}
            target={textRef}
            value={typeof value === 'string' ? value : ''}
            onChange={onChange}
          />
        </div>
      ) : mode === 'structured' ? (
        <StructuredFields
          kind={kind}
          value={structured}
          onChange={next => onChange(next ?? (allowNull ? null : {}))}
          fieldPaths={fieldPaths}
        />
      ) : (
        <RawJsonEntry value={value} onChange={onChange} />
      )}

      {allowNull && isBlankEntry(value) && mode !== 'json' ? (
        <p className="text-xs text-muted-foreground">
          Está vacío: se guardará sin criterio propio.
        </p>
      ) : null}
    </Field>
  )
}

function StructuredFields({
  kind,
  value,
  onChange,
  fieldPaths
}: {
  kind: EntryKind
  value: Record<string, string | string[]>
  onChange: (value: Record<string, string | string[]> | null) => void
  fieldPaths: readonly string[]
}) {
  const refs = useRef<Record<string, HTMLTextAreaElement | null>>({})

  return (
    <div className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
      {STRUCTURED_KEYS[kind].map(spec => {
        const text = structuredText(value[spec.key])
        return (
          <div key={spec.key} className="space-y-1.5">
            <label
              htmlFor={`entry-${kind}-${spec.key}`}
              className="text-xs font-medium text-muted-foreground"
            >
              {spec.label}
            </label>
            <Textarea
              id={`entry-${kind}-${spec.key}`}
              ref={el => {
                refs.current[spec.key] = el
              }}
              value={text}
              onChange={event =>
                onChange(setStructuredKey(value, spec, event.target.value))
              }
              placeholder={spec.placeholder}
              rows={spec.list ? 3 : 2}
              className="text-sm"
            />
            {spec.hint ? (
              <p className="text-[11px] text-muted-foreground">{spec.hint}</p>
            ) : null}
            <InsertFieldMenu
              paths={fieldPaths}
              target={{ current: refs.current[spec.key] ?? null }}
              value={text}
              onChange={next => onChange(setStructuredKey(value, spec, next))}
            />
          </div>
        )
      })}
    </div>
  )
}

function RawJsonEntry({
  value,
  onChange
}: {
  value: EntryType | null
  onChange: (value: EntryType | null) => void
}) {
  const [text, setText] = useState(() => entryToJson(value))
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        Este contenido no tiene la forma del editor estructurado (una lista, o
        campos propios): edítalo como JSON.
      </p>
      <Textarea
        value={text}
        onChange={event => {
          setText(event.target.value)
          const parsed = parseEntryJson(event.target.value)
          if (parsed.ok) {
            setError(null)
            onChange(parsed.entry)
          } else {
            setError(parsed.error)
          }
        }}
        rows={4}
        className="font-mono text-xs"
        aria-invalid={error !== null}
      />
      {error ? <FieldError errors={[{ message: error }]} /> : null}
    </div>
  )
}
