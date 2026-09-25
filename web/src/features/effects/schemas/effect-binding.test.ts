import { describe, expect, it } from 'vitest'
import type { EffectBindingView } from '../types'
import {
  defaultEffectFormValues,
  effectFormSchema,
  effectFormValuesFromBinding,
  toCreateEffectBindingRequest,
  toUpdateEffectBindingRequest
} from './effect-binding'

function binding(overrides: Partial<EffectBindingView>): EffectBindingView {
  return {
    id: 'b1',
    templateId: 't1',
    on: '*',
    major: null,
    type: 'webhook',
    config: { endpointId: 'e1' },
    includeInput: false,
    enabled: true,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('effectFormSchema()', () => {
  it('requires an endpoint for a webhook binding', () => {
    const values = { ...defaultEffectFormValues('*'), type: 'webhook' as const }
    const result = effectFormSchema(true).safeParse(values)
    expect(result.success).toBe(false)
  })

  it('requires at least one recipient for an email binding', () => {
    const values = { ...defaultEffectFormValues('*'), type: 'email' as const }
    const result = effectFormSchema(true).safeParse(values)
    expect(result.success).toBe(false)
  })

  it('requires the Slack URL only when requireSlackUrl is true', () => {
    const values = { ...defaultEffectFormValues('*'), type: 'slack' as const }
    expect(effectFormSchema(true).safeParse(values).success).toBe(false)
    expect(effectFormSchema(false).safeParse(values).success).toBe(true)
  })

  it('rejects a Slack URL without the hooks.slack.com prefix', () => {
    const values = {
      ...defaultEffectFormValues('*'),
      type: 'slack' as const,
      slackUrl: 'https://evil.example.com/hook'
    }
    expect(effectFormSchema(true).safeParse(values).success).toBe(false)
  })

  it('requires a major when scope is "major"', () => {
    const values = {
      ...defaultEffectFormValues('*'),
      type: 'webhook' as const,
      endpointId: 'e1',
      scope: 'major' as const,
      major: null
    }
    expect(effectFormSchema(true).safeParse(values).success).toBe(false)
  })
})

describe('toCreateEffectBindingRequest()', () => {
  it('builds a webhook request scoped to a major', () => {
    const values = {
      ...defaultEffectFormValues('approved'),
      type: 'webhook' as const,
      endpointId: 'e1',
      scope: 'major' as const,
      major: 2
    }
    expect(toCreateEffectBindingRequest(values)).toEqual({
      on: 'approved',
      major: 2,
      type: 'webhook',
      config: { endpointId: 'e1' },
      includeInput: false,
      enabled: true
    })
  })

  it('omits an empty Slack channel', () => {
    const values = {
      ...defaultEffectFormValues('*'),
      type: 'slack' as const,
      slackUrl: 'https://hooks.slack.com/services/x'
    }
    expect(toCreateEffectBindingRequest(values).config).toEqual({
      webhookUrl: 'https://hooks.slack.com/services/x'
    })
  })
})

describe('effectFormValuesFromBinding() / toUpdateEffectBindingRequest()', () => {
  it('round-trips a webhook binding with no changes into an empty request', () => {
    const existing = binding({ type: 'webhook', config: { endpointId: 'e1' } })
    const values = effectFormValuesFromBinding(existing)
    expect(toUpdateEffectBindingRequest(values, existing, false)).toEqual({})
  })

  it('includes only the changed fields', () => {
    const existing = binding({
      on: '*',
      major: null,
      type: 'email',
      config: { to: ['a@x.com'] },
      includeInput: false,
      enabled: true
    })
    const values = effectFormValuesFromBinding(existing)
    values.enabled = false
    values.emails = ['a@x.com', 'b@x.com']
    expect(toUpdateEffectBindingRequest(values, existing, false)).toEqual({
      enabled: false,
      config: { to: ['a@x.com', 'b@x.com'] }
    })
  })

  it('treats a reordered, unchanged email set as no config change', () => {
    const existing = binding({
      type: 'email',
      config: { to: ['a@x.com', 'b@x.com'] }
    })
    const values = effectFormValuesFromBinding(existing)
    values.emails = ['b@x.com', 'a@x.com']
    expect(
      toUpdateEffectBindingRequest(values, existing, false).config
    ).toBeUndefined()
  })

  it('never sends a Slack config unless replacingSlackConfig is true and a URL was entered', () => {
    const existing = binding({
      type: 'slack',
      config: {
        webhookUrlHint: 'https://hooks.slack.com/…/AB12',
        channel: 'alerts'
      }
    })
    const values = effectFormValuesFromBinding(existing)
    values.slackChannel = 'general'
    // Not replacing: channel edits alone can't be sent (the API needs a full URL).
    expect(
      toUpdateEffectBindingRequest(values, existing, false).config
    ).toBeUndefined()

    values.slackUrl = 'https://hooks.slack.com/services/new'
    expect(toUpdateEffectBindingRequest(values, existing, true).config).toEqual(
      {
        webhookUrl: 'https://hooks.slack.com/services/new',
        channel: 'general'
      }
    )
  })
})
