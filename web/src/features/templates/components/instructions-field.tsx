import { PlusIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '#/shared/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel
} from '#/shared/components/ui/field'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '#/shared/components/ui/popover'
import { Textarea } from '#/shared/components/ui/textarea'
import { insertReference, unknownReferences } from '../utils/instructions'

interface InstructionsFieldProps {
  value: string
  error?: string
  /** Declared input field paths, for the "insertar campo" helper and the unknown-reference hint. */
  fieldPaths: string[]
  onChange: (value: string) => void
  label?: string
  placeholder?: string
}

/**
 * The wizards' free-text instructions: a textarea that references input
 * fields as `` `path` `` (backticked), a helper that inserts one at the
 * caret, and a non-blocking hint when a reference isn't a declared field.
 */
export function InstructionsField({
  value,
  error,
  fieldPaths,
  onChange,
  label = 'Instrucciones para el modelo',
  placeholder = 'Explica al modelo qué debe evaluar…'
}: InstructionsFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const [open, setOpen] = useState(false)
  const hasError = Boolean(error)
  const unknown = unknownReferences([value], fieldPaths)

  const insert = (path: string) => {
    const el = document.getElementById(id) as HTMLTextAreaElement | null
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const { text, caret } = insertReference(value, start, end, path)
    onChange(text)
    setOpen(false)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(caret, caret)
    })
  }

  return (
    <Field data-invalid={hasError || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={fieldPaths.length === 0}
              />
            }
          >
            <PlusIcon aria-hidden="true" />
            Insertar campo
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <PopoverHeader>
              <PopoverTitle className="text-sm">Campos declarados</PopoverTitle>
            </PopoverHeader>
            <ul className="max-h-48 space-y-0.5 overflow-auto">
              {fieldPaths.map(path => (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() => insert(path)}
                    className="w-full rounded-lg px-2 py-1.5 text-start font-mono text-xs hover:bg-muted"
                  >
                    {path}
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      <Textarea
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
      />

      <FieldDescription>
        Referencia campos de entrada entre backticks, p. ej.{' '}
        <code>`ticket.message`</code>.
      </FieldDescription>

      {unknown.length > 0 ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          {unknown.length === 1
            ? `«${unknown[0]}» no es un campo declarado.`
            : `Estas rutas no son campos declarados: ${unknown
                .map(path => `«${path}»`)
                .join(', ')}.`}
        </p>
      ) : null}

      {hasError ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  )
}
