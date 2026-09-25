import { describe, expect, test } from 'bun:test'
import type { JsonValue } from '#modules/engine/evaluator/port'
import {
  DEFINITION_LIMITS,
  type InputField,
  NEEDS_REVIEW,
  templateDefinitionSchema
} from './definition'
import { GALLERY, type GalleryTemplate, galleryTemplate } from './gallery'
import { buildInputValidator } from './input-schema'
import { hasLintErrors, lintDefinition } from './lint'
import { getPath, isPathPrefix, type JsonObject } from './paths'
import { SLUG_PATTERN } from './versioning'
import { classifyThreshold } from './wizards'

const PATH_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function leafPaths(value: JsonObject, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return isObject(child) ? leafPaths(child, path) : [path]
  })
}

function strings(value: JsonValue | undefined): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (isObject(value)) return Object.values(value).flatMap(strings)
  return []
}

/** Why `sample` wouldn't validate against `fields` (only the types the gallery uses). */
function sampleIssues(fields: InputField[], sample: JsonObject): string[] {
  const issues: string[] = []
  for (const field of fields) {
    const value = getPath(sample, field.path)
    if (value === undefined) {
      if (field.required) issues.push(`${field.path}: missing`)
      continue
    }
    const valid =
      field.type === 'string'
        ? typeof value === 'string' &&
          (field.maxLength === undefined || value.length <= field.maxLength)
        : field.type === 'enum'
          ? typeof value === 'string' && (field.enum ?? []).includes(value)
          : false
    if (!valid) issues.push(`${field.path}: not a valid ${field.type}`)
  }
  for (const path of leafPaths(sample)) {
    if (!fields.some(field => field.path === path)) {
      issues.push(`${path}: undeclared`)
    }
  }
  return issues
}

const template = (id: string): GalleryTemplate => {
  const found = GALLERY.find(candidate => candidate.id === id)
  if (!found) throw new Error(`No gallery template ${id}`)
  return found
}

const fieldSummary = (template: GalleryTemplate) =>
  template.definition.input.fields.map(({ path, type, required, enum: e }) => ({
    path,
    type,
    required,
    ...(e ? { enum: e } : {})
  }))

describe('GALLERY', () => {
  test('lists the Phase 1 templates with unique ids and slugs', () => {
    expect(GALLERY.map(t => t.id)).toEqual([
      'support-ticket-classifier',
      'content-moderation'
    ])
    expect(new Set(GALLERY.map(t => t.slug)).size).toBe(GALLERY.length)
  })

  describe.each(GALLERY.map(t => [t.id, t] as const))('%s', (_, template) => {
    const { definition } = template

    test('has a valid slug, a name and a description', () => {
      expect(template.slug).toMatch(SLUG_PATTERN)
      expect(template.slug.length).toBeLessThanOrEqual(64)
      expect(template.name.trim()).not.toBe('')
      expect(template.description.trim()).not.toBe('')
    })

    test('its kind matches the definition', () => {
      expect(template.kind).toBe(definition.kind)
    })

    test('its definition parses with the schema unchanged', () => {
      expect(templateDefinitionSchema.parse(definition)).toEqual(definition)
    })

    test('its definition is plain JSON within the size limit', () => {
      const json = JSON.stringify(definition)
      expect(JSON.parse(json)).toEqual(definition)
      expect(new TextEncoder().encode(json).length).toBeLessThan(
        DEFINITION_LIMITS.bytes
      )
    })

    test('follows the wizard pattern: always-match rule, shared minConfidence, review fallback', () => {
      const [rule, ...others] = definition.rules
      expect(others).toEqual([])
      expect(rule?.when).toEqual({ all: [] })
      expect(rule?.decision).toEqual({ fromAnswer: expect.any(String) })
      expect(classifyThreshold(definition)).not.toBeNull()
      expect(definition.fallback).toEqual({ decision: NEEDS_REVIEW })
    })

    test('its Choice options are exactly the declared labels, none reserved', () => {
      const rule = definition.rules[0]
      const questionId =
        rule && typeof rule.decision === 'object'
          ? rule.decision.fromAnswer
          : ''
      const question = definition.questions[questionId]
      expect(question?.type).toBe('choice')
      if (question?.type !== 'choice') return

      const labels = definition.decisions.map(decision => decision.label)
      expect(Object.keys(question.criteria)).toEqual(labels)
      expect(labels).not.toContain(NEEDS_REVIEW)
      expect(new Set(labels).size).toBe(labels.length)
    })

    test('every label has what/not_for criteria and a description', () => {
      for (const question of Object.values(definition.questions)) {
        if (question.type !== 'choice') continue
        for (const criteria of Object.values(question.criteria)) {
          expect(criteria).toEqual(
            expect.objectContaining({
              what: expect.any(String),
              not_for: expect.any(String)
            })
          )
        }
      }
      for (const decision of definition.decisions) {
        expect(decision.description?.trim()).toBeTruthy()
      }
    })

    test('every question has question/focus/inspect instructions', () => {
      for (const question of Object.values(definition.questions)) {
        expect(question.instructions).toEqual({
          question: expect.any(String),
          focus: expect.any(String),
          inspect: expect.any(Array)
        })
      }
    })

    test('backticked paths in instructions and criteria are declared fields', () => {
      const declared = definition.input.fields.map(field => field.path)
      const texts = Object.values(definition.questions).flatMap(question => [
        ...strings(question.instructions),
        ...('criteria' in question && question.criteria
          ? strings(question.criteria as JsonValue)
          : []),
        ...('levels' in question
          ? question.levels.flatMap(level => strings(level.criteria))
          : [])
      ])
      const tokens = texts.flatMap(text =>
        [...text.matchAll(/`([^`]+)`/g)].map(match => match[1] ?? '')
      )
      expect(tokens.length).toBeGreaterThan(0)
      for (const token of tokens.filter(token => PATH_TOKEN.test(token))) {
        expect(declared.some(path => isPathPrefix(token, path))).toBe(true)
      }
    })

    test('has 3 sample inputs valid against its fields', () => {
      expect(template.sampleInputs).toHaveLength(3)
      for (const sample of template.sampleInputs) {
        expect(sampleIssues(definition.input.fields, sample)).toEqual([])
      }
    })

    test('its sample inputs pass the run input validator unchanged', () => {
      const validator = buildInputValidator(definition.input.fields)
      for (const sample of template.sampleInputs) {
        expect(validator.parse(sample)).toEqual(sample)
      }
    })

    test('its sample inputs are distinct and use the optional fields both ways', () => {
      const samples = template.sampleInputs.map(sample =>
        JSON.stringify(sample)
      )
      expect(new Set(samples).size).toBe(samples.length)
      for (const field of definition.input.fields.filter(f => !f.required)) {
        const present = template.sampleInputs.map(
          sample => getPath(sample, field.path) !== undefined
        )
        expect(present).toContain(true)
        expect(present).toContain(false)
      }
    })

    test('has no lint issues, not even warnings', () => {
      const issues = lintDefinition(definition, { maxContextTokens: 32_000 })
      expect(issues.filter(issue => issue.severity === 'error')).toEqual([])
      expect(hasLintErrors(issues)).toBe(false)
      expect(issues).toEqual([])
    })
  })
})

describe('support-ticket-classifier', () => {
  const support = template('support-ticket-classifier')
  const { definition } = support

  test('declares the brief input: ticket subject/message and customer plan', () => {
    expect(fieldSummary(support)).toEqual([
      { path: 'ticket.subject', type: 'string', required: false },
      { path: 'ticket.message', type: 'string', required: true },
      {
        path: 'customer.plan',
        type: 'enum',
        required: false,
        enum: ['free', 'pro', 'enterprise']
      }
    ])
  })

  test('classifies into the five queues with minConfidence 0.8', () => {
    expect(definition.kind).toBe('classify')
    expect(definition.decisions.map(decision => decision.label)).toEqual([
      'bug',
      'billing',
      'feature_request',
      'account',
      'other'
    ])
    expect(classifyThreshold(definition)).toBe(0.8)
    expect(definition.rules).toEqual([
      {
        id: 'classify',
        when: { all: [] },
        decision: { fromAnswer: 'category' }
      }
    ])
  })

  test('asks the category and whether the ticket is urgent, in that order', () => {
    expect(Object.keys(definition.questions)).toEqual(['category', 'urgent'])
    expect(definition.questions.category?.type).toBe('choice')
    expect(definition.questions.urgent).toEqual({
      type: 'boolean',
      instructions: expect.objectContaining({
        question: expect.stringContaining('blocked')
      }),
      criteria: { true: expect.any(String), false: expect.any(String) }
    })
    expect(definition.questions.urgent?.when).toBeUndefined()
  })

  test('flags urgent tickets at P ≥ 0.7', () => {
    expect(definition.flagRules).toEqual([
      {
        id: 'urgent',
        name: expect.any(String),
        when: {
          op: 'gte',
          left: { answer: 'urgent', field: 'probability' },
          right: { value: 0.7 }
        },
        flags: ['urgent']
      }
    ])
  })

  test('sends messages shorter than 3 characters to other without asking Jev', () => {
    expect(definition.preconditions).toEqual([
      {
        id: 'empty_message',
        name: expect.any(String),
        when: {
          op: 'len_lt',
          left: { input: 'ticket.message' },
          right: { value: 3 }
        },
        decision: 'other'
      }
    ])
  })

  test('sends every field to Jev and has no signals', () => {
    expect(definition.state).toEqual({})
    expect(definition.signals).toEqual([])
    expect(definition.model).toEqual({ family: 'jev' })
  })

  test('its samples are a clear bug, a billing question and an ambiguous ticket', () => {
    const messages = support.sampleInputs.map(sample =>
      getPath(sample, 'ticket.message')
    )
    expect(messages).toHaveLength(3)
    for (const message of messages) {
      // None of them is short-circuited by the precondition.
      expect(typeof message === 'string' && message.length >= 3).toBe(true)
    }
    expect(messages[0]).toContain('Export to CSV')
    expect(messages[1]).toContain('charged twice')
    expect(messages[2]).toContain('invoices')
  })
})

describe('content-moderation', () => {
  const moderation = template('content-moderation')
  const { definition } = moderation

  test('declares the content text and its optional context', () => {
    expect(fieldSummary(moderation)).toEqual([
      { path: 'content.text', type: 'string', required: true },
      { path: 'content.context', type: 'string', required: false }
    ])
  })

  test('decides allow, restrict or remove and abstains below 0.60', () => {
    expect(definition.kind).toBe('classify')
    expect(definition.decisions.map(decision => decision.label)).toEqual([
      'allow',
      'restrict',
      'remove'
    ])
    expect(classifyThreshold(definition)).toBe(0.6)
    expect(Object.keys(definition.questions)).toEqual(['action'])
    expect(definition.rules[0]?.decision).toEqual({ fromAnswer: 'action' })
  })

  test('is a plain Classify: no preconditions, flags or signals', () => {
    expect(definition.preconditions).toEqual([])
    expect(definition.flagRules).toEqual([])
    expect(definition.signals).toEqual([])
  })
})

describe('galleryTemplate', () => {
  test.each(GALLERY.map(t => t.id))('finds %s', id => {
    expect(galleryTemplate(id)).toEqual(template(id))
  })

  test.each(['', 'unknown', 'Support-Ticket-Classifier'])('null for %p', id => {
    expect(galleryTemplate(id)).toBeNull()
  })

  test('the shared GALLERY is deeply frozen, so it cannot be edited in place', () => {
    const shared = template('support-ticket-classifier')
    expect(Object.isFrozen(GALLERY)).toBe(true)
    expect(Object.isFrozen(shared)).toBe(true)
    expect(Object.isFrozen(shared.definition.decisions[0])).toBe(true)
    expect(Object.isFrozen(shared.definition.questions.category)).toBe(true)
    expect(Object.isFrozen(shared.sampleInputs[0])).toBe(true)
    expect(() => {
      shared.definition.decisions.push({ label: 'changed' })
    }).toThrow(TypeError)
    expect(() => {
      shared.name = 'changed'
    }).toThrow(TypeError)
    expect(shared.definition.decisions).toHaveLength(5)
  })

  test('returns a copy the caller can edit freely', () => {
    const copy = galleryTemplate('content-moderation')
    if (!copy) throw new Error('Expected the template')
    const before = structuredClone(template('content-moderation'))

    copy.definition.decisions[0] = { label: 'changed' }
    copy.definition.input.fields.pop()
    copy.sampleInputs.length = 0

    expect(template('content-moderation')).toEqual(before)
    expect(galleryTemplate('content-moderation')).toEqual(before)
    expect(galleryTemplate('content-moderation')).not.toBe(
      galleryTemplate('content-moderation')
    )
  })
})
