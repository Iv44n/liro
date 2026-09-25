import {
  type ErrorComponentProps,
  Link,
  useRouter
} from '@tanstack/react-router'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { Button } from '#/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '#/shared/components/ui/card'

export default function GlobalError({ error }: ErrorComponentProps) {
  const router = useRouter()

  const isDevelopment = import.meta.env.DEV

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-lg shadow-xl">
        <CardHeader className="space-y-4 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">
              Application Error
            </p>

            <CardTitle className="text-3xl font-bold tracking-tight">
              Ocurrió un error inesperado
            </CardTitle>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <p className="text-center text-sm text-muted-foreground">
            Algo salió mal mientras cargábamos esta página.
          </p>

          {isDevelopment && (
            <div className="rounded-lg border bg-muted p-4">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                ERROR DETAILS
              </p>

              <pre className="overflow-auto text-xs text-destructive">
                {error instanceof Error ? error.message : String(error)}
              </pre>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              className="flex-1 rounded-md"
              onClick={() => router.invalidate()}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Reintentar
            </Button>

            <Button variant="outline" className="flex-1 rounded-md">
              <Link to="/">Volver al inicio</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
