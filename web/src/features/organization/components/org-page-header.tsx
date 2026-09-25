import type { ReactNode } from 'react'

/**
 * Encabezado consistente para las páginas de gestión de la organización
 * (Configuración, Miembros, Invitaciones). Mantiene el mismo patrón visual:
 * chip con icono, título, descripción y una acción opcional a la derecha.
 */
export function OrgPageHeader({
  title,
  description,
  icon,
  action
}: {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
      <div className="flex items-start gap-3">
        {icon ? (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">
            {icon}
          </div>
        ) : null}
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}
