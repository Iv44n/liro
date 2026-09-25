import { IntegrateTab } from '#/features/integrate/components/integrate-tab'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { useVersion } from '../../hooks/use-template-queries'
import { useEditorContext } from '../../store/editor-context'
import { errorText } from '../../utils/errors'

/** Wraps feature `integrate`'s `<IntegrateTab>` with this template's latest version. */
export function IntegrateTabPanel() {
  const { templateId, template } = useEditorContext()
  const latestVersionId = template.latestVersion?.id ?? null
  const {
    data: latestVersion,
    isPending,
    error
  } = useVersion(templateId, latestVersionId)

  if (latestVersionId && isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (latestVersionId && error) {
    return <p className="text-sm text-destructive">{errorText(error)}</p>
  }

  return (
    <IntegrateTab template={template} latestVersion={latestVersion ?? null} />
  )
}
