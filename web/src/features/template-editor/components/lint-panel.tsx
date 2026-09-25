import {
  AlertTriangleIcon,
  CircleAlertIcon,
  CircleCheckIcon
} from 'lucide-react'
import type { LintIssue } from '#/features/templates/types/definition'
import type { EditorTab } from '#/features/templates/types/editor'
import { Badge } from '#/shared/components/ui/badge'
import { cn } from '#/shared/utils/shadcn.utils'
import { useEditorStore } from '../store/editor-context'
import { plural } from '../utils/format'
import { describeLintIssue, formatIssuePath, tabForPath } from '../utils/lint'

/**
 * The "Validación" panel: every lint error/warning of the last saved draft
 * — lint only runs server-side (on save, or in the playground), so a
 * `stale` note shows while there are unsaved edits. Clicking an issue
 * switches to the tab that edits its section and asks the store to focus
 * the closest matching field (`data-lint-target`, via `LintFocusHandler`).
 */
export function LintPanel({
  issues,
  activeTab,
  onNavigate
}: {
  issues: readonly LintIssue[]
  activeTab: EditorTab
  onNavigate: (tab: EditorTab) => void
}) {
  const isDirty = useEditorStore(state => {
    const { definition, base } = state
    return (
      definition !== null &&
      base !== null &&
      definition !== base.draft.definition
    )
  })
  const requestFocus = useEditorStore(state => state.requestFocus)

  const errors = issues.filter(issue => issue.severity === 'error')
  const warnings = issues.filter(issue => issue.severity === 'warning')

  const handleClick = (issue: LintIssue) => {
    const tab = tabForPath(issue.path)
    if (tab && tab !== activeTab) onNavigate(tab)
    requestFocus(issue.path)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Validación</h2>
        {issues.length === 0 ? (
          <Badge variant="secondary">
            <CircleCheckIcon aria-hidden="true" />
            Sin problemas
          </Badge>
        ) : (
          <div className="flex gap-1.5">
            {errors.length > 0 ? (
              <Badge variant="destructive">
                {plural(errors.length, 'error', 'errores')}
              </Badge>
            ) : null}
            {warnings.length > 0 ? (
              <Badge variant="outline">
                {plural(warnings.length, 'aviso', 'avisos')}
              </Badge>
            ) : null}
          </div>
        )}
      </div>

      {isDirty ? (
        <p className="text-xs text-muted-foreground">
          Hay cambios sin guardar: esta validación es la del último borrador
          guardado.
        </p>
      ) : null}

      {issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          El último borrador guardado no tiene errores ni avisos.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {[...errors, ...warnings].map(issue => {
            const described = describeLintIssue(issue)
            return (
              <li
                key={`${issue.severity}-${issue.code}-${issue.path}-${issue.message}`}
              >
                <button
                  type="button"
                  onClick={() => handleClick(issue)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-xl border p-2.5 text-start text-xs transition-colors hover:bg-muted',
                    issue.severity === 'error'
                      ? 'border-destructive/30'
                      : 'border-border'
                  )}
                >
                  {issue.severity === 'error' ? (
                    <CircleAlertIcon
                      className="mt-0.5 size-3.5 shrink-0 text-destructive"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertTriangleIcon
                      className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
                      aria-hidden="true"
                    />
                  )}
                  <span className="space-y-0.5">
                    <span className="block font-medium text-foreground">
                      {described.title}
                    </span>
                    <span className="block text-muted-foreground">
                      {described.detail}
                    </span>
                    {issue.path ? (
                      <span className="block font-mono text-[11px] text-muted-foreground/80">
                        {formatIssuePath(issue.path)}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
