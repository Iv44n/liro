import { segment } from '#/sdk/http/query'
import type {
  CreatedWebhookEndpoint,
  CreateEffectBindingInput,
  CreateWebhookEndpointInput,
  EffectBindingsPage,
  EffectBindingView,
  UpdateEffectBindingInput,
  WebhookEndpointView
} from '../types'
import { effectsHttp } from './effects-http'

const routes = {
  bindings: (templateId: string) => `/templates/${segment(templateId)}/effects`,
  binding: (templateId: string, bindingId: string) =>
    `/templates/${segment(templateId)}/effects/${segment(bindingId)}`,
  webhookEndpoints: '/webhooks'
} as const

/**
 * Effect bindings of one template, plus the webhook endpoints they can
 * target. Despite the name, `EffectBindingsPage` isn't cursor-paginated —
 * it's always the full list for the template (mirrors the API's shape); if
 * that ever needs to change, both sides change together.
 */
export const effectsApi = {
  async listBindings(templateId: string): Promise<EffectBindingsPage> {
    return await effectsHttp.get<EffectBindingsPage>(
      routes.bindings(templateId)
    )
  },

  async createBinding(
    templateId: string,
    body: CreateEffectBindingInput
  ): Promise<EffectBindingView> {
    const { binding } = await effectsHttp.post<
      { binding: EffectBindingView },
      CreateEffectBindingInput
    >(routes.bindings(templateId), { body })
    return binding
  },

  async updateBinding(
    templateId: string,
    bindingId: string,
    body: UpdateEffectBindingInput
  ): Promise<EffectBindingView> {
    const { binding } = await effectsHttp.patch<
      { binding: EffectBindingView },
      UpdateEffectBindingInput
    >(routes.binding(templateId, bindingId), { body })
    return binding
  },

  async deleteBinding(templateId: string, bindingId: string): Promise<void> {
    await effectsHttp.delete<void>(routes.binding(templateId, bindingId))
  },

  /** Never the signing secret. */
  async listWebhookEndpoints(): Promise<WebhookEndpointView[]> {
    const { data } = await effectsHttp.get<{ data: WebhookEndpointView[] }>(
      routes.webhookEndpoints
    )
    return data
  },

  /** The signing secret is only ever in this response. */
  async createWebhookEndpoint(
    body: CreateWebhookEndpointInput
  ): Promise<CreatedWebhookEndpoint> {
    return await effectsHttp.post<
      CreatedWebhookEndpoint,
      CreateWebhookEndpointInput
    >(routes.webhookEndpoints, { body })
  }
}
