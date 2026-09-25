import { PlusIcon, Trash2Icon } from 'lucide-react'
import type {
  Comparison,
  Operand,
  TemplateDefinition
} from '#/features/templates/types/definition'
import { Button } from '#/shared/components/ui/button'
import { defaultOperand, rightOperands, withRight } from '../utils/condition'
import type { OperandContext } from '../utils/operand-model'
import { isUnary, isVariadic, operandType } from '../utils/operand-model'
import { OperandEditor } from './operand-editor'
import { OperatorSelect } from './operator-select'

/** One `left op right` comparison: the leaf of a condition tree. */
export function ComparisonEditor({
  definition,
  comparison,
  onChange,
  context,
  idPrefix
}: {
  definition: TemplateDefinition
  comparison: Comparison
  onChange: (next: Comparison) => void
  context: OperandContext
  idPrefix: string
}) {
  const leftType = operandType(definition, comparison.left)
  const right = rightOperands(comparison)

  const setRight = (operands: Operand[]) =>
    onChange(withRight(comparison, operands))

  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <OperandEditor
        definition={definition}
        value={comparison.left}
        onChange={left => onChange({ ...comparison, left })}
        context={context}
        idPrefix={`${idPrefix}-left`}
        aria-label="Operando izquierdo"
      />

      <div className="w-40 shrink-0">
        <OperatorSelect
          id={`${idPrefix}-op`}
          value={comparison.op}
          leftType={leftType}
          onChange={op => {
            // `between` always needs exactly [min, max]; pad it right away so
            // switching to it never leaves a structurally invalid single-item
            // `right` in the definition until the author happens to touch a field.
            const nextRight =
              op === 'between'
                ? [right[0] ?? defaultOperand(), right[1] ?? defaultOperand()]
                : right
            onChange(withRight({ ...comparison, op }, nextRight))
          }}
        />
      </div>

      {isUnary(comparison.op) ? null : isVariadic(comparison.op) ? (
        <VariadicRight
          definition={definition}
          context={context}
          operands={right}
          expectedType={leftType}
          fixedCount={comparison.op === 'between' ? 2 : undefined}
          onChange={setRight}
          idPrefix={idPrefix}
        />
      ) : (
        <OperandEditor
          definition={definition}
          value={right[0] ?? defaultOperand()}
          onChange={operand => setRight([operand])}
          context={context}
          expectedType={leftType}
          idPrefix={`${idPrefix}-right`}
          aria-label="Operando derecho"
        />
      )}
    </div>
  )
}

/** The right side of `in` (any length) and `between` (fixed at 2: mínimo, máximo). */
function VariadicRight({
  definition,
  context,
  operands,
  expectedType,
  fixedCount,
  onChange,
  idPrefix
}: {
  definition: TemplateDefinition
  context: OperandContext
  operands: Operand[]
  expectedType: ReturnType<typeof operandType>
  fixedCount?: number
  onChange: (operands: Operand[]) => void
  idPrefix: string
}) {
  const items =
    fixedCount !== undefined
      ? Array.from(
          { length: fixedCount },
          (_, i) => operands[i] ?? defaultOperand()
        )
      : operands

  return (
    <div className="flex min-w-56 flex-1 flex-col gap-1.5">
      {items.map((operand, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are fully controlled by props; add/remove reindexes safely.
          key={index}
          className="flex items-start gap-1"
        >
          {fixedCount !== undefined ? (
            <span className="mt-1.5 shrink-0 text-xs text-muted-foreground">
              {index === 0 ? 'mín.' : 'máx.'}
            </span>
          ) : null}
          <OperandEditor
            definition={definition}
            value={operand}
            onChange={next =>
              onChange(items.map((o, i) => (i === index ? next : o)))
            }
            context={context}
            expectedType={expectedType}
            idPrefix={`${idPrefix}-right-${index}`}
            aria-label={`Operando derecho ${index + 1}`}
          />
          {fixedCount === undefined ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              disabled={items.length <= 1}
              aria-label={`Quitar el valor ${index + 1}`}
            >
              <Trash2Icon aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      ))}
      {fixedCount === undefined ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => onChange([...items, defaultOperand()])}
        >
          <PlusIcon aria-hidden="true" />
          Añadir valor
        </Button>
      ) : null}
    </div>
  )
}
