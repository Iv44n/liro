import { useEffect, useState } from 'react'
import { useMe } from '#/features/auth/hooks/use-me'
import { EffectsTab } from '#/features/effects/components/effects-tab'
import { Playground } from '#/features/playground/components/playground'
import type { EditorTab } from '#/features/templates/types/editor'
import { EDITOR_TABS } from '#/features/templates/types/editor'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '#/shared/components/ui/alert-dialog'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '#/shared/components/ui/tabs'
import { DraftConflictDialog } from '../components/draft-conflict-dialog'
import { EditorHeader } from '../components/editor-header'
import { LintFocusHandler } from '../components/lint-focus-handler'
import { LintPanel } from '../components/lint-panel'
import { PublishDialog } from '../components/publish-dialog'
import { DecisionsTab } from '../components/tabs/decisions-tab'
import { InputTab } from '../components/tabs/input-tab'
import { IntegrateTabPanel } from '../components/tabs/integrate-tab'
import { PolicyTab } from '../components/tabs/policy-tab'
import { QuestionsTab } from '../components/tabs/questions-tab'
import { VersionsTab } from '../components/tabs/versions-tab'
import { useDraftSaving } from '../hooks/use-draft-saving'
import {
  useDraft,
  useTemplate,
  useVersions
} from '../hooks/use-template-queries'
import { useUnsavedChangesBlocker } from '../hooks/use-unsaved-changes-blocker'
import {
  EditorContextProvider,
  EditorStoreProvider,
  useEditorContext,
  useEditorStore,
  useEditorStoreApi
} from '../store/editor-context'
import { selectHasUnsavedWork } from '../store/editor-store'
import { errorText } from '../utils/errors'
import { EDITOR_TAB_LABELS } from '../utils/format'
import { issueCountsByTab } from '../utils/lint'

export interface TemplateEditorPageProps {
  templateId: string
  tab: EditorTab
  onTabChange: (tab: EditorTab) => void
}

function EditorSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only">Cargando la decisión…</span>
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  )
}

function LoadError({
  error,
  onRetry
}: {
  error: unknown
  onRetry: () => void
}) {
  return (
    <Alert variant="destructive">
      <AlertDescription className="space-y-3">
        <p>No se pudo cargar la decisión: {errorText(error)}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      </AlertDescription>
    </Alert>
  )
}

/** Keeps the store's `base` synced with background refetches of the draft (see `receive`). */
function DraftSync({ templateId }: { templateId: string }) {
  const store = useEditorStoreApi()
  const { data } = useDraft(templateId)
  useEffect(() => {
    if (data) store.getState().receive(data)
  }, [data, store])
  return null
}

function RemoteUpdateBanner({ onReload }: { onReload: () => void }) {
  const remoteEtag = useEditorStore(state => state.remoteEtag)
  if (!remoteEtag) return null
  return (
    <Alert>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>
          Hay una versión del borrador más reciente guardada por otra persona.
        </span>
        <Button variant="outline" size="sm" onClick={onReload}>
          Recargar (descarta lo que no guardaste)
        </Button>
      </AlertDescription>
    </Alert>
  )
}

const TAB_COMPONENTS: Record<EditorTab, () => React.JSX.Element | null> = {
  input: InputTab,
  questions: QuestionsTab,
  decisions: DecisionsTab,
  policy: PolicyTab,
  effects: EffectsTab,
  versions: VersionsTab,
  integrate: IntegrateTabPanel
}

function EditorShell({
  templateId,
  tab,
  onTabChange,
  canPublish
}: {
  templateId: string
  tab: EditorTab
  onTabChange: (tab: EditorTab) => void
  canPublish: boolean
}) {
  const saving = useDraftSaving(templateId)
  const { readOnly } = useEditorContext()
  const definition = useEditorStore(state => state.definition)
  const base = useEditorStore(state => state.base)
  const hasUnsavedWork = useEditorStore(selectHasUnsavedWork)
  const [publishOpen, setPublishOpen] = useState(false)
  const blocker = useUnsavedChangesBlocker(hasUnsavedWork)
  // The versions list feeds the header's/publish flow's next-version context
  // and warms the cache for the Versiones tab.
  useVersions(templateId)

  if (!definition || !base) return <EditorSkeleton />

  const lintCounts = issueCountsByTab(base.draft.lint)
  const ActiveTab = TAB_COMPONENTS[tab]

  const handleOpenPublish = async () => {
    const result = await saving.save()
    if (result === 'saved' || result === 'clean') setPublishOpen(true)
  }

  return (
    <div className="space-y-4">
      <DraftSync templateId={templateId} />
      <LintFocusHandler />

      <EditorHeader
        onSave={() => void saving.save()}
        isSaving={saving.isSaving}
        onOpenPublish={handleOpenPublish}
        canPublish={canPublish}
      />

      <RemoteUpdateBanner onReload={saving.reloadSaved} />

      <Tabs
        value={tab}
        onValueChange={value => {
          if (EDITOR_TABS.includes(value as EditorTab))
            onTabChange(value as EditorTab)
        }}
      >
        <TabsList className="flex-wrap">
          {EDITOR_TABS.map(value => {
            const counts = lintCounts[value]
            return (
              <TabsTrigger key={value} value={value}>
                {EDITOR_TAB_LABELS[value]}
                {counts && counts.errors > 0 ? (
                  <Badge
                    variant="destructive"
                    className="ms-1 h-4 min-w-4 px-1"
                  >
                    {counts.errors}
                  </Badge>
                ) : null}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <fieldset disabled={readOnly} className="contents">
          <div className="min-w-0 rounded-2xl border p-4">
            <ActiveTab />
          </div>
        </fieldset>

        <div className="space-y-6 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <div className="rounded-2xl border p-4">
            <Playground templateId={templateId} definition={definition} />
          </div>
          <div className="rounded-2xl border p-4">
            <LintPanel
              issues={base.draft.lint}
              activeTab={tab}
              onNavigate={onTabChange}
            />
          </div>
        </div>
      </div>

      <DraftConflictDialog saving={saving} />
      <PublishDialog
        templateId={templateId}
        open={publishOpen}
        onOpenChange={setPublishOpen}
      />

      <AlertDialog
        open={blocker.status === 'blocked'}
        onOpenChange={open => {
          if (!open) blocker.reset?.()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Salir sin guardar?</AlertDialogTitle>
            <AlertDialogDescription>
              Tienes cambios sin guardar en esta decisión. Si sales ahora, se
              pierden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              className="rounded-md"
              onClick={() => blocker.reset?.()}
            >
              Seguir editando
            </Button>
            <Button
              variant="destructive"
              className="rounded-md"
              onClick={() => blocker.proceed?.()}
            >
              Salir sin guardar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/**
 * `/decisions/$templateId` — the template editor (feature `template-editor`,
 * C2). Loads the template and its draft, then hands off to `EditorShell`
 * inside the editor's store/context providers (one fresh store per
 * template, see `EditorStoreProvider`).
 */
export default function TemplateEditorPage({
  templateId,
  tab,
  onTabChange
}: TemplateEditorPageProps) {
  const templateQuery = useTemplate(templateId)
  const draftQuery = useDraft(templateId)
  // `me` (and its permission map) gates `readOnly` below: wait for it too,
  // the same as the template/draft queries, so a fresh/direct navigation
  // never renders the editor forced read-only for a user who can actually
  // edit just because `/api/me` hasn't resolved yet.
  const meQuery = useMe()

  if (templateQuery.isPending || draftQuery.isPending || meQuery.isPending) {
    return <EditorSkeleton />
  }
  if (templateQuery.error) {
    return (
      <LoadError
        error={templateQuery.error}
        onRetry={() => void templateQuery.refetch()}
      />
    )
  }
  if (draftQuery.error) {
    return (
      <LoadError
        error={draftQuery.error}
        onRetry={() => void draftQuery.refetch()}
      />
    )
  }

  // `me` failing to load isn't fatal to viewing the editor (the
  // template/draft already loaded) — fail safe into read-only instead, same
  // as while it was still pending permission data.
  const permissions = meQuery.data?.permissions
  const readOnly =
    permissions === undefined ? true : !permissions.template.update
  const canPublish = permissions?.template.publish ?? false

  return (
    <EditorStoreProvider key={templateId} initialDraft={draftQuery.data}>
      <EditorContextProvider
        value={{ templateId, template: templateQuery.data, readOnly }}
      >
        <EditorShell
          templateId={templateId}
          tab={tab}
          onTabChange={onTabChange}
          canPublish={canPublish}
        />
      </EditorContextProvider>
    </EditorStoreProvider>
  )
}
