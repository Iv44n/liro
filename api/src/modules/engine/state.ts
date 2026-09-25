import type { TemplateDefinition } from '#modules/templates/definition'
import { type JsonObject, pickPaths } from '#modules/templates/paths'

/**
 * The state Jev evaluates a run against: the input paths the template shares
 * (`state.include`, by default every declared field) plus its static
 * `state.context`, merged at the top level. A context key replaces an input
 * key of the same name (lint reports it as `STATE_CONTEXT_COLLISION`).
 *
 * Key order follows the definition's paths, not the input (a subtree shared
 * whole keeps its own order), so equal inputs yield the same state and the
 * same token estimate. The result is a fresh copy: neither `input` nor the
 * definition is mutated or aliased.
 */
export function buildState(
  definition: Pick<TemplateDefinition, 'input' | 'state'>,
  input: JsonObject
): JsonObject {
  const paths =
    definition.state.include ?? definition.input.fields.map(field => field.path)
  const shared = pickPaths(input, paths.filter(isSafePath))
  return { ...shared, ...structuredClone(definition.state.context ?? {}) }
}

/**
 * Defense in depth: `pathSchema` rejects `__proto__` segments, but a stored
 * definition that skipped validation must still never send one.
 */
const isSafePath = (path: string): boolean =>
  !path.split('.').includes('__proto__')
