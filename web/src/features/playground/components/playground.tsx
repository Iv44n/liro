import {
  EraserIcon,
  FlaskConicalIcon,
  PlayIcon,
  WandSparklesIcon
} from 'lucide-react'
import {
  type FormEvent,
  type KeyboardEvent,
  useId,
  useRef,
  useState
} from 'react'
import { useMe } from '#/features/auth/hooks/use-me'
import type {
  JsonObject,
  TemplateDefinition
} from '#/features/templates/types/definition'
import type { PlaygroundTestResponse } from '#/sdk/modules/templates/types'
import { Button } from '#/shared/components/ui/button'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { Spinner } from '#/shared/components/ui/spinner'
import { cn } from '#/shared/utils/shadcn.utils'
import {
  type PlaygroundHistoryEntry,
  usePlaygroundHistory
} from '../hooks/use-playground-history'
import { usePlaygroundTest } from '../hooks/use-playground-test'
import { answerViews, describeStage } from '../utils/format'
import {
  buildInput,
  type FieldValue,
  formatJson,
  isoNow,
  parseInputJson,
  sampleInput,
  undeclaredPaths,
  valuesFromInput
} from '../utils/input-form'
import { describeRunError, type RunErrorView } from '../utils/run-errors'
import { fieldDomId } from './input-field-control'
import {
  InputFieldsForm,
  InputJsonEditor,
  type InputMode,
  InputModeToggle
} from './playground-form'
import { PlaygroundHistory } from './playground-history'
import { RunErrorAlert } from './run-error-alert'
import { RunResult } from './run-result'

export interface PlaygroundProps {
  templateId: string
  /** The editor's current (possibly unsaved) definition. */
  definition: TemplateDefinition
}

/** A history entry for a successful test of `definition`. */
function historyEntry(
  response: PlaygroundTestResponse,
  input: JsonObject,
  definition: TemplateDefinition
): PlaygroundHistoryEntry {
  return {
    id: response.run.id,
    at: response.run.completedAt ?? new Date().toISOString(),
    input,
    response,
    stage: describeStage(response.run.rule, definition),
    answers: answerViews(response.run.answers, definition)
  }
}

function ResultSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

/**
 * Test runs of a draft (`POST /api/templates/:id/draft/test`), rendered by
 * the template editor. The input form is generated from the definition's
 * fields (or typed as raw JSON); "Probar" sends it with the unsaved
 * `definition` and shows everything the run returned. Runs are in test mode
 * (no review tasks). The last few are kept for the session.
 */
export function Playground({ templateId, definition }: PlaygroundProps) {
  const idPrefix = useId()
  const fields = definition.input.fields
  const me = useMe()
  // Needs `template:update`; while `/api/me` loads, wait (on error, let the API decide).
  const canTest = me.data ? me.data.permissions.template.update : me.isError
  const history = usePlaygroundHistory(templateId)
  const test = usePlaygroundTest(templateId)

  const [mode, setMode] = useState<InputMode>('form')
  const [values, setValues] = useState<Record<string, FieldValue>>({})
  const [jsonText, setJsonText] = useState('{}')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
  const [runError, setRunError] = useState<RunErrorView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const lastInput = useRef<JsonObject | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const selected =
    history.entries.find(entry => entry.id === selectedId) ??
    history.entries[0] ??
    null
  const fieldErrors = { ...(runError?.fieldErrors ?? {}), ...clientErrors }

  const clearErrors = () => {
    setClientErrors({})
    setRunError(null)
    setJsonError(null)
  }

  const changeField = (path: string, value: FieldValue) => {
    setValues(current => ({ ...current, [path]: value }))
    setClientErrors(({ [path]: _removed, ...rest }) => rest)
    setRunError(current => {
      if (!current || !(path in current.fieldErrors)) return current
      const { [path]: _cleared, ...fieldErrorsLeft } = current.fieldErrors
      return { ...current, fieldErrors: fieldErrorsLeft }
    })
  }

  const changeMode = (next: InputMode) => {
    if (next === mode) return
    setNotice(null)
    if (next === 'json') {
      setJsonText(formatJson(buildInput(fields, values).input))
      setJsonError(null)
      setMode('json')
      return
    }
    const parsed = parseInputJson(jsonText)
    if (!parsed.ok) {
      setJsonError(`${parsed.error} Corrígelo para volver al formulario.`)
      return
    }
    setValues(valuesFromInput(fields, parsed.input))
    const dropped = undeclaredPaths(fields, parsed.input)
    if (dropped.length > 0) {
      setNotice(
        `El formulario no muestra claves que ningún campo declara: ${dropped.join(', ')}.`
      )
    }
    setJsonError(null)
    setClientErrors({})
    setMode('form')
  }

  const fillSample = () => {
    const sample = sampleInput(fields, { datetime: isoNow() })
    setValues(valuesFromInput(fields, sample))
    setJsonText(formatJson(sample))
    setNotice(null)
    clearErrors()
  }

  const clearInput = () => {
    setValues({})
    setJsonText('{}')
    setNotice(null)
    clearErrors()
  }

  const run = (input: JsonObject) => {
    lastInput.current = input
    const sent = definition
    setRunError(null)
    test.mutate(
      { input, definition: sent },
      {
        onSuccess: response => {
          const entry = historyEntry(response, input, sent)
          history.add(entry)
          setSelectedId(entry.id)
        },
        onError: error => setRunError(describeRunError(error, fields))
      }
    )
  }

  const focusField = (path: string) => {
    const element = document.getElementById(fieldDomId(idPrefix, path))
    element?.focus()
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!canTest || test.isPending) return
    setNotice(null)

    if (mode === 'json') {
      const parsed = parseInputJson(jsonText)
      if (!parsed.ok) {
        setJsonError(parsed.error)
        return
      }
      setJsonError(null)
      run(parsed.input)
      return
    }

    const built = buildInput(fields, values)
    const invalid = Object.keys(built.errors)
    if (invalid.length > 0) {
      setClientErrors(built.errors)
      setRunError(null)
      const first = fields.find(field => field.path in built.errors)
      if (first) focusField(first.path)
      return
    }
    setClientErrors({})
    run(built.input)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  const reuse = (entry: PlaygroundHistoryEntry) => {
    setValues(valuesFromInput(fields, entry.input))
    setJsonText(formatJson(entry.input))
    setSelectedId(entry.id)
    setNotice(null)
    clearErrors()
    formRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const busy = test.isPending

  return (
    <section
      aria-labelledby={`${idPrefix}-title`}
      className="@container flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4"
    >
      <header className="space-y-1">
        <h2
          id={`${idPrefix}-title`}
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <FlaskConicalIcon aria-hidden className="size-4 text-primary" />
          Playground
        </h2>
        <p className="text-xs text-muted-foreground">
          Prueba la definición actual, con los cambios sin guardar. Son
          ejecuciones de prueba: no crean tareas de revisión.
        </p>
      </header>

      <form
        ref={formRef}
        onSubmit={submit}
        onKeyDown={onKeyDown}
        noValidate
        className="flex flex-col gap-4"
        aria-describedby={`${idPrefix}-shortcut`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <InputModeToggle mode={mode} onModeChange={changeMode} />
          <div className="ms-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={fillSample}
              disabled={fields.length === 0}
              title="Rellenar con valores de ejemplo"
            >
              <WandSparklesIcon aria-hidden />
              Ejemplo
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={clearInput}
              aria-label="Vaciar la entrada"
              title="Vaciar la entrada"
            >
              <EraserIcon aria-hidden />
            </Button>
          </div>
        </div>

        {mode === 'form' ? (
          <InputFieldsForm
            fields={fields}
            values={values}
            errors={fieldErrors}
            onChange={changeField}
            idPrefix={idPrefix}
          />
        ) : (
          <InputJsonEditor
            id={`${idPrefix}-json`}
            value={jsonText}
            onChange={text => {
              setJsonText(text)
              setJsonError(null)
            }}
            error={jsonError}
          />
        )}

        {notice ? (
          <output className="block text-xs text-muted-foreground">
            {notice}
          </output>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button type="submit" disabled={!canTest || busy}>
            {busy ? <Spinner aria-hidden /> : <PlayIcon aria-hidden />}
            {busy ? 'Probando…' : 'Probar'}
          </Button>
          <span
            id={`${idPrefix}-shortcut`}
            className="hidden text-xs text-muted-foreground @sm:inline"
          >
            Ctrl + Enter para probar
          </span>
          {me.data && !canTest ? (
            <p className="w-full text-xs text-muted-foreground">
              Tu rol no puede probar borradores: se necesita permiso para editar
              decisiones.
            </p>
          ) : null}
        </div>
      </form>

      <div aria-live="polite" aria-busy={busy} className="min-w-0 space-y-4">
        {runError ? (
          <RunErrorAlert
            error={runError}
            fieldsShown={mode === 'form'}
            retrying={busy}
            onRetry={
              lastInput.current
                ? () => {
                    if (lastInput.current) run(lastInput.current)
                  }
                : undefined
            }
          />
        ) : null}

        {busy && !selected ? <ResultSkeleton /> : null}

        {selected ? (
          <div className={cn('transition-opacity', busy && 'opacity-50')}>
            <h3 className="sr-only">Resultado</h3>
            <RunResult
              run={selected.response.run}
              trace={selected.response.trace}
              lint={selected.response.lint}
              stage={selected.stage}
              answers={selected.answers}
            />
          </div>
        ) : !busy && !runError ? (
          <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
            Completa la entrada (o usa{' '}
            <span className="font-medium text-foreground">Ejemplo</span>) y
            pulsa <span className="font-medium text-foreground">Probar</span>{' '}
            para ver la decisión, la confianza y las respuestas de Jev.
          </p>
        ) : null}
      </div>

      <PlaygroundHistory
        entries={history.entries}
        selectedId={selected?.id ?? null}
        onSelect={entry => setSelectedId(entry.id)}
        onReuse={reuse}
        onClear={() => {
          history.clear()
          setSelectedId(null)
        }}
      />
    </section>
  )
}
