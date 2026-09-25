import type { Operator } from '#/features/templates/types/definition'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'
import { OPERATOR_LABELS } from '../utils/labels'
import type { OperandTypeInfo } from '../utils/operand-model'
import { operatorsFor } from '../utils/operand-model'

/**
 * The operator picker, narrowed to what makes sense for the left operand's
 * type (mirrors the API lint's operator/type rules — see `operatorsFor`).
 * The current operator always stays in the list even if the type changed
 * under it, so switching the left operand never silently discards a choice.
 */
export function OperatorSelect({
  id,
  value,
  leftType,
  onChange
}: {
  id: string
  value: Operator
  leftType: OperandTypeInfo
  onChange: (op: Operator) => void
}) {
  const options = operatorsFor(leftType)
  const withCurrent = options.includes(value) ? options : [value, ...options]

  return (
    <Select value={value} onValueChange={next => onChange(next as Operator)}>
      <SelectTrigger id={id} size="sm" aria-label="Operador">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {withCurrent.map(op => (
          <SelectItem key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
