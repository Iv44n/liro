import type { JsonValue } from '#/features/templates/types/definition'
import { Input } from '#/shared/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'
import { Switch } from '#/shared/components/ui/switch'
import {
  formatLiteralDate,
  formatLiteralNumber,
  formatLiteralText,
  literalAsBoolean,
  parseLiteralDate,
  parseLiteralNumber,
  parseLiteralText,
  widgetFor
} from '../utils/literal'
import type { OperandTypeInfo } from '../utils/operand-model'

/**
 * A `value` operand's literal, widget chosen from `expectedType` (the other
 * side of the comparison): a select of options for a Choice/Score answer, a
 * switch for a boolean, a number field for a continuous/number answer, a
 * date picker for a date, otherwise free text (parsed leniently: `42` and
 * `true`/`false` become their JSON type, so a hand-typed literal still
 * compares numerically/booleanly).
 */
export function LiteralEditor({
  id,
  value,
  expectedType,
  onChange
}: {
  id: string
  value: JsonValue
  expectedType?: OperandTypeInfo
  onChange: (next: JsonValue) => void
}) {
  const widget = widgetFor(expectedType)

  if (widget === 'select') {
    const options = expectedType?.options ?? []
    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        onValueChange={next => onChange(next)}
      >
        <SelectTrigger id={id} size="sm" className="w-full font-mono">
          <SelectValue placeholder="Valor" />
        </SelectTrigger>
        <SelectContent>
          {options.map(option => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (widget === 'boolean') {
    const checked = literalAsBoolean(value)
    return (
      <label htmlFor={id} className="flex h-8 items-center gap-2 text-sm">
        <Switch
          id={id}
          checked={checked}
          onCheckedChange={next => onChange(Boolean(next))}
        />
        {checked ? 'Verdadero' : 'Falso'}
      </label>
    )
  }

  if (widget === 'number') {
    return (
      <Input
        id={id}
        type="number"
        value={formatLiteralNumber(value)}
        onChange={event => onChange(parseLiteralNumber(event.target.value))}
        className="font-mono"
      />
    )
  }

  if (widget === 'date') {
    return (
      <Input
        id={id}
        type="date"
        value={formatLiteralDate(value)}
        onChange={event => onChange(parseLiteralDate(event.target.value))}
      />
    )
  }

  return (
    <Input
      id={id}
      value={formatLiteralText(value)}
      onChange={event => onChange(parseLiteralText(event.target.value))}
      placeholder="Valor"
      className="font-mono"
    />
  )
}
