import { Link } from '@tanstack/react-router'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CodeIcon,
  CopyIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { TemplateView } from '#/sdk/modules/templates/types'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '#/shared/components/ui/alert-dialog'
import { Button } from '#/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '#/shared/components/ui/dropdown-menu'
import { useTemplateStatus } from '../hooks/use-template-status'

async function copySlug(slug: string) {
  try {
    await navigator.clipboard.writeText(slug)
    toast.success('Slug copiado', { description: slug })
  } catch {
    toast.error('No se pudo copiar el slug', {
      description: 'Tu navegador no permitió acceder al portapapeles.'
    })
  }
}

/**
 * The "⋯" menu of a template row: open the editor, integrate, copy the
 * slug and (with `template:archive`) archive or restore it. Archiving asks
 * for confirmation, since runs are refused while archived.
 */
export function TemplateActions({
  template,
  canArchive
}: {
  template: TemplateView
  canArchive: boolean
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const { setTemplateStatus, pendingTemplateId } = useTemplateStatus()
  const isChanging = pendingTemplateId === template.id
  const isArchived = template.status === 'archived'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Acciones de «${template.name}»`}
              disabled={isChanging}
            />
          }
        >
          {isChanging ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <MoreHorizontalIcon aria-hidden="true" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuItem
              render={
                <Link
                  to="/decisions/$templateId"
                  params={{ templateId: template.id }}
                />
              }
            >
              <PencilIcon aria-hidden="true" />
              Abrir editor
            </DropdownMenuItem>
            {template.latestVersion ? (
              <DropdownMenuItem
                render={
                  <Link
                    to="/decisions/$templateId"
                    params={{ templateId: template.id }}
                    search={{ tab: 'integrate' }}
                  />
                }
              >
                <CodeIcon aria-hidden="true" />
                Integrar
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={() => void copySlug(template.slug)}>
              <CopyIcon aria-hidden="true" />
              Copiar slug
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {canArchive ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {isArchived ? (
                  <DropdownMenuItem
                    onClick={() =>
                      setTemplateStatus({ template, action: 'restore' })
                    }
                  >
                    <ArchiveRestoreIcon aria-hidden="true" />
                    Restaurar
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setConfirmOpen(true)}
                  >
                    <ArchiveIcon aria-hidden="true" />
                    Archivar…
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar «{template.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {template.latestVersion ? (
                <>
                  Las llamadas a <code>/v1/decisions/{template.slug}</code>{' '}
                  fallarán (410) mientras esté archivada. Sus versiones,
                  ejecuciones y revisiones se conservan y puedes restaurarla
                  cuando quieras.
                </>
              ) : (
                <>
                  Dejará de aparecer entre las decisiones activas. Puedes
                  restaurarla cuando quieras.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false)
                setTemplateStatus({ template, action: 'archive' })
              }}
            >
              <ArchiveIcon aria-hidden="true" />
              Archivar
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
