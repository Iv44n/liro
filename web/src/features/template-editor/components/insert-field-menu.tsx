import { BracketsIcon } from 'lucide-react'
import { type RefObject, useState } from 'react'
import { insertReference } from '#/features/templates/utils/instructions'
import { Button } from '#/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '#/shared/components/ui/dropdown-menu'

/**
 * "Insertar campo": inserts `` `path` `` at the caret of a text field, for
 * instructions and criteria that reference input fields. `paths` is
 * declared input paths (and the objects they imply); `target` is the
 * textarea/input being edited, read at click time so the caret position is
 * current.
 */
export function InsertFieldMenu({
  paths,
  target,
  value,
  onChange
}: {
  paths: readonly string[]
  target: RefObject<HTMLTextAreaElement | HTMLInputElement | null>
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  if (paths.length === 0) return null

  const insert = (path: string) => {
    const el = target.current
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
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" size="xs">
            <BracketsIcon aria-hidden="true" />
            Insertar campo
          </Button>
        }
      />
      <DropdownMenuContent className="max-h-72">
        <DropdownMenuLabel>Campos de entrada declarados</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {paths.map(path => (
          <DropdownMenuItem key={path} onClick={() => insert(path)}>
            <code className="text-xs">{path}</code>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
