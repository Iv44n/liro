import type { HttpClient } from '#/sdk/http/http-client'
import { routes } from './routes'
import type {
  CreateEffectBindingRequest,
  EffectBindingsPage,
  EffectBindingView,
  UpdateEffectBindingRequest
} from './types'

/** A template's effect bindings (`/api/templates/:id/effects`). */
export function effectsClient(http: HttpClient) {
  return {
    /** In position order, with `UNBOUND_LABEL`/`ORPHAN_BINDING` warnings against the latest version. */
    async list(templateId: string) {
      return await http.get<EffectBindingsPage>(routes.list(templateId))
    },
    async create(templateId: string, request: CreateEffectBindingRequest) {
      const { binding } = await http.post<
        { binding: EffectBindingView },
        CreateEffectBindingRequest
      >(routes.create(templateId), { body: request })
      return binding
    },
    async update(
      templateId: string,
      bindingId: string,
      request: UpdateEffectBindingRequest
    ) {
      const { binding } = await http.patch<
        { binding: EffectBindingView },
        UpdateEffectBindingRequest
      >(routes.update(templateId, bindingId), { body: request })
      return binding
    },
    async delete(templateId: string, bindingId: string) {
      await http.delete<void>(routes.delete(templateId, bindingId))
    }
  }
}
