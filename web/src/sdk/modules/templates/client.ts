import type { TemplateDefinition } from '#/features/templates/types/definition'
import { formatEntityTag, parseEntityTag } from '#/sdk/http/etag'
import type { HttpClient, HttpResponse } from '#/sdk/http/http-client'
import { withQuery } from '#/sdk/http/query'
import { routes } from './routes'
import type {
  CreateTemplateRequest,
  CreateTemplateResponse,
  DraftView,
  DraftWithEtag,
  LintRequest,
  LintResponse,
  ListTemplatesParams,
  PlaygroundTestRequest,
  PlaygroundTestResponse,
  PublishRequest,
  PublishResponse,
  TemplateView,
  UpdateTemplateRequest,
  VersionDetailView,
  VersionView
} from './types'

/**
 * The draft with its entity tag. The `ETag` header is only readable when the
 * API exposes it to the dashboard's origin (CORS `Access-Control-Expose-
 * Headers`); it always equals `definitionHash`, which is the fallback.
 */
function draftWithEtag({
  data,
  headers
}: HttpResponse<DraftView>): DraftWithEtag {
  return {
    draft: data,
    etag: parseEntityTag(headers.get('ETag')) ?? data.definitionHash
  }
}

/** Template management (`/api/templates`). */
export function templatesClient(http: HttpClient) {
  return {
    /** Most recently updated first; `status` defaults to `active`. */
    async list(params: ListTemplatesParams = {}) {
      const { data } = await http.get<{ data: TemplateView[] }>(
        withQuery(routes.list, { status: params.status })
      )
      return data
    },
    /** Creates the template and its first draft (201). 409 `SLUG_TAKEN`, 422 `VALIDATION_FAILED`. */
    async create(request: CreateTemplateRequest) {
      return await http.post<CreateTemplateResponse, CreateTemplateRequest>(
        routes.create,
        { body: request }
      )
    },
    /**
     * Validates `definition` without saving it, so the editor can lint as
     * the author types instead of writing a draft on every keystroke. With
     * `templateId`, also returns the diff against that template's latest
     * published version. Requires `template:update`.
     */
    async lint(request: LintRequest) {
      return await http.post<LintResponse, LintRequest>(routes.lint, {
        body: request
      })
    },
    async get(id: string) {
      const { template } = await http.get<{ template: TemplateView }>(
        routes.get(id)
      )
      return template
    },
    /** 409 `SLUG_LOCKED` / `SLUG_TAKEN`. */
    async update(id: string, request: UpdateTemplateRequest) {
      const { template } = await http.patch<
        { template: TemplateView },
        UpdateTemplateRequest
      >(routes.update(id), { body: request })
      return template
    },
    async archive(id: string) {
      const { template } = await http.post<{ template: TemplateView }>(
        routes.archive(id)
      )
      return template
    },
    async restore(id: string) {
      const { template } = await http.post<{ template: TemplateView }>(
        routes.restore(id)
      )
      return template
    },

    // ── Draft ────────────────────────────────────────────────────────────

    /** The draft (created on demand) with its lint, diff and ETag. */
    async getDraft(id: string): Promise<DraftWithEtag> {
      return draftWithEtag(
        await http.requestWithHeaders<DraftView>('GET', routes.draft(id))
      )
    },
    /**
     * Saves the draft if it still has `ifMatch` (the `etag` it was loaded
     * with); 409 `DRAFT_CONFLICT` with `details.currentHash` otherwise.
     * Lint errors do not prevent saving.
     */
    async saveDraft(
      id: string,
      definition: TemplateDefinition,
      ifMatch: string
    ): Promise<DraftWithEtag> {
      return draftWithEtag(
        await http.requestWithHeaders<
          DraftView,
          { definition: TemplateDefinition }
        >('PUT', routes.draft(id), {
          body: { definition },
          headers: { 'If-Match': formatEntityTag(ifMatch) }
        })
      )
    },
    /**
     * Freezes the draft into the next version (201). Errors: 409
     * `DRAFT_CONFLICT` / `NO_CHANGES` / `NO_DRAFT`, 422 `LINT_FAILED` /
     * `BREAKING_CHANGES`, 410 `TEMPLATE_ARCHIVED`.
     */
    async publish(id: string, request: PublishRequest) {
      return await http.post<PublishResponse, PublishRequest>(
        routes.publish(id),
        { body: request }
      )
    },
    /**
     * Playground: runs `definition` (the unsaved editor state; default the
     * saved draft) against `input` in test mode. 422 `LINT_FAILED` /
     * `VALIDATION_FAILED` (`input.…` paths) / `INPUT_TOO_LARGE`, 429
     * `RATE_LIMITED`, 503 `JEV_UNAVAILABLE`, 504 `JEV_TIMEOUT`.
     */
    async testDraft(id: string, request: PlaygroundTestRequest) {
      return await http.post<PlaygroundTestResponse, PlaygroundTestRequest>(
        routes.testDraft(id),
        { body: request }
      )
    },

    // ── Versions ─────────────────────────────────────────────────────────

    /** Released versions, highest number first. */
    async versions(id: string) {
      const { data } = await http.get<{ data: VersionView[] }>(
        routes.versions(id)
      )
      return data
    },
    async version(id: string, versionId: string) {
      const { version } = await http.get<{ version: VersionDetailView }>(
        routes.version(id, versionId)
      )
      return version
    },
    /** `published` → `deprecated`; 409 `VERSION_NOT_PUBLISHED` otherwise. */
    async deprecate(id: string, versionId: string) {
      const { version } = await http.post<{ version: VersionView }>(
        routes.deprecate(id, versionId)
      )
      return version
    },
    /** `deprecated` → `published`; 409 `VERSION_NOT_DEPRECATED` otherwise. */
    async undeprecate(id: string, versionId: string) {
      const { version } = await http.post<{ version: VersionView }>(
        routes.undeprecate(id, versionId)
      )
      return version
    }
  }
}
