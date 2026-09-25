import { useState } from 'react'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel
} from '#/shared/components/ui/field'
import { Textarea } from '#/shared/components/ui/textarea'
import { cn } from '#/shared/utils/shadcn.utils'
import { parseJsonText } from '../utils/json-text'

/**
 * A textarea holding raw JSON text, validated on every change (`onValid`
 * only fires for well-formed JSON — the field itself always keeps whatever
 * the author typed, invalid or not, so nothing is lost mid-edit).
 */
export function JsonField({
  label,
  description,
  value,
  onChange,
  onValidChange,
  placeholder,
  rows = 6,
  className
}: {
  label: string
  description?: string
  value: string
  onChange: (text: string) => void
  /** Called with the parsed value whenever `value` is valid JSON (or blank: `undefined`). */
  onValidChange?: (value: unknown) => void
  placeholder?: string
  rows?: number
  className?: string
}) {
  const [touched, setTouched] = useState(false)
  const result = parseJsonText(value)
  const showError = touched && !result.ok

  return (
    <Field data-invalid={showError} className={cn('gap-1.5', className)}>
      <FieldLabel>{label}</FieldLabel>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <Textarea
        value={value}
        onChange={event => {
          const next = event.target.value
          onChange(next)
          const parsed = parseJsonText(next)
          if (parsed.ok) onValidChange?.(parsed.value)
        }}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        rows={rows}
        className="font-mono text-xs"
        aria-invalid={showError}
      />
      {showError ? (
        <FieldError errors={[{ message: `JSON inválido: ${result.error}` }]} />
      ) : null}
    </Field>
  )
}
