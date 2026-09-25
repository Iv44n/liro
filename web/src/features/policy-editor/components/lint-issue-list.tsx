import { describeLintIssue } from '#/features/template-editor/utils/lint'
import type { LintIssue } from '#/features/templates/types/definition'
import { cn } from '#/shared/utils/shadcn.utils'

/** Inline live-lint issues for one field/row, in Spanish (`describeLintIssue`). */
export function LintIssueList({ issues }: { issues: readonly LintIssue[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="space-y-1">
      {issues.map(issue => {
        const described = describeLintIssue(issue)
        return (
          <li
            key={`${issue.severity}-${issue.code}-${issue.path}-${issue.message}`}
            className={cn(
              'text-xs',
              issue.severity === 'error'
                ? 'text-destructive'
                : 'text-amber-600 dark:text-amber-500'
            )}
          >
            {described.detail}
          </li>
        )
      })}
    </ul>
  )
}
