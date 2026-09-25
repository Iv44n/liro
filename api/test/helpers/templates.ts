import {
  type TemplateDefinition,
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from '#modules/templates/definition'
import { inputJsonSchema } from '#modules/templates/input-schema'
import {
  decisionTemplates,
  decisionTemplateVersions,
  type StoreInputMode,
  type VersionStatus
} from '#modules/templates/templates.schemas'
import { Id } from '#shared/core/base'
import { hashJson } from '#shared/core/hash'
import { db } from '#shared/db/config'
import type { TestOrg } from './factories'

/**
 * Inserts a template and its versions straight into the database, bypassing
 * the templates API — so runtime tests (runs, reviews, idempotency) don't
 * depend on the publish flow they aren't testing.
 */

export interface InsertVersionOptions {
  major: number
  minor: number
  status?: Exclude<VersionStatus, 'draft'>
  /** Defaults to the template's `definition`. */
  definition?: TemplateDefinitionInput
}

export interface InsertTemplateOptions {
  definition: TemplateDefinitionInput
  slug?: string
  name?: string
  storeInput?: StoreInputMode
  status?: 'active' | 'archived'
  /** Published versions to create (default: `1.0`). */
  versions?: InsertVersionOptions[]
  /** Also create a draft with the template's `definition`. */
  draft?: boolean
}

export type TemplateRow = typeof decisionTemplates.$inferSelect
export type VersionRow = typeof decisionTemplateVersions.$inferSelect

export interface InsertedTemplate {
  template: TemplateRow
  /** In the order given. */
  versions: VersionRow[]
  draft: VersionRow | null
  definition: TemplateDefinition
}

const suffix = () => Math.random().toString(36).slice(2, 8)

export async function insertTemplate(
  org: TestOrg,
  options: InsertTemplateOptions
): Promise<InsertedTemplate> {
  const definition = templateDefinitionSchema.parse(options.definition)
  const slug = options.slug ?? `tpl-${suffix()}`

  const [template] = await db
    .insert(decisionTemplates)
    .values({
      id: Id.generate(),
      organizationId: org.id,
      slug,
      name: options.name ?? `Template ${slug}`,
      kind: definition.kind,
      status: options.status ?? 'active',
      storeInput: options.storeInput ?? 'full',
      createdBy: org.owner.id
    })
    .returning()
  if (!template) throw new Error('insertTemplate: no template row')

  const versions: VersionRow[] = []
  for (const version of options.versions ?? [{ major: 1, minor: 0 }]) {
    const versionDefinition = version.definition
      ? templateDefinitionSchema.parse(version.definition)
      : definition
    const [row] = await db
      .insert(decisionTemplateVersions)
      .values({
        id: Id.generate(),
        organizationId: org.id,
        templateId: template.id,
        major: version.major,
        minor: version.minor,
        status: version.status ?? 'published',
        definition: versionDefinition,
        inputJsonSchema: inputJsonSchema(versionDefinition.input.fields),
        definitionHash: hashJson(versionDefinition),
        modelRef: versionDefinition.model,
        createdBy: org.owner.id,
        publishedBy: org.owner.id,
        publishedAt: new Date()
      })
      .returning()
    if (!row) throw new Error('insertTemplate: no version row')
    versions.push(row)
  }

  let draft: VersionRow | null = null
  if (options.draft) {
    const [row] = await db
      .insert(decisionTemplateVersions)
      .values({
        id: Id.generate(),
        organizationId: org.id,
        templateId: template.id,
        status: 'draft',
        definition,
        definitionHash: hashJson(definition),
        modelRef: definition.model,
        createdBy: org.owner.id
      })
      .returning()
    draft = row ?? null
  }

  return { template, versions, draft, definition }
}
