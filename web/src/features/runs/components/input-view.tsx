import { BracesIcon, ListIcon } from 'lucide-react'
import { useState } from 'react'
import type { JsonObject } from '#/features/templates/types/definition'
import { Button } from '#/shared/components/ui/button'
import { cn } from '#/shared/utils/shadcn.utils'
import { flattenInput, inputValueText, isBlockValue } from '../utils/input'
import { JsonBlock } from './json-block'

/**
 * A run's input as a list of `path: value` rows (nested objects flattened
 * to dotted paths), with a toggle to see the raw JSON.
 */
export function InputView({
  input,
  label = 'Entrada'
}: {
  input: JsonObject
  label?: string
}) {
  const [asJson, setAsJson] = useState(false)
  const entries = flattenInput(input)

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-pressed={asJson}
          onClick={() => setAsJson(value => !value)}
        >
          {asJson ? (
            <ListIcon aria-hidden="true" />
          ) : (
            <BracesIcon aria-hidden="true" />
          )}
          {asJson ? 'Ver como lista' : 'Ver JSON'}
        </Button>
      </div>

      {asJson || entries.length === 0 ? (
        <JsonBlock value={input} label={`${label} en JSON`} />
      ) : (
        <dl className="divide-y rounded-xl border">
          {entries.map(entry => {
            const block = isBlockValue(entry.value)
            const text = inputValueText(entry.value)
            return (
              <div
                key={entry.path}
                className={cn(
                  'gap-1 px-3 py-2.5',
                  block
                    ? 'flex flex-col'
                    : 'grid sm:grid-cols-[minmax(0,12rem)_1fr] sm:gap-3'
                )}
              >
                <dt className="truncate font-mono text-xs text-muted-foreground">
                  {entry.path}
                </dt>
                <dd
                  className={cn(
                    'min-w-0 text-sm break-words',
                    typeof entry.value === 'string'
                      ? 'whitespace-pre-wrap'
                      : 'font-mono text-xs',
                    block &&
                      typeof entry.value !== 'string' &&
                      'max-h-64 overflow-auto rounded-lg bg-muted/40 p-2 whitespace-pre'
                  )}
                >
                  {text === '' ? (
                    <span className="text-muted-foreground italic">
                      (vacío)
                    </span>
                  ) : (
                    text
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </div>
  )
}
