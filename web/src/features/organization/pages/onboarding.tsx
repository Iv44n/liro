import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '#/shared/components/ui/card'
import { CreateOrganizationForm } from '../components/create-organization-form'

export default function OnboardingPage() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 text-foreground md:p-10">
      <div className="w-full max-w-md">
        <Card className="rounded-md shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">
              Crea tu primera organización
            </CardTitle>
            <CardDescription>
              Necesitas una organización para empezar a trabajar. Crea una a
              continuación y serás su propietario.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateOrganizationForm submitLabel="Crear y continuar" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
