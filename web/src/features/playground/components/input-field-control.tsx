import { ClockIcon, XIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { InputField } from '#/features/templates/types/definition'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
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
import { Textarea } from '#/shared/components/ui/textarea'
import {
  controlOf,
  DATETIME_HINT,
  type FieldValue,
  isoNow
} from '../utils/input-form'

const TYPE_LABELS: Record<InputField['type'], string> = {
  string: 'texto',
  number: 'número',
  integer: 'entero',
  boolean: 'sí/no',
  datetime: 'fecha',
  enum: 'lista',
  array: 'array JSON',
  object: 'objeto JSON'
}

/** A DOM id for a field path (paths may contain dots). */
export const fieldDomId = (idPrefix: string, path: string) =>
  `${idPrefix}-${path.replace(/[^A-Za-z0-9_-]/g, '-')}`

/**
 * One input field of the playground form: the control that fits its type
 * (text/textarea, number, switch, ISO date, select, JSON), its path, type,
 * `required`/`pii` markers, description and error.
 */
export function InputFieldControl({
  field,
  value,
  error,
  onChange,
  idPrefix,
  disabled = false
}: {
  field: InputField
  value: FieldValue
  error?: string
  onChange: (value: FieldValue) => void
  idPrefix: string
  disabled?: boolean
}) {
  const id = fieldDomId(idPrefix, field.path)
  const control = controlOf(field)
  const hasError = Boolean(error)
  const describedBy =
    [
      field.description ? `${id}-description` : null,
      control === 'datetime' || control === 'json' ? `${id}-hint` : null,
      hasError ? `${id}-error` : null
    ]
      .filter(Boolean)
      .join(' ') || undefined
  const text = typeof value === 'string' ? value : ''

  const label = (
    <FieldLabel
      htmlFor={id}
      className="flex w-full flex-wrap items-center gap-x-1.5 gap-y-1"
    >
      <code className="font-mono text-sm break-all">{field.path}</code>
      {field.required ? (
        <span className="text-destructive" aria-hidden>
          *
        </span>
      ) : null}
      {field.required ? <span className="sr-only">(obligatorio)</span> : null}
      <span className="text-xs font-normal text-muted-foreground">
        {TYPE_LABELS[field.type]}
      </span>
      {field.pii ? (
        <Badge variant="outline" className="h-4 px-1.5 text-[0.65rem]">
          PII
        </Badge>
      ) : null}
    </FieldLabel>
  )

  let input: ReactNode
  switch (control) {
    case 'textarea':
      input = (
        <Textarea
          id={id}
          value={text}
          onChange={event => onChange(event.target.value)}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          aria-required={field.required || undefined}
          maxLength={field.maxLength}
          disabled={disabled}
          rows={3}
          className="max-h-60 min-h-20"
        />
      )
      break
    case 'text':
      input = (
        <Input
          id={id}
          value={text}
          onChange={event => onChange(event.target.value)}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          aria-required={field.required || undefined}
          maxLength={field.maxLength}
          disabled={disabled}
        />
      )
      break
    case 'number':
    case 'integer':
      input = (
        <Input
          id={id}
          value={text}
          onChange={event => onChange(event.target.value)}
          inputMode={control === 'integer' ? 'numeric' : 'decimal'}
          placeholder={control === 'integer' ? '0' : '0.0'}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          aria-required={field.required || undefined}
          disabled={disabled}
          className="font-mono"
        />
      )
      break
    case 'datetime':
      input = (
        <div className="flex gap-2">
          <Input
            id={id}
            value={text}
            onChange={event => onChange(event.target.value)}
            placeholder="2026-01-01T09:30:00Z"
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            aria-required={field.required || undefined}
            disabled={disabled}
            className="font-mono"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            onClick={() => onChange(isoNow())}
            disabled={disabled}
          >
            <ClockIcon aria-hidden />
            Ahora
          </Button>
        </div>
      )
      break
    case 'enum': {
      const options = field.enum ?? []
      input = (
        <Select
          value={text === '' ? null : text}
          onValueChange={next => onChange(typeof next === 'string' ? next : '')}
          disabled={disabled}
          items={options.map(option => ({ value: option, label: option }))}
        >
          <SelectTrigger
            id={id}
            className="w-full"
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            aria-required={field.required || undefined}
          >
            <SelectValue
              placeholder="Elige un valor"
              className="font-mono data-placeholder:font-sans"
            />
          </SelectTrigger>
          <SelectContent>
            {options.map(option => (
              <SelectItem key={option} value={option} className="font-mono">
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
      break
    }
    case 'boolean':
      input = (
        <div className="flex min-h-9 items-center gap-3">
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={checked => onChange(checked)}
            aria-describedby={describedBy}
            disabled={disabled}
          />
          <span className="text-sm text-muted-foreground">
            {value === undefined
              ? 'Sin valor (no se envía)'
              : value
                ? 'Sí (true)'
                : 'No (false)'}
          </span>
          {!field.required && value !== undefined ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => onChange(undefined)}
              disabled={disabled}
            >
              <XIcon aria-hidden />
              Quitar
            </Button>
          ) : null}
        </div>
      )
      break
    case 'json':
      input = (
        <Textarea
          id={id}
          value={text}
          onChange={event => onChange(event.target.value)}
          placeholder={
            field.type === 'array' ? '["a", "b"]' : '{"clave": "valor"}'
          }
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          aria-required={field.required || undefined}
          spellCheck={false}
          disabled={disabled}
          rows={3}
          className="max-h-60 min-h-20 font-mono text-xs md:text-xs"
        />
      )
      break
  }

  return (
    <Field data-invalid={hasError || undefined} className="gap-1.5">
      {label}
      {field.description ? (
        <FieldDescription id={`${id}-description`} className="text-xs">
          {field.description}
        </FieldDescription>
      ) : null}
      {input}
      {control === 'datetime' ? (
        <FieldDescription id={`${id}-hint`} className="text-xs">
          {DATETIME_HINT}.
        </FieldDescription>
      ) : null}
      {control === 'json' ? (
        <FieldDescription id={`${id}-hint`} className="text-xs">
          {field.type === 'array'
            ? 'Cualquier array JSON.'
            : 'Cualquier objeto JSON.'}
        </FieldDescription>
      ) : null}
      {hasError ? (
        <FieldError id={`${id}-error`} className="text-xs">
          {error}
        </FieldError>
      ) : null}
    </Field>
  )
}
