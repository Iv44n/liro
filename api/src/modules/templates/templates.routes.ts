import { Arcton } from '@arcton/core'
import { ApiError } from '#shared/http/errors'
import { requirePermission, withOrgSession } from '#shared/http/session'
import { GALLERY } from './gallery'
import {
  createTemplate,
  createTemplateSchema,
  getDraft,
  getTemplateView,
  getVersion,
  lintRequestSchema,
  lintTemplateDefinition,
  listTemplates,
  listTemplatesQuerySchema,
  listVersions,
  publishDraft,
  publishSchema,
  saveDraft,
  saveDraftSchema,
  setTemplateStatus,
  setVersionDeprecated,
  updateTemplate,
  updateTemplateSchema
} from './templates.service'
import { galleryItemView } from './templates.views'

const tags = ['Templates']

/**
 * Sets the draft's entity tag (`"<hash>"`). `ETag` isn't a CORS-safelisted
 * response header: without `Access-Control-Expose-Headers` the dashboard,
 * calling cross-origin, couldn't read it.
 */
function setEtag(headers: Headers, hash: string) {
  headers.set('ETag', `"${hash}"`)
  headers.set('Access-Control-Expose-Headers', 'ETag')
}

/**
 * The hash in an `If-Match` header, quoted (`"abc"`, `W/"abc"`) or bare;
 * 428 `PRECONDITION_REQUIRED` when absent, so a save can't blindly overwrite
 * someone else's edits.
 */
function ifMatchHash(request: Request): string {
  const value = request.headers.get('if-match')?.trim()
  if (!value) {
    throw new ApiError(
      428,
      'PRECONDITION_REQUIRED',
      "Send the draft's definitionHash in an If-Match header"
    )
  }
  return /^(?:W\/)?"(.*)"$/.exec(value)?.[1] ?? value
}

/** Template management for the dashboard (`/api/templates`). */
export const templatesModule = Arcton({ prefix: '/api/templates' }).provide(
  withOrgSession
)

templatesModule.get('/', {
  query: listTemplatesQuerySchema,
  detail: {
    summary: 'List templates',
    description:
      '`status`: `active` (default), `archived` or `all`. Most recently updated first.',
    tags
  },
  handler: async ({ query, organizationId }) => ({
    data: await listTemplates(organizationId, query.status)
  })
})

templatesModule.post('/', {
  body: createTemplateSchema,
  detail: {
    summary: 'Create a template',
    description:
      'From a blank definition, a gallery template, the Classify/Decide wizards or a raw definition. Creates its first draft.',
    tags
  },
  middleware: [requirePermission({ template: ['create'] })],
  handler: async ({ response, organizationId, user, body }) => {
    const created = await createTemplate(
      { organizationId, userId: user.id },
      body
    )
    response.status = 201
    return created
  }
})

templatesModule.post('/lint', {
  body: lintRequestSchema,
  detail: {
    summary: 'Lint a definition',
    description:
      "Validates `definition` without saving it, for the visual editor to check as the author types. With `templateId`, also returns `changes` against that template's latest published version.",
    tags
  },
  middleware: [requirePermission({ template: ['update'] })],
  handler: async ({ organizationId, body }) => {
    return lintTemplateDefinition(organizationId, body)
  }
})

templatesModule.get('/:id', {
  detail: { summary: 'Get a template', tags },
  handler: async ({ params, organizationId }) => ({
    template: await getTemplateView(organizationId, params.id)
  })
})

templatesModule.patch('/:id', {
  body: updateTemplateSchema,
  detail: {
    summary: 'Update a template',
    description: 'The slug can no longer change once a version is published.',
    tags
  },
  middleware: [requirePermission({ template: ['update'] })],
  handler: async ({ params, organizationId, body }) => ({
    template: await updateTemplate(organizationId, params.id, body)
  })
})

templatesModule.post('/:id/archive', {
  detail: { summary: 'Archive a template', tags },
  middleware: [requirePermission({ template: ['archive'] })],
  handler: async ({ params, organizationId }) => ({
    template: await setTemplateStatus(organizationId, params.id, 'archived')
  })
})

templatesModule.post('/:id/restore', {
  detail: { summary: 'Restore an archived template', tags },
  middleware: [requirePermission({ template: ['archive'] })],
  handler: async ({ params, organizationId }) => ({
    template: await setTemplateStatus(organizationId, params.id, 'active')
  })
})

// ── Draft ────────────────────────────────────────────────────────────────

templatesModule.get('/:id/draft', {
  detail: {
    summary: "Get a template's draft",
    description:
      'With its lint and its diff against the latest version. `ETag` is the `definitionHash` to send back as `If-Match`.',
    tags
  },
  handler: async ({ params, response, organizationId, user }) => {
    const draft = await getDraft(organizationId, params.id, user.id)
    setEtag(response.headers, draft.definitionHash)
    return draft
  }
})

templatesModule.put('/:id/draft', {
  body: saveDraftSchema,
  detail: {
    summary: "Save a template's draft",
    description:
      'Requires `If-Match: "<definitionHash>"` (428 without it, 409 `DRAFT_CONFLICT` when stale). Lint errors do not prevent saving.',
    tags
  },
  middleware: [requirePermission({ template: ['update'] })],
  handler: async ({
    request,
    params,
    response,
    organizationId,
    user,
    body
  }) => {
    const ifMatch = ifMatchHash(request)
    const { definition } = body
    const draft = await saveDraft({
      organizationId,
      userId: user.id,
      templateId: params.id,
      ifMatch,
      definition
    })
    setEtag(response.headers, draft.definitionHash)
    return draft
  }
})

templatesModule.post('/:id/publish', {
  body: publishSchema,
  detail: {
    summary: 'Publish the draft',
    description:
      'Freezes the draft into the next minor version (or the next major with `major: true`, required for breaking changes).',
    tags
  },
  middleware: [requirePermission({ template: ['publish'] })],
  handler: async ({ params, response, organizationId, user, body }) => {
    const published = await publishDraft(
      { organizationId, userId: user.id },
      params.id,
      body
    )
    response.status = 201
    return published
  }
})

// ── Versions ─────────────────────────────────────────────────────────────

templatesModule.get('/:id/versions', {
  detail: { summary: 'List published versions', tags },
  handler: async ({ params, organizationId }) => ({
    data: await listVersions(organizationId, params.id)
  })
})

templatesModule.get('/:id/versions/:versionId', {
  detail: { summary: 'Get a version with its definition', tags },
  handler: async ({ params, organizationId }) => ({
    version: await getVersion(organizationId, params.id, params.versionId)
  })
})

templatesModule.post('/:id/versions/:versionId/deprecate', {
  detail: {
    summary: 'Deprecate a version',
    description:
      'It keeps running for exact refs, with a `Deprecation` header; `slug` and `slug@<major>` skip it.',
    tags
  },
  middleware: [requirePermission({ template: ['publish'] })],
  handler: async ({ params, organizationId }) => ({
    version: await setVersionDeprecated(
      organizationId,
      params.id,
      params.versionId,
      true
    )
  })
})

templatesModule.post('/:id/versions/:versionId/undeprecate', {
  detail: { summary: 'Undo a deprecation', tags },
  middleware: [requirePermission({ template: ['publish'] })],
  handler: async ({ params, organizationId }) => ({
    version: await setVersionDeprecated(
      organizationId,
      params.id,
      params.versionId,
      false
    )
  })
})

/** Ready-made templates (`/api/gallery`). */
export const galleryModule = Arcton({ prefix: '/api/gallery' }).provide(
  withOrgSession
)

galleryModule.get('/', {
  detail: {
    summary: 'List gallery templates',
    description:
      'Ready-made templates to start from (`POST /api/templates` with `source: { type: "gallery", id }`).',
    tags: ['Gallery']
  },
  handler: () => ({ data: GALLERY.map(galleryItemView) })
})
