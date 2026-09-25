import { LayoutTemplateIcon, RefreshCwIcon } from 'lucide-react'
import type { GalleryItemView } from '#/sdk/modules/gallery/types'
import {
  Alert,
  AlertDescription,
  AlertTitle
} from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/shared/components/ui/empty'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { useGallery } from '../hooks/use-gallery'
import { TEMPLATE_KIND_LABELS } from '../utils/format'
import { describeError } from '../utils/server-errors'
import { TEMPLATE_KIND_ICONS } from './template-badges'

function GallerySkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
      <span className="sr-only">Cargando galería…</span>
      {['a', 'b', 'c', 'd'].map(key => (
        <div
          key={key}
          className="space-y-3 rounded-2xl p-5 ring-1 ring-foreground/10"
        >
          <Skeleton className="size-10 rounded-xl" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

/** First sample input, pretty-printed, or `null` when the item has none. */
function sampleInputPreview(item: GalleryItemView): string | null {
  const [sample] = item.sampleInputs
  return sample ? JSON.stringify(sample, null, 2) : null
}

/** Step 1 (gallery branch) of `/decisions/new`: `GET /api/gallery` as cards. */
export function GalleryGrid({
  onSelect
}: {
  onSelect: (item: GalleryItemView) => void
}) {
  const { data, error, isPending, isFetching, refetch } = useGallery()

  if (isPending) return <GallerySkeleton />

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>No se pudo cargar la galería</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{describeError(error)}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCwIcon
              className={isFetching ? 'animate-spin' : undefined}
              aria-hidden="true"
            />
            Reintentar
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const items = data ?? []

  if (items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutTemplateIcon />
          </EmptyMedia>
          <EmptyTitle>La galería está vacía</EmptyTitle>
          <EmptyDescription>
            Todavía no hay plantillas listas para usar. Prueba a empezar en
            blanco o con un asistente.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ul
      aria-label="Plantillas de la galería"
      className="grid gap-4 sm:grid-cols-2"
    >
      {items.map(item => {
        const Icon = TEMPLATE_KIND_ICONS[item.kind]
        const sample = sampleInputPreview(item)
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item)}
              className="flex h-full w-full flex-col items-start gap-3 rounded-2xl bg-card p-5 text-start ring-1 ring-foreground/10 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5"
                  aria-hidden="true"
                >
                  <Icon />
                </div>
                <Badge variant="outline">
                  {TEMPLATE_KIND_LABELS[item.kind]}
                </Badge>
              </div>
              <div className="space-y-1">
                <h2 className="font-medium">{item.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
              {sample ? (
                <div className="w-full space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Entrada de ejemplo
                  </p>
                  <pre className="max-h-24 w-full overflow-auto rounded-lg bg-muted/60 p-2 text-xs">
                    {sample}
                  </pre>
                </div>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
