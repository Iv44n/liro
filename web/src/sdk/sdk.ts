import { HttpClient } from './http/http-client'
import { apiKeysClient } from './modules/api-keys/client'
import { authClient } from './modules/auth/client'
import { effectsClient } from './modules/effects/client'
import { executionsClient } from './modules/executions/client'
import { galleryClient } from './modules/gallery/client'
import { meClient } from './modules/me/client'
import { organizationClient } from './modules/organization/client'
import { reviewsClient } from './modules/reviews/client'
import { runsClient } from './modules/runs/client'
import { templatesClient } from './modules/templates/client'
import { v1Client } from './modules/v1/client'
import { webhooksClient } from './modules/webhooks/client'

export function createSDK() {
  // Dashboard API (`/api`), authenticated by the session cookie.
  const http = HttpClient.create({
    baseURL: `${import.meta.env.VITE_API_URL}/api`,
    config: {
      credentials: 'include'
    }
  })

  // Public runtime (`/v1`), also called with the session cookie.
  const publicHttp = HttpClient.create({
    baseURL: import.meta.env.VITE_API_URL,
    config: {
      credentials: 'include'
    }
  })

  return {
    auth: authClient(http),
    organization: organizationClient(http),
    me: meClient(http),
    templates: templatesClient(http),
    gallery: galleryClient(http),
    runs: runsClient(http),
    reviews: reviewsClient(http),
    apiKeys: apiKeysClient(http),
    webhooks: webhooksClient(http),
    effects: effectsClient(http),
    executions: executionsClient(http),
    v1: v1Client(publicHttp)
  }
}

export const api = createSDK()
