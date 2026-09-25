import { getRouteApi, Link } from '@tanstack/react-router'
import { BadgeCheckIcon, XCircleIcon } from 'lucide-react'
import { Button } from '#/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '#/shared/components/ui/card'

const routeApi = getRouteApi('/auth/email-verified')

export default function EmailVerifiedPage() {
  const { error } = routeApi.useSearch()
  const hasError = Boolean(error)

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 text-foreground md:p-10">
      <div className="w-full max-w-sm">
        <Card className="rounded-md shadow-md">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div
                className={
                  hasError
                    ? 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive [&_svg]:size-5'
                    : 'flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 [&_svg]:size-5'
                }
              >
                {hasError ? <XCircleIcon /> : <BadgeCheckIcon />}
              </div>
              <div className="space-y-1">
                <CardTitle className="text-xl">
                  {hasError
                    ? 'No pudimos verificar tu correo'
                    : '¡Correo verificado!'}
                </CardTitle>
                <CardDescription>
                  {hasError
                    ? 'El enlace no es válido o ha caducado. Inicia sesión para reenviar la verificación.'
                    : 'Tu cuenta ya está activa. Inicia sesión para continuar.'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full rounded-md"
              nativeButton={false}
              render={<Link to="/auth/login" />}
            >
              Ir a iniciar sesión
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
