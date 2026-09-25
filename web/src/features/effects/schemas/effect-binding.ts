import { z } from 'zod'
import {
  type CreateEffectBindingConfig,
  type CreateEffectBindingInput,
  EFFECT_TRIGGER_ANY,
  EFFECT_TYPES,
  type EffectBindingView,
  type EffectType,
  type UpdateEffectBindingInput
} from '../types'

/** Every Slack incoming webhook URL starts with this (the API rejects any other host). */
export const SLACK_WEBHOOK_URL_PREFIX = 'https://hooks.slack.com/'

/** The create/edit dialog's flat form shape (one field set per `type`, only the active one used). */
export interface EffectFormValues {
  on: string
  scope: 'all' | 'major'
  major: number | null
  type: EffectType
  endpointId: string
  emails: string[]
  slackUrl: string
  slackChannel: string
  includeInput: boolean
  enabled: boolean
}

export function defaultEffectFormValues(initialOn: string): EffectFormValues {
  return {
    on: initialOn,
    scope: 'all',
    major: null,
    type: 'webhook',
    endpointId: '',
    emails: [],
    slackUrl: '',
    slackChannel: '',
    includeInput: false,
    enabled: true
  }
}

/**
 * Seeds the form from an existing binding. The Slack URL is never returned
 * by the API (only a masked hint) so it starts blank — see
 * `SLACK_WEBHOOK_URL_PREFIX` and the dialog's "reemplazar" toggle.
 */
export function effectFormValuesFromBinding(
  binding: EffectBindingView
): EffectFormValues {
  const values = defaultEffectFormValues(binding.on)
  values.scope = binding.major === null ? 'all' : 'major'
  values.major = binding.major
  values.type = binding.type
  values.includeInput = binding.includeInput
  values.enabled = binding.enabled
  if (binding.type === 'webhook') {
    values.endpointId = (binding.config as { endpointId: string }).endpointId
  } else if (binding.type === 'email') {
    values.emails = (binding.config as { to: string[] }).to
  } else if (binding.type === 'slack') {
    values.slackChannel = (binding.config as { channel?: string }).channel ?? ''
  }
  return values
}

/**
 * `requireSlackUrl`: false while editing a Slack binding whose URL the user
 * isn't replacing (the dialog only asks for `type: 'slack'` fields at all
 * once they opt into replacing it).
 */
export function effectFormSchema(requireSlackUrl: boolean) {
  return z
    .object({
      on: z.string().min(1, 'Elige un disparador'),
      scope: z.enum(['all', 'major']),
      major: z.number().int().min(1).nullable(),
      type: z.enum(EFFECT_TYPES),
      endpointId: z.string(),
      emails: z.array(z.email('Correo no válido')),
      slackUrl: z.string(),
      slackChannel: z.string().max(100),
      includeInput: z.boolean(),
      enabled: z.boolean()
    })
    .superRefine((value, ctx) => {
      if (value.scope === 'major' && value.major === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['major'],
          message: 'Elige una versión mayor'
        })
      }
      if (value.type === 'webhook' && !value.endpointId) {
        ctx.addIssue({
          code: 'custom',
          path: ['endpointId'],
          message: 'Elige un endpoint o crea uno nuevo'
        })
      }
      if (value.type === 'email' && value.emails.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['emails'],
          message: 'Elige al menos un destinatario'
        })
      }
      if (value.type === 'slack') {
        if (requireSlackUrl && !value.slackUrl) {
          ctx.addIssue({
            code: 'custom',
            path: ['slackUrl'],
            message: 'Pega la URL del webhook entrante'
          })
        }
        if (
          value.slackUrl &&
          !value.slackUrl.startsWith(SLACK_WEBHOOK_URL_PREFIX)
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['slackUrl'],
            message: `Debe empezar con ${SLACK_WEBHOOK_URL_PREFIX}`
          })
        }
      }
    })
}

function configFromValues(values: EffectFormValues): CreateEffectBindingConfig {
  switch (values.type) {
    case 'webhook':
      return { endpointId: values.endpointId }
    case 'email':
      return { to: values.emails }
    case 'slack':
      return {
        webhookUrl: values.slackUrl,
        ...(values.slackChannel.trim()
          ? { channel: values.slackChannel.trim() }
          : {})
      }
  }
}

export function toCreateEffectBindingRequest(
  values: EffectFormValues
): CreateEffectBindingInput {
  return {
    on: values.on,
    major: values.scope === 'major' ? values.major : null,
    type: values.type,
    config: configFromValues(values),
    includeInput: values.includeInput,
    enabled: values.enabled
  }
}

const sameEmailSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

/**
 * Only the fields that actually changed (`config` included only when the
 * user touched it) — `on`/`config` can't change `type`, and the API
 * re-validates `config` from scratch, so a Slack binding whose URL wasn't
 * replaced (`replacingSlackConfig: false`) never sends one.
 */
export function toUpdateEffectBindingRequest(
  values: EffectFormValues,
  original: EffectBindingView,
  replacingSlackConfig: boolean
): UpdateEffectBindingInput {
  const request: UpdateEffectBindingInput = {}

  if (values.on !== original.on) request.on = values.on

  const nextMajor = values.scope === 'major' ? values.major : null
  if (nextMajor !== original.major) request.major = nextMajor

  if (values.includeInput !== original.includeInput) {
    request.includeInput = values.includeInput
  }
  if (values.enabled !== original.enabled) request.enabled = values.enabled

  if (values.type === 'webhook') {
    const current = (original.config as { endpointId?: string }).endpointId
    if (values.endpointId !== current) {
      request.config = { endpointId: values.endpointId }
    }
  } else if (values.type === 'email') {
    const current = (original.config as { to?: string[] }).to ?? []
    if (!sameEmailSet(values.emails, current)) {
      request.config = { to: values.emails }
    }
  } else if (
    values.type === 'slack' &&
    replacingSlackConfig &&
    values.slackUrl
  ) {
    request.config = {
      webhookUrl: values.slackUrl,
      ...(values.slackChannel.trim()
        ? { channel: values.slackChannel.trim() }
        : {})
    }
  }

  return request
}

/** A trigger picked from a group header pre-fills `on`; `'*'` otherwise. */
export const defaultTrigger = (initialOn?: string): string =>
  initialOn ?? EFFECT_TRIGGER_ANY
