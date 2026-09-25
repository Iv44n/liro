import { createFileRoute } from '@tanstack/react-router'
import TemplateEditorPage from '#/features/template-editor/pages/template-editor'
import {
  DEFAULT_EDITOR_TAB,
  type EditorTab,
  isEditorTab
} from '#/features/templates/types/editor'

interface TemplateEditorSearch {
  /** Omitted = the default tab (`questions`). */
  tab?: EditorTab
}

export const Route = createFileRoute('/_protected/decisions/$templateId')({
  validateSearch: (search: Record<string, unknown>): TemplateEditorSearch =>
    isEditorTab(search.tab) ? { tab: search.tab } : {},
  head: () => ({ meta: [{ title: 'Editor de decisión · Liro' }] }),
  component: RouteComponent
})

function RouteComponent() {
  const { templateId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <TemplateEditorPage
      templateId={templateId}
      tab={tab ?? DEFAULT_EDITOR_TAB}
      onTabChange={next =>
        navigate({
          search: prev => ({ ...prev, tab: next }),
          replace: true
        })
      }
    />
  )
}
