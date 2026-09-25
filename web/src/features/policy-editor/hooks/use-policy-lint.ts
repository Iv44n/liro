import { useQuery } from '@tanstack/react-query'
import type {
  LintIssue,
  TemplateDefinition
} from '#/features/templates/types/definition'
import { api } from '#/sdk'
import { useDebouncedValue } from './use-debounced-value'

/**
 * Live lint of the editor's unsaved `definition` (`POST /api/templates/
 * lint`), debounced so the visual policy editor doesn't call the API on
 * every keystroke. Independent of the draft's own lint (`base.draft.lint`,
 * which only reflects the last save, shown by the "Validación" panel):
 * this is what the policy editor shows next to each rule/signal/flag as the
 * author edits it. Silent on failure (missing `template:update`, offline…)
 * — saving still runs the real lint, so nothing is lost by staying quiet here.
 */
export function usePolicyLint(
  templateId: string,
  definition: TemplateDefinition | null
): { issues: LintIssue[]; isFetching: boolean } {
  const debounced = useDebouncedValue(definition, 400)

  const query = useQuery({
    queryKey: ['templates', templateId, 'lint', 'live', debounced],
    queryFn: () =>
      api.templates.lint({ definition: debounced as TemplateDefinition }),
    enabled: debounced !== null,
    retry: false,
    staleTime: 0,
    gcTime: 60_000
  })

  return { issues: query.data?.lint ?? [], isFetching: query.isFetching }
}

/** Issues whose path is `prefix` or nested under it (`prefix.*`). */
export function issuesForPath(
  issues: readonly LintIssue[],
  prefix: string
): LintIssue[] {
  return issues.filter(
    issue => issue.path === prefix || issue.path.startsWith(`${prefix}.`)
  )
}

/** Issues whose path is exactly `path` (not a descendant) — a section/group's own errors (e.g. `TOO_MANY`, `CONDITION_TOO_DEEP`). */
export function issuesAt(
  issues: readonly LintIssue[],
  path: string
): LintIssue[] {
  return issues.filter(issue => issue.path === path)
}
