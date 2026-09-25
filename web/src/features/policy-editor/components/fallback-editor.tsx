import type { TemplateDefinition } from '#/features/templates/types/definition'
import { NEEDS_REVIEW } from '#/features/templates/types/definition'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'

/** The decision when nothing else matched: any declared label, or `needs_review`. */
export function FallbackEditor({
  definition,
  onChange
}: {
  definition: TemplateDefinition
  onChange: (decision: string) => void
}) {
  const labels = [...definition.decisions.map(d => d.label), NEEDS_REVIEW]

  return (
    <Select
      value={definition.fallback.decision}
      onValueChange={value => {
        if (value !== null) onChange(value)
      }}
    >
      <SelectTrigger
        size="sm"
        className="w-56 font-mono"
        data-lint-target="fallback.decision"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {labels.map(label => (
          <SelectItem key={label} value={label}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
