import type { GalleryItemView } from '#/sdk/modules/gallery/types'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { TEMPLATE_KIND_LABELS } from '../utils/format'
import { TEMPLATE_KIND_ICONS } from './template-badges'

/** The gallery item chosen in step 1, with a way back to pick another one. */
export function GalleryPreview({
  item,
  onChangeItem
}: {
  item: GalleryItemView
  onChangeItem: () => void
}) {
  const Icon = TEMPLATE_KIND_ICONS[item.kind]
  const [sample] = item.sampleInputs

  return (
    <div className="space-y-3 rounded-2xl bg-muted/30 p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5"
            aria-hidden="true"
          >
            <Icon />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{item.name}</p>
              <Badge variant="outline">{TEMPLATE_KIND_LABELS[item.kind]}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{item.description}</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onChangeItem}>
          Cambiar plantilla
        </Button>
      </div>
      {sample ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Entrada de ejemplo
          </p>
          <pre className="max-h-40 overflow-auto rounded-lg bg-background p-2 text-xs ring-1 ring-foreground/10">
            {JSON.stringify(sample, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
