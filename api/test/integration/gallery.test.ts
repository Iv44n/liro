import { beforeEach, describe, expect, test } from 'bun:test'
import { getFakeEvaluator } from '#modules/engine/evaluator'
import { GALLERY } from '#modules/templates/gallery'
import { buildInputValidator } from '#modules/templates/input-schema'
import { hashJson } from '#shared/core/hash'
import { json, testApi } from '../helpers/app'
import { addMember, createOrg, type TestOrg } from '../helpers/factories'

const api = testApi()

beforeEach(() => getFakeEvaluator().reset())

/** The gallery as JSON (it is deeply frozen, and `toEqual` compares plain data). */
const galleryJson = () => JSON.parse(JSON.stringify(GALLERY))

const fromGallery = (
  org: TestOrg,
  id: string,
  extra: Record<string, unknown> = {}
) =>
  api.post('/api/templates', {
    cookie: org.owner.cookie,
    body: { name: `From ${id}`, ...extra, source: { type: 'gallery', id } }
  })

describe('GET /api/gallery', () => {
  test('lists every gallery template with its definition and samples', async () => {
    const org = await createOrg()

    const response = await api.get('/api/gallery', {
      cookie: org.owner.cookie
    })

    expect(response.status).toBe(200)
    const { data } = await json(response)
    expect(data).toEqual(
      galleryJson().map((template: Record<string, unknown>) => ({
        id: template.id,
        slug: template.slug,
        name: template.name,
        description: template.description,
        kind: template.kind,
        definition: template.definition,
        sampleInputs: template.sampleInputs
      }))
    )
    expect(data.length).toBeGreaterThanOrEqual(2)
    for (const item of data) {
      expect(Object.keys(item).sort()).toEqual([
        'definition',
        'description',
        'id',
        'kind',
        'name',
        'sampleInputs',
        'slug'
      ])
      expect(item.sampleInputs.length).toBeGreaterThan(0)
    }
  })

  test('the samples are valid inputs of their definitions', async () => {
    const org = await createOrg()
    const { data } = await json(
      await api.get('/api/gallery', { cookie: org.owner.cookie })
    )

    for (const item of data) {
      const validator = buildInputValidator(item.definition.input.fields)
      for (const sample of item.sampleInputs) {
        expect(validator.safeParse(sample).success).toBe(true)
      }
    }
  })

  test('any member can read it', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')

    const response = await api.get('/api/gallery', { cookie: member.cookie })

    expect(response.status).toBe(200)
  })

  test('requires a session', async () => {
    const response = await api.get('/api/gallery')

    expect(response.status).toBe(401)
  })
})

describe('templates from the gallery', () => {
  test.each(GALLERY.map(template => [template.id]))(
    '%s: creates a lint-clean draft that publishes as 1.0',
    async id => {
      const org = await createOrg()
      const gallery = galleryJson().find(
        (template: { id: string }) => template.id === id
      )

      const created = await fromGallery(org, id)

      expect(created.status).toBe(201)
      const { template, draft } = await json(created)
      expect(template).toMatchObject({
        slug: gallery.slug,
        name: `From ${id}`,
        kind: gallery.kind,
        hasDraft: true,
        slugLocked: false
      })
      expect(draft.definition).toEqual(gallery.definition)
      expect(draft.definitionHash).toBe(hashJson(gallery.definition))
      expect(
        draft.lint.filter(
          (issue: { severity: string }) => issue.severity === 'error'
        )
      ).toEqual([])

      const published = await api.post(
        `/api/templates/${template.id}/publish`,
        {
          cookie: org.owner.cookie,
          body: { expectedDraftHash: draft.definitionHash }
        }
      )
      expect(published.status).toBe(201)
      expect((await json(published)).version.version).toBe('1.0')
    }
  )

  test('a second copy needs its own slug', async () => {
    const org = await createOrg()
    const [first] = GALLERY
    if (!first) throw new Error('The gallery is empty')

    expect((await fromGallery(org, first.id)).status).toBe(201)

    const duplicate = await fromGallery(org, first.id)
    expect(duplicate.status).toBe(409)
    expect((await json(duplicate)).error.code).toBe('SLUG_TAKEN')

    const renamed = await fromGallery(org, first.id, {
      slug: `${first.slug}-2`
    })
    expect(renamed.status).toBe(201)
    expect((await json(renamed)).template.slug).toBe(`${first.slug}-2`)

    // Another organization gets the suggested slug.
    expect((await fromGallery(await createOrg(), first.id)).status).toBe(201)
  })

  test("editing a copy doesn't change the gallery", async () => {
    const org = await createOrg()
    const [first] = GALLERY
    if (!first) throw new Error('The gallery is empty')
    const { template, draft } = await json(await fromGallery(org, first.id))

    const saved = await api.request(
      'PUT',
      `/api/templates/${template.id}/draft`,
      {
        cookie: org.owner.cookie,
        headers: { 'if-match': draft.definitionHash },
        body: {
          definition: {
            ...draft.definition,
            decisions: draft.definition.decisions.map(
              (decision: Record<string, unknown>) => ({
                ...decision,
                description: 'Edited'
              })
            )
          }
        }
      }
    )
    expect(saved.status).toBe(200)

    const { data } = await json(
      await api.get('/api/gallery', { cookie: org.owner.cookie })
    )
    expect(data.find((item: { id: string }) => item.id === first.id)).toEqual(
      galleryJson().find((item: { id: string }) => item.id === first.id)
    )
  })
})
