import { KeyRoundIcon } from 'lucide-react'
import { useState } from 'react'
import { usePermissions } from '#/features/auth/hooks/use-me'
import { PageHeader } from '#/features/runs/components/page-header'
import { ErrorState } from '#/features/runs/components/query-states'
import type { ApiKeyView } from '#/sdk/modules/api-keys/types'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import { Card } from '#/shared/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/shared/components/ui/empty'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { ApiKeysTable } from '../components/api-keys-table'
import { CreateApiKeyDialog } from '../components/create-api-key-dialog'
import { RevokeApiKeyDialog } from '../components/revoke-api-key-dialog'
import { useApiKeys } from '../hooks/use-api-keys'

function ApiKeysSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
        <Skeleton key={index} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  )
}

/** `/api-keys`: the organization's API keys, to create and revoke. */
export default function ApiKeysPage() {
  const apiKeys = useApiKeys()
  const permissions = usePermissions()
  const canCreate = permissions?.apiKey.create ?? false
  const canRevoke = permissions?.apiKey.delete ?? false
  const now = apiKeys.dataUpdatedAt || Date.now()

  const [revoking, setRevoking] = useState<ApiKeyView | null>(null)

  const rows = apiKeys.data ?? []

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        icon={<KeyRoundIcon />}
        title="API keys"
        description="Claves para llamar a las decisiones de Liro desde tu backend. Las de prueba (lr_test_…) no tienen efectos ni crean revisiones."
        action={canCreate ? <CreateApiKeyDialog /> : undefined}
      />

      {permissions && !canCreate ? (
        <Alert>
          <AlertDescription>
            Tu rol puede ver las API keys, pero no crearlas ni revocarlas.
          </AlertDescription>
        </Alert>
      ) : null}

      {apiKeys.isError ? (
        <ErrorState
          title="No se pudieron cargar las API keys"
          error={apiKeys.error}
          onRetry={() => apiKeys.refetch()}
          isRetrying={apiKeys.isFetching}
        />
      ) : (
        <Card className="gap-0 py-0">
          {apiKeys.isPending ? (
            <ApiKeysSkeleton />
          ) : rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon />
                </EmptyMedia>
                <EmptyTitle>Aún no hay API keys</EmptyTitle>
                <EmptyDescription>
                  {canCreate
                    ? 'Crea una para empezar a llamar a tus decisiones desde tu backend.'
                    : 'Pide a un administrador que cree una para tu organización.'}
                </EmptyDescription>
              </EmptyHeader>
              {canCreate ? (
                <EmptyContent>
                  <CreateApiKeyDialog />
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <ApiKeysTable
              apiKeys={rows}
              now={now}
              canRevoke={canRevoke}
              onRevoke={setRevoking}
            />
          )}
        </Card>
      )}

      <RevokeApiKeyDialog
        apiKey={revoking}
        open={revoking !== null}
        onOpenChange={open => {
          if (!open) setRevoking(null)
        }}
      />
    </div>
  )
}
