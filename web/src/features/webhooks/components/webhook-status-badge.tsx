import { AlertTriangleIcon, CheckCircle2Icon } from 'lucide-react'
import type { WebhookEndpointView } from '#/sdk/modules/webhooks/types'
import { Badge } from '#/shared/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '#/shared/components/ui/tooltip'
import { disabledReasonText } from '../utils/labels'

/** Enabled/disabled, with the reason as a tooltip when disabled automatically. */
export function WebhookStatusBadge({
  endpoint
}: {
  endpoint: Pick<WebhookEndpointView, 'enabled' | 'disabledReason'>
}) {
  if (endpoint.enabled) {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2Icon aria-hidden="true" />
        Activo
      </Badge>
    )
  }

  const badge = (
    <Badge variant="outline" className="text-muted-foreground">
      <AlertTriangleIcon aria-hidden="true" />
      Desactivado
    </Badge>
  )

  if (!endpoint.disabledReason) return badge

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        {badge}
      </TooltipTrigger>
      <TooltipContent>
        {disabledReasonText(endpoint.disabledReason)}
      </TooltipContent>
    </Tooltip>
  )
}
