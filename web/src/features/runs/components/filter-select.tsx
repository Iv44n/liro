import { Label } from '#/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'
import { cn } from '#/shared/utils/shadcn.utils'

/** The "any" option's value (a filter set to it is `null`). */
const ANY = '__any__'

export interface FilterOption {
  value: string
  label: string
}

/** A labelled select for one filter, with an "any" option first. */
export function FilterSelect({
  id,
  label,
  value,
  options,
  anyLabel,
  onChange,
  disabled,
  className
}: {
  id: string
  label: string
  value: string | null
  options: readonly FilterOption[]
  anyLabel: string
  onChange: (value: string | null) => void
  disabled?: boolean
  className?: string
}) {
  const items = [{ value: ANY, label: anyLabel }, ...options]

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      <Select
        items={items}
        value={value ?? ANY}
        disabled={disabled}
        onValueChange={next =>
          onChange(next === null || next === ANY ? null : String(next))
        }
      >
        <SelectTrigger id={id} size="sm" className="w-full min-w-0">
          <SelectValue className="truncate" />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
