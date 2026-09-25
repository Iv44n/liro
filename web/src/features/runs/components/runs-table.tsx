import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from 'lucide-react'
import type { RunSummaryView } from '#/sdk/modules/runs/types'
import { Badge } from '#/shared/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '#/shared/components/ui/table'
import { cn } from '#/shared/utils/shadcn.utils'
import {
  formatDuration,
  formatPreciseDateTime,
  formatRelativeTime
} from '../utils/format'
import { decisionOutcome } from '../utils/labels'
import { DecisionOutcomeBadges } from './decision-badge'
import { ConfidenceMeter } from './probability-bar'
import { ReviewStatusBadge, RunModeBadge, RunStatusBadge } from './run-badges'

/** `@1.2`, or "playground" for draft runs. */
function VersionTag({ run }: { run: Pick<RunSummaryView, 'version'> }) {
  return run.version ? (
    <span className="font-mono text-xs text-muted-foreground">
      @{run.version}
    </span>
  ) : (
    <span className="text-xs text-muted-foreground">borrador</span>
  )
}

/** What the run ended with; unfinished or failed runs show their status. */
function RunResult({ run }: { run: RunSummaryView }) {
  if (run.status !== 'succeeded') return <RunStatusBadge status={run.status} />
  return <DecisionOutcomeBadges outcome={decisionOutcome(run)} />
}

function RunFlags({ flags }: { flags: readonly string[] }) {
  if (flags.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  const [first, ...rest] = flags
  return (
    <span className="inline-flex items-center gap-1" title={flags.join(', ')}>
      <Badge variant="secondary" className="max-w-32 font-mono">
        <span className="truncate">{first}</span>
      </Badge>
      {rest.length > 0 ? (
        <span className="text-xs text-muted-foreground">+{rest.length}</span>
      ) : null}
    </span>
  )
}

function RunTime({ createdAt, now }: { createdAt: string; now: number }) {
  return (
    <time dateTime={createdAt} title={formatPreciseDateTime(createdAt)}>
      {formatRelativeTime(createdAt, now)}
    </time>
  )
}

/**
 * The runs explorer's rows: a table from `md` up and stacked cards on
 * phones. Each row is one link to the run (stretched over the row).
 */
export function RunsTable({
  runs,
  now,
  className
}: {
  runs: readonly RunSummaryView[]
  /** The time the page was rendered, for relative times. */
  now: number
  className?: string
}) {
  return (
    <div className={className}>
      <ul className="divide-y md:hidden">
        {runs.map(run => (
          <li key={run.id} className="relative">
            <Link
              to="/runs/$runId"
              params={{ runId: run.id }}
              className="flex items-start gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {run.templateName}
                  </span>
                  <VersionTag run={run} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <RunResult run={run} />
                  <RunModeBadge mode={run.mode} />
                  {run.reviewStatus ? (
                    <ReviewStatusBadge status={run.reviewStatus} />
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <RunTime createdAt={run.createdAt} now={now} />
                  <ConfidenceMeter value={run.confidence} />
                  <span>{formatDuration(run.latencyMs)}</span>
                  {run.flags.length > 0 ? (
                    <span>
                      {run.flags.length === 1
                        ? '1 flag'
                        : `${run.flags.length} flags`}
                    </span>
                  ) : null}
                </div>
              </div>
              <ChevronRightIcon
                aria-hidden="true"
                className="mt-1 size-4 shrink-0 text-muted-foreground"
              />
            </Link>
          </li>
        ))}
      </ul>

      <Table className="hidden md:table">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Fecha</TableHead>
            <TableHead>Decisión</TableHead>
            <TableHead>Resultado</TableHead>
            <TableHead>Confianza</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead>Revisión</TableHead>
            <TableHead className="text-end">Latencia</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map(run => (
            <TableRow
              key={run.id}
              className="relative focus-within:bg-muted/50"
            >
              <TableCell className="text-muted-foreground">
                <Link
                  to="/runs/$runId"
                  params={{ runId: run.id }}
                  aria-label={`Ver ejecución de ${run.templateName}, ${formatRelativeTime(run.createdAt, now)}`}
                  className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
                >
                  <RunTime createdAt={run.createdAt} now={now} />
                </Link>
              </TableCell>
              <TableCell className="max-w-64">
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate font-medium">
                    {run.templateName}
                  </span>
                  <VersionTag run={run} />
                  <RunModeBadge mode={run.mode} className="self-center" />
                </div>
              </TableCell>
              <TableCell className="max-w-72">
                <RunResult run={run} />
              </TableCell>
              <TableCell>
                <ConfidenceMeter value={run.confidence} />
              </TableCell>
              <TableCell>
                <RunFlags flags={run.flags} />
              </TableCell>
              <TableCell>
                {run.reviewStatus ? (
                  <ReviewStatusBadge status={run.reviewStatus} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell
                className={cn('text-end tabular-nums text-muted-foreground')}
              >
                {formatDuration(run.latencyMs)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
