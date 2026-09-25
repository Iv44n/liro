import type {
  JsonObject,
  TemplateDefinition,
  TemplateKind
} from '#/features/templates/types/definition'

/** `GET /api/gallery` (mirrors `galleryItemView` in `templates.views.ts`). */
export interface GalleryItemView {
  /** Pass as `source: { type: 'gallery', id }` to `POST /api/templates`. */
  id: string
  slug: string
  name: string
  description: string
  kind: TemplateKind
  definition: TemplateDefinition
  sampleInputs: JsonObject[]
}
