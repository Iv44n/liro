import { Link } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { Button } from '#/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from '#/shared/components/ui/card'

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-md text-center shadow-xl">
        <CardHeader className="space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>

          <div>
            <p className="text-sm font-medium text-muted-foreground">
              Error 404
            </p>
            <CardTitle className="text-3xl font-bold tracking-tight">
              Página no encontrada
            </CardTitle>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            La página que buscas no existe, fue movida o eliminada.
          </p>

          <Link to="/">
            <Button className="w-full rounded-md">Volver al inicio</Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
