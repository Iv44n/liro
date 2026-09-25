import {
  ChevronDownIcon,
  ChevronUpIcon,
  PlusIcon,
  ShieldAlertIcon,
  Trash2Icon
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  INPUT_FIELD_TYPES,
  type InputField,
  type InputFieldType
} from '#/features/templates/types/definition'
import { STORE_INPUT_MODES } from '#/sdk/modules/templates/types'
import { Button } from '#/shared/components/ui/button'
import { Checkbox } from '#/shared/components/ui/checkbox'
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
import { Switch } from '#/shared/components/ui/switch'
import { useUpdateTemplate } from '../../hooks/use-template-mutations'
import { pathError } from '../../schemas/definition'
import { useEditorContext, useEditorStore } from '../../store/editor-context'
import {
  addField,
  includeState,
  moveField,
  removeField,
  removeIncludeExtra,
  renameInputPath,
  setAllIncluded,
  setContext,
  setFieldIncluded,
  updateField
} from '../../utils/definition-ops'
import { FIELD_TYPE_LABELS, STORE_INPUT_TEXTS } from '../../utils/format'
import {
  isJsonObject,
  parseJsonText,
  stringifyJson
} from '../../utils/json-text'
import { JsonField } from '../json-field'

const FIELD_TYPE_OPTIONS = INPUT_FIELD_TYPES.map(type => ({
  value: type,
  label: FIELD_TYPE_LABELS[type]
}))

function FieldRow({
  field,
  index,
  total,
  onUpdate,
  onRename,
  onRemove,
  onMove
}: {
  field: InputField
  index: number
  total: number
  onUpdate: (patch: Partial<InputField>) => void
  onRename: (path: string) => void
  onRemove: () => void
  onMove: (offset: -1 | 1) => void
}) {
  const [pathDraft, setPathDraft] = useState(field.path)
  const pathIssue = pathDraft.trim()
    ? pathError(pathDraft.trim())
    : 'Obligatorio'

  return (
    <div
      className="space-y-3 rounded-2xl border p-3"
      data-lint-target={`input.fields.${index}`}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-40 flex-1 space-y-1">
          <FieldLabel className="text-xs font-medium text-muted-foreground">
            Ruta
          </FieldLabel>
          <Input
            value={pathDraft}
            onChange={event => setPathDraft(event.target.value)}
            onBlur={() => {
              const trimmed = pathDraft.trim()
              if (trimmed && trimmed !== field.path && !pathError(trimmed)) {
                onRename(trimmed)
              } else {
                setPathDraft(field.path)
              }
            }}
            placeholder="ticket.message"
            className="font-mono text-sm"
            aria-invalid={pathDraft !== field.path && Boolean(pathIssue)}
          />
          {pathDraft !== field.path && pathIssue ? (
            <p className="text-xs text-destructive">{pathIssue}</p>
          ) : null}
        </div>

        <div className="w-40 space-y-1">
          <FieldLabel className="text-xs font-medium text-muted-foreground">
            Tipo
          </FieldLabel>
          <Select
            items={FIELD_TYPE_OPTIONS}
            value={field.type}
            onValueChange={value => onUpdate({ type: value as InputFieldType })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INPUT_FIELD_TYPES.map(type => (
                <SelectItem key={type} value={type}>
                  {FIELD_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3 self-end pb-1.5">
          <FieldLabel className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <Switch
              checked={field.required}
              onCheckedChange={checked => onUpdate({ required: checked })}
              size="sm"
            />
            Obligatorio
          </FieldLabel>
          <FieldLabel
            className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground"
            title="Nunca se guarda en una ejecución, aunque la política lo lea."
          >
            <Switch
              checked={field.pii ?? false}
              onCheckedChange={checked => onUpdate({ pii: checked })}
              size="sm"
            />
            <ShieldAlertIcon className="size-3.5" aria-hidden="true" />
            Dato personal
          </FieldLabel>
        </div>

        <div className="ms-auto flex items-center gap-1 self-end pb-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Subir campo"
          >
            <ChevronUpIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label="Bajar campo"
          >
            <ChevronDownIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label="Quitar campo"
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </div>
      </div>

      <Field className="gap-1">
        <FieldLabel className="text-xs text-muted-foreground">
          Descripción (opcional)
        </FieldLabel>
        <Input
          value={field.description ?? ''}
          onChange={event => onUpdate({ description: event.target.value })}
          placeholder="Qué contiene este campo"
        />
      </Field>

      {field.type === 'enum' ? (
        <Field className="gap-1">
          <FieldLabel className="text-xs text-muted-foreground">
            Valores permitidos
          </FieldLabel>
          <Input
            value={(field.enum ?? []).join(', ')}
            onChange={event =>
              onUpdate({
                enum: event.target.value
                  .split(',')
                  .map(value => value.trim())
                  .filter(Boolean)
              })
            }
            placeholder="urgente, normal, baja"
          />
          <FieldDescription>Sepáralos con comas.</FieldDescription>
        </Field>
      ) : null}

      {field.type === 'string' ? (
        <Field className="gap-1">
          <FieldLabel className="text-xs text-muted-foreground">
            Longitud máxima (opcional)
          </FieldLabel>
          <Input
            type="number"
            min={1}
            value={field.maxLength ?? ''}
            onChange={event =>
              onUpdate({
                maxLength: event.target.value
                  ? Number(event.target.value)
                  : undefined
              })
            }
            className="w-32"
          />
        </Field>
      ) : null}
    </div>
  )
}

function IncludeSection() {
  const definition = useEditorStore(state => state.definition)
  const update = useEditorStore(state => state.update)
  const { readOnly } = useEditorContext()
  if (!definition) return null

  const state = includeState(definition)
  const fields = definition.input.fields

  return (
    <Field className="gap-2" data-lint-target="state.include">
      <FieldLabel>Enviar a Jev</FieldLabel>
      <FieldDescription>
        Qué campos declarados viajan en el estado que evalúa el modelo. Los que
        no marques siguen disponibles para condiciones que se evalúan antes de
        llamar a Jev (precondiciones), pero Jev nunca los ve.
      </FieldDescription>
      {fields.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Añade campos de entrada primero.
        </p>
      ) : (
        <div className="space-y-1.5">
          <FieldLabel className="flex items-center gap-2 text-sm font-normal">
            <Checkbox
              checked={state.all}
              onCheckedChange={checked =>
                update(d => setAllIncluded(d, checked === true))
              }
              disabled={readOnly}
            />
            Todos
          </FieldLabel>
          {fields.map(field => (
            <FieldLabel
              key={field.path}
              className="flex items-center gap-2 text-sm font-normal"
            >
              <Checkbox
                checked={state.included.has(field.path)}
                onCheckedChange={checked =>
                  update(d => setFieldIncluded(d, field.path, checked === true))
                }
                disabled={readOnly}
              />
              <code className="text-xs">{field.path}</code>
            </FieldLabel>
          ))}
        </div>
      )}
      {state.extras.length > 0 ? (
        <div className="space-y-1 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
          <p>Se envían rutas que ya no son campos declarados:</p>
          {state.extras.map(extra => (
            <div
              key={extra}
              className="flex items-center justify-between gap-2"
            >
              <code>{extra}</code>
              <button
                type="button"
                className="underline"
                onClick={() => update(d => removeIncludeExtra(d, extra))}
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </Field>
  )
}

function ContextSection() {
  const context = useEditorStore(state => state.definition?.state.context)
  const update = useEditorStore(state => state.update)
  const setInvalid = useEditorStore(state => state.setInvalid)
  const [text, setText] = useState(() => stringifyJson(context))

  return (
    <div data-lint-target="state.context">
      <JsonField
        label="Contexto estático (opcional)"
        description="JSON fijo que se añade al estado que ve Jev en cada ejecución (p. ej. políticas de la organización). No debe repetir claves de los campos de entrada."
        value={text}
        onChange={next => {
          setText(next)
          const result = parseJsonText(next)
          setInvalid(
            'input.context',
            result.ok ? null : `contexto estático (${result.error})`
          )
        }}
        onValidChange={value => {
          if (value === undefined) {
            update(d => setContext(d, undefined))
          } else if (isJsonObject(value)) {
            update(d => setContext(d, value as Record<string, never>))
          }
        }}
        placeholder='{ "policy_version": "2026-01" }'
      />
    </div>
  )
}

const RETENTION_FOREVER = 'forever'

function StorageSettings() {
  const { templateId, template, readOnly } = useEditorContext()
  const setPending = useEditorStore(state => state.setPending)
  const { mutate, isPending } = useUpdateTemplate(templateId)

  const [storeInput, setStoreInput] = useState(template.storeInput)
  const [retention, setRetention] = useState(
    template.retentionDays === null
      ? RETENTION_FOREVER
      : String(template.retentionDays)
  )

  const dirty =
    storeInput !== template.storeInput ||
    retention !==
      (template.retentionDays === null
        ? RETENTION_FOREVER
        : String(template.retentionDays))

  const handleChange = (next: {
    storeInput?: typeof storeInput
    retention?: string
  }) => {
    const nextStoreInput = next.storeInput ?? storeInput
    const nextRetention = next.retention ?? retention
    setStoreInput(nextStoreInput)
    setRetention(nextRetention)
    const isDirty =
      nextStoreInput !== template.storeInput ||
      nextRetention !==
        (template.retentionDays === null
          ? RETENTION_FOREVER
          : String(template.retentionDays))
    setPending(
      'templateSettings',
      isDirty ? 'los ajustes de almacenamiento' : null
    )
  }

  const handleSave = () => {
    const days = retention === RETENTION_FOREVER ? null : Number(retention)
    if (
      retention !== RETENTION_FOREVER &&
      (!Number.isInteger(days) || (days ?? 0) < 1)
    ) {
      toast.error('Días de retención no válidos', {
        description: 'Usa un número entero de 1 o más, o "para siempre".'
      })
      return
    }
    mutate(
      { storeInput, retentionDays: days },
      { onSuccess: () => setPending('templateSettings', null) }
    )
  }

  return (
    <div className="space-y-4 rounded-2xl border p-4">
      <div>
        <h3 className="text-sm font-semibold">Almacenamiento de la entrada</h3>
        <p className="text-xs text-muted-foreground">
          Qué guarda cada ejecución de su entrada, y por cuánto tiempo. Los
          campos marcados como dato personal nunca se guardan.
        </p>
      </div>

      <Field className="gap-2">
        {STORE_INPUT_MODES.map(mode => (
          <label
            key={mode}
            className="flex items-start gap-2 rounded-xl border p-2.5 text-sm has-data-checked:border-primary/40 has-data-checked:bg-primary/5"
          >
            <input
              type="radio"
              name="storeInput"
              className="mt-1"
              checked={storeInput === mode}
              onChange={() => handleChange({ storeInput: mode })}
              disabled={readOnly}
            />
            <span>
              <span className="block font-medium">
                {STORE_INPUT_TEXTS[mode].label}
              </span>
              <span className="block text-xs text-muted-foreground">
                {STORE_INPUT_TEXTS[mode].description}
              </span>
            </span>
          </label>
        ))}
      </Field>

      <Field orientation="horizontal" className="items-center gap-3">
        <FieldLabel className="w-40 shrink-0">Retención</FieldLabel>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            checked={retention === RETENTION_FOREVER}
            onChange={() => handleChange({ retention: RETENTION_FOREVER })}
            disabled={readOnly}
          />
          Para siempre
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            checked={retention !== RETENTION_FOREVER}
            onChange={() =>
              handleChange({
                retention: retention === RETENTION_FOREVER ? '30' : retention
              })
            }
            disabled={readOnly}
          />
          <Input
            type="number"
            min={1}
            className="w-24"
            value={retention === RETENTION_FOREVER ? '' : retention}
            onChange={event => handleChange({ retention: event.target.value })}
            disabled={readOnly || retention === RETENTION_FOREVER}
          />
          días
        </label>
      </Field>

      {readOnly ? null : (
        <Button
          variant="outline"
          className="rounded-md"
          disabled={!dirty || isPending}
          onClick={handleSave}
        >
          {isPending ? 'Guardando…' : 'Guardar ajustes'}
        </Button>
      )}
    </div>
  )
}

export function InputTab() {
  const definition = useEditorStore(state => state.definition)
  const update = useEditorStore(state => state.update)
  if (!definition) return null
  const fields = definition.input.fields

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Campos de entrada</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => update(d => addField(d))}
          >
            <PlusIcon aria-hidden="true" />
            Añadir campo
          </Button>
        </div>

        {fields.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            Sin campos declarados todavía. Añade al menos uno para describir qué
            recibe esta decisión.
          </p>
        ) : (
          <div className="space-y-3">
            {fields.map((field, index) => (
              <FieldRow
                key={field.path}
                field={field}
                index={index}
                total={fields.length}
                onUpdate={patch => update(d => updateField(d, index, patch))}
                onRename={path =>
                  update(d => renameInputPath(d, field.path, path))
                }
                onRemove={() => update(d => removeField(d, index))}
                onMove={offset => update(d => moveField(d, index, offset))}
              />
            ))}
          </div>
        )}
      </div>

      <IncludeSection />
      <ContextSection />
      <StorageSettings />
    </div>
  )
}
