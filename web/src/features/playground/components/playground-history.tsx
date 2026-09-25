import { HistoryIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { Button } from '#/shared/components/ui/button'
import { cn } from '#/shared/utils/shadcn.utils'
import type { PlaygroundHistoryEntry } from '../hooks/use-playground-history'
import { PLAYGROUND_HISTORY_LIMIT } from '../hooks/use-playground-history'
import { formatPercent } from '../utils/format'
import { DecisionBadge } from './decision-badge'

const timeFormat = new Intl.DateTimeFormat('es', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})

/** The session's last test runs: pick one to see it again or reuse its input. */
export function PlaygroundHistory({
  entries,
  selectedId,
  onSelect,
  onReuse,
  onClear
}: {
  entries: readonly PlaygroundHistoryEntry[]
  selectedId: string | null
  onSelect: (entry: PlaygroundHistoryEntry) => void
  onReuse: (entry: PlaygroundHistoryEntry) => void
  onClear: () => void
}) {
  if (entries.length === 0) return null

  return (
    <section aria-labelledby="playground-history-title" className="space-y-2">
      <div className="flex items-center gap-2">
        <HistoryIcon aria-hidden className="size-4 text-muted-foreground" />
        <h3 id="playground-history-title" className="text-sm font-medium">
          Últimas pruebas
        </h3>
        <span className="text-xs text-muted-foreground">
          (esta sesión, máx. {PLAYGROUND_HISTORY_LIMIT})
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ms-auto text-muted-foreground"
          onClick={onClear}
        >
          <Trash2Icon aria-hidden />
          Borrar
        </Button>
      </div>
      <ul className="divide-y rounded-xl border">
        {entries.map(entry => {
          const { run } = entry.response
          const selected = entry.id === selectedId
          return (
            <li
              key={entry.id}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 first:rounded-t-xl last:rounded-b-xl',
                selected && 'bg-muted/60'
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(entry)}
                aria-pressed={selected}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-start outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <time
                  dateTime={entry.at}
                  className="shrink-0 text-xs text-muted-foreground tabular-nums"
                >
                  {timeFormat.format(new Date(entry.at))}
                </time>
                <DecisionBadge decision={run.decision} className="min-w-0" />
                <span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatPercent(run.confidence)}
                </span>
                <span className="sr-only">
                  {selected ? '(mostrando)' : 'Ver resultado'}
                </span>
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onReuse(entry)}
                aria-label="Reusar esta entrada en el formulario"
                title="Reusar esta entrada"
              >
                <RotateCcwIcon aria-hidden />
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
