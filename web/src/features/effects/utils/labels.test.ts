import { describe, expect, it } from 'vitest'
import type { EffectBindingView, WebhookEndpointView } from '../types'
import {
  configSummary,
  effectTriggerOptions,
  groupBindingsByTrigger,
  majorScopeLabel,
  triggerLabel,
  urlHost,
  warningText
} from './labels'

function binding(overrides: Partial<EffectBindingView>): EffectBindingView {
  return {
    id: overrides.id ?? 'b1',
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

describe('triggerLabel()', () => {
  it('names the reserved triggers in Spanish and passes labels through', () => {
    expect(triggerLabel('*')).toBe('Cualquier resultado')
    expect(triggerLabel('needs_review')).toBe('Pide revisión')
    expect(triggerLabel('approved')).toBe('approved')
  })
})

describe('majorScopeLabel()', () => {
  it('describes null as every major and a number as one major', () => {
    expect(majorScopeLabel(null)).toBe('Todas las versiones mayores')
    expect(majorScopeLabel(2)).toBe('Solo la versión v2')
  })
})

describe('groupBindingsByTrigger()', () => {
  const labels = ['approved', 'rejected']

  it('always includes * , needs_review and every label, even with no bindings', () => {
    const groups = groupBindingsByTrigger([], labels)
    expect(groups.map(g => g.on)).toEqual([
      '*',
      'needs_review',
      'approved',
      'rejected'
    ])
    expect(groups.every(g => g.bindings.length === 0 && !g.orphan)).toBe(true)
  })

  it('buckets bindings under their trigger', () => {
    const bindings = [
      binding({ id: 'b1', on: '*' }),
      binding({ id: 'b2', on: 'approved' }),
      binding({ id: 'b3', on: 'approved' })
    ]
    const groups = groupBindingsByTrigger(bindings, labels)
    const approved = groups.find(g => g.on === 'approved')
    expect(approved?.bindings.map(b => b.id)).toEqual(['b2', 'b3'])
    expect(groups.find(g => g.on === '*')?.bindings.map(b => b.id)).toEqual([
      'b1'
    ])
  })

  it('appends a trailing group, marked orphan, for a binding on a removed label', () => {
    const bindings = [binding({ id: 'b1', on: 'archived' })]
    const groups = groupBindingsByTrigger(bindings, labels)
    const last = groups.at(-1)
    expect(last?.on).toBe('archived')
    expect(last?.orphan).toBe(true)
    expect(last?.bindings.map(b => b.id)).toEqual(['b1'])
  })
})

describe('configSummary()', () => {
  const endpoints = new Map<string, WebhookEndpointView>([
    [
      'e1',
      {
        id: 'e1',
        name: 'Mi endpoint',
        description: null,
        url: 'https://example.com',
        enabled: true,
        failureCount: 0,
        disabledReason: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ]
  ])

  it('resolves a webhook binding to its endpoint name', () => {
    expect(
      configSummary(
        binding({ type: 'webhook', config: { endpointId: 'e1' } }),
        endpoints
      )
    ).toBe('Mi endpoint')
  })

  it('falls back when the endpoint no longer exists', () => {
    expect(
      configSummary(
        binding({ type: 'webhook', config: { endpointId: 'gone' } }),
        endpoints
      )
    ).toBe('Endpoint eliminado')
  })

  it('does not report "eliminado" while endpoints are still loading', () => {
    expect(
      configSummary(
        binding({ type: 'webhook', config: { endpointId: 'gone' } }),
        new Map(),
        'pending'
      )
    ).toBe('Cargando endpoint…')
  })

  it('does not report "eliminado" when endpoints failed to load', () => {
    expect(
      configSummary(
        binding({ type: 'webhook', config: { endpointId: 'gone' } }),
        new Map(),
        'error'
      )
    ).toBe('No se pudo verificar el endpoint')
  })

  it('still resolves a known endpoint even while other bindings load ("ready" only gates the missing case)', () => {
    expect(
      configSummary(
        binding({ type: 'webhook', config: { endpointId: 'e1' } }),
        endpoints,
        'ready'
      )
    ).toBe('Mi endpoint')
  })

  it('joins up to two emails and summarizes the rest', () => {
    expect(
      configSummary(
        binding({ type: 'email', config: { to: ['a@x.com', 'b@x.com'] } }),
        endpoints
      )
    ).toBe('a@x.com, b@x.com')
    expect(
      configSummary(
        binding({
          type: 'email',
          config: { to: ['a@x.com', 'b@x.com', 'c@x.com'] }
        }),
        endpoints
      )
    ).toBe('a@x.com, b@x.com y 1 más')
  })

  it('shows the masked Slack hint, with the channel when set', () => {
    expect(
      configSummary(
        binding({
          type: 'slack',
          config: { webhookUrlHint: 'https://hooks.slack.com/…/AB12' }
        }),
        endpoints
      )
    ).toBe('https://hooks.slack.com/…/AB12')
    expect(
      configSummary(
        binding({
          type: 'slack',
          config: {
            webhookUrlHint: 'https://hooks.slack.com/…/AB12',
            channel: 'alertas'
          }
        }),
        endpoints
      )
    ).toBe('https://hooks.slack.com/…/AB12 · #alertas')
  })
})

describe('effectTriggerOptions()', () => {
  it('leads with * and needs_review, then the labels', () => {
    expect(effectTriggerOptions(['approved', 'rejected'])).toEqual([
      '*',
      'needs_review',
      'approved',
      'rejected'
    ])
  })
})

describe('urlHost()', () => {
  it('extracts the host of a valid URL', () => {
    expect(urlHost('https://example.com/webhooks/liro')).toBe('example.com')
  })

  it('returns the input unchanged when it does not parse as a URL', () => {
    expect(urlHost('not a url')).toBe('not a url')
  })
})

describe('warningText()', () => {
  it('describes each warning code in Spanish', () => {
    expect(warningText({ code: 'UNBOUND_LABEL', label: 'rejected' })).toContain(
      'rejected'
    )
    expect(
      warningText({
        code: 'ORPHAN_BINDING',
        label: 'archived',
        bindingId: 'b1'
      })
    ).toContain('archived')
    expect(
      warningText({ code: 'BINDING_OLD_MAJOR', bindingId: 'b1' })
    ).toContain('versión mayor anterior')
  })
})
