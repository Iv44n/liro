import { Arcton } from '@arcton/core'
import z from 'zod'
import {
  compileVersion,
  refineStorableJson
} from '#modules/engine/compiled-cache'
import { getEvaluator } from '#modules/engine/evaluator'
import { executeRun } from '#modules/engine/executor'
import { templateDefinitionSchema } from '#modules/templates/definition'
import { hasLintErrors, lintDefinition } from '#modules/templates/lint'
import { getTemplate, loadDraft } from '#modules/templates/templates.service'
import { hashJson } from '#shared/core/hash'
import { readJson } from '#shared/http/body'
import { ApiError } from '#shared/http/errors'
import { requirePermission, withOrgSession } from '#shared/http/session'
import { runDetailView } from './runs.views'

const playgroundBodySchema = z.object({
  /** Checked against the definition's input contract by the executor. */
  input: z.record(z.string(), z.unknown()),
  /**
   * The editor's unsaved state; default: the saved draft. It is stored as the
   * run's snapshot, so NULs are refused (and deep nesting, before the
   * recursive definition schema) up front, not after the evaluator ran.
   */
  definition: z
    .unknown()
    .superRefine(refineStorableJson)
    .pipe(templateDefinitionSchema)
    .optional()
})

/** Test runs of a template's draft (`POST /api/templates/:id/draft/test`). */
export const playgroundModule = Arcton({ prefix: '/api/templates' }).provide(
  withOrgSession
)

playgroundModule.post('/:id/draft/test', {
  detail: {
    summary: 'Test the draft',
    tags: ['Templates'],
    description:
      'Runs the saved draft — or `definition`, the unsaved editor state — against `input`, in test mode at playground priority. Never creates a review task; lint errors block the run (422 LINT_FAILED).'
  },
  middleware: [requirePermission({ template: ['update'] })],
  handler: async ({ organizationId, params, request, user }) => {
    const template = await getTemplate(organizationId, params.id)
    const body = await readJson(request, playgroundBodySchema)
    const draft = await loadDraft(organizationId, template.id, {
      userId: user.id
    })

    const definition = body.definition ?? draft.definition
    const definitionHash = body.definition
      ? hashJson(body.definition)
      : draft.definitionHash
    const evaluator = getEvaluator()
    const lint = lintDefinition(definition, {
      maxContextTokens: evaluator.capabilities.maxContextTokens
    })
    if (hasLintErrors(lint)) {
      throw new ApiError(
        422,
        'LINT_FAILED',
        'Fix the lint errors of the definition before testing it',
        { details: { issues: lint } }
      )
    }

    const result = await executeRun({
      organizationId,
      template,
      version: {
        id: draft.id,
        major: null,
        minor: null,
        definitionHash,
        modelRef: definition.model
      },
      compiled: compileVersion({ id: draft.id, definitionHash, definition }),
      input: body.input,
      mode: 'test',
      source: 'playground',
      priority: 'playground',
      apiKeyId: null,
      userId: user.id,
      createReview: false,
      snapshotDefinition: true,
      evaluator
    })

    return {
      run: runDetailView(
        result.run,
        {
          templateSlug: template.slug,
          templateName: template.name,
          major: null,
          minor: null
        },
        result.review
      ),
      lint,
      trace: result.trace
    }
  }
})
