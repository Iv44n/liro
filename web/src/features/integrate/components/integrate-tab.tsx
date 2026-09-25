import { Link } from '@tanstack/react-router'
import {
  ArchiveIcon,
  BellRingIcon,
  CircleAlertIcon,
  FlaskConicalIcon,
  KeyRoundIcon,
  PlugZapIcon,
  RocketIcon,
  TriangleAlertIcon
} from 'lucide-react'
import type { ReactNode } from 'react'
import { usePermissions } from '#/features/auth/hooks/use-me'
import { CopyButton } from '#/features/playground/components/copy-button'
import {
  CodeBlock,
  Disclosure,
  JsonView
} from '#/features/playground/components/json-view'
import { sampleInput } from '#/features/playground/utils/input-form'
import { NEEDS_REVIEW } from '#/features/templates/types/definition'
import type {
  TemplateView,
  VersionDetailView,
  VersionView
} from '#/sdk/modules/templates/types'
import {
  Alert,
  AlertDescription,
  AlertTitle
} from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/shared/components/ui/empty'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { useVersionDetail } from '../hooks/use-version-detail'
import { exampleRunResponse } from '../utils/example-response'
import { pollSnippet, runUrl } from '../utils/snippets'
import { CodeSnippets } from './code-snippets'
import { TryNow } from './try-now'

export interface IntegrateTabProps {
  template: TemplateView
  /** The latest released version; `null` before the first publish. */
  latestVersion: VersionView | null
}

/** The API origin the snippets call (`VITE_API_URL`, else this origin). */
function apiBaseUrl(): string {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)
    ?.trim()
    .replace(/\/+$/, '')
  if (configured) return configured
  return typeof window === 'undefined' ? '' : window.location.origin
}

const dateFormat = new Intl.DateTimeFormat('es', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

const VERSION_STATUS_LABELS: Record<VersionView['status'], string> = {
  draft: 'Borrador',
  published: 'Publicada',
  deprecated: 'Deprecada',
  model_unavailable: 'Modelo no disponible'
}

const code = (text: string) => (
  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
    {text}
  </code>
)

function Section({
  id,
  title,
  icon,
  description,
  children
}: {
  id: string
  title: string
  icon: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className="min-w-0 space-y-3 rounded-2xl border bg-card p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h3 id={id} className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden className="text-primary [&_svg]:size-4">
            {icon}
          </span>
          {title}
        </h3>
        {description ? (
          <div className="text-sm text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function NotPublished({ archived }: { archived: boolean }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RocketIcon />
        </EmptyMedia>
        <EmptyTitle>Publica una versión para integrarla</EmptyTitle>
        <EmptyDescription>
          Tu sistema llama a versiones publicadas, nunca al borrador. Prueba el
          borrador en el playground y, cuando estés conforme, pulsa{' '}
          <span className="font-medium text-foreground">Publicar</span>: aquí
          aparecerán la referencia, los ejemplos de código y el contrato de
          entrada.
        </EmptyDescription>
        {archived ? (
          <EmptyDescription>
            La decisión está archivada: restáurala antes de publicar.
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
    </Empty>
  )
}

function LoadingSections() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">Cargando la versión…</span>
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  )
}

function RefGuide({ slug, version }: { slug: string; version: VersionView }) {
  const rows = [
    {
      ref: `${slug}@${version.major}`,
      tag: 'Recomendada',
      text: `La última versión publicada de la ${version.major}.x: recibe las mejoras compatibles (versiones menores) sin cambiar tu código, nunca un cambio incompatible.`
    },
    {
      ref: `${slug}@${version.version}`,
      tag: 'Exacta',
      text: 'Exactamente esa versión, para congelar el comportamiento. Si se depreca sigue funcionando, con la cabecera Deprecation.'
    },
    {
      ref: slug,
      tag: 'Sin fijar',
      text: 'La última versión publicada de cualquier mayor: una nueva mayor puede romper tu integración. Responde con la cabecera Warning.'
    }
  ]

  return (
    <ul className="divide-y rounded-xl border">
      {rows.map(row => (
        <li key={row.tag} className="space-y-1 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-sm font-medium break-all">
              {row.ref}
            </code>
            <Badge variant={row.tag === 'Recomendada' ? 'default' : 'outline'}>
              {row.tag}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{row.text}</p>
        </li>
      ))}
    </ul>
  )
}

function VersionWarnings({
  template,
  version
}: {
  template: TemplateView
  version: VersionView
}) {
  return (
    <>
      {template.status === 'archived' ? (
        <Alert variant="destructive">
          <ArchiveIcon aria-hidden />
          <AlertTitle>La decisión está archivada</AlertTitle>
          <AlertDescription>
            Las llamadas responden {code('410 TEMPLATE_ARCHIVED')} hasta que la
            restaures.
          </AlertDescription>
        </Alert>
      ) : null}
      {version.status === 'model_unavailable' ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>
            El modelo de esta versión ya no está disponible
          </AlertTitle>
          <AlertDescription>
            Las llamadas responden {code('409 VERSION_UNAVAILABLE')}. Publica
            una versión nueva con otro modelo.
          </AlertDescription>
        </Alert>
      ) : null}
      {version.status === 'deprecated' ? (
        <Alert>
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>La versión {version.version} está deprecada</AlertTitle>
          <AlertDescription>
            Sigue respondiendo, con la cabecera {code('Deprecation: true')}.
            Publica una versión nueva o reactívala en la pestaña Versiones.
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  )
}

function DecisionValues({ detail }: { detail: VersionDetailView }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {detail.definition.decisions.map(decision => (
        <li key={decision.label} className="rounded-lg border p-2.5">
          <code className="font-mono text-sm font-medium">
            {decision.label}
          </code>
          <p className="text-xs text-muted-foreground">
            {decision.description ?? 'Sin descripción.'}
          </p>
        </li>
      ))}
      <li className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
        <code className="font-mono text-sm font-medium">{NEEDS_REVIEW}</code>
        <p className="text-xs text-muted-foreground">
          Una persona debe decidir; {code('finalDecision')} llega al resolverse
          la revisión.
        </p>
      </li>
    </ul>
  )
}

function InputContract({ detail }: { detail: VersionDetailView }) {
  const { fields } = detail.definition.input

  return (
    <div className="space-y-3">
      {fields.length > 0 ? (
        <ul className="divide-y rounded-xl border text-sm">
          {fields.map(field => (
            <li
              key={field.path}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2"
            >
              <code className="font-mono font-medium break-all">
                input.{field.path}
              </code>
              <span className="text-xs text-muted-foreground">
                {field.type === 'enum' && field.enum
                  ? field.enum.map(value => JSON.stringify(value)).join(' | ')
                  : field.type}
              </span>
              <Badge
                variant={field.required ? 'secondary' : 'outline'}
                className="ms-auto"
              >
                {field.required ? 'obligatorio' : 'opcional'}
              </Badge>
              {field.description ? (
                <p className="w-full text-xs text-muted-foreground">
                  {field.description}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Esta versión no declara campos: envía {code('"input": {}')}.
        </p>
      )}
      <Disclosure title="JSON Schema de la entrada" hint="draft 2020-12">
        {detail.inputJsonSchema ? (
          <JsonView
            value={detail.inputJsonSchema}
            label="JSON Schema de la entrada"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Esta versión no guarda su JSON Schema; consúltalo con{' '}
            {code(`GET /v1/decisions/${detail.version}`)}.
          </p>
        )}
      </Disclosure>
    </div>
  )
}

/**
 * The editor's "Integrar" tab: how to call the published version from
 * another system — the pinned ref, copyable snippets with an example input,
 * the input contract and the response — plus "Probar ahora", which runs it
 * through `/v1` with the session.
 */
export function IntegrateTab({ template, latestVersion }: IntegrateTabProps) {
  const permissions = usePermissions()
  const detail = useVersionDetail(template.id, latestVersion?.id ?? null)

  if (!latestVersion) {
    return <NotPublished archived={template.status === 'archived'} />
  }

  const baseUrl = apiBaseUrl()
  const pinnedRef = `${template.slug}@${latestVersion.major}`
  const canCreateKeys = permissions?.apiKey.create ?? false

  return (
    <div className="min-w-0 space-y-4">
      <VersionWarnings template={template} version={latestVersion} />

      <Section
        id="integrate-ref"
        title="Referencia"
        icon={<PlugZapIcon />}
        description="Llama siempre a una versión mayor fija: así los cambios incompatibles nunca te llegan sin avisar."
      >
        <div className="flex min-w-0 items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-lg font-semibold">
            {pinnedRef}
          </code>
          <CopyButton
            text={pinnedRef}
            label="Copiar referencia"
            size="icon-sm"
          />
        </div>
        <p className="text-sm text-muted-foreground">
          Hoy resuelve a la versión{' '}
          <span className="font-medium text-foreground">
            {latestVersion.version}
          </span>{' '}
          <Badge variant="outline">
            {VERSION_STATUS_LABELS[latestVersion.status]}
          </Badge>
          {latestVersion.publishedAt
            ? ` · publicada el ${dateFormat.format(new Date(latestVersion.publishedAt))}`
            : null}
          .
        </p>
        <RefGuide slug={template.slug} version={latestVersion} />
      </Section>

      {detail.isPending ? (
        <LoadingSections />
      ) : detail.isError ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>
            No se pudo cargar la versión {latestVersion.version}
          </AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{detail.error.message || 'Inténtalo de nuevo.'}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => detail.refetch()}
              disabled={detail.isFetching}
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <IntegrateDetails
          template={template}
          detail={detail.data}
          baseUrl={baseUrl}
          pinnedRef={pinnedRef}
          canCreateKeys={canCreateKeys}
        />
      )}
    </div>
  )
}

function IntegrateDetails({
  template,
  detail,
  baseUrl,
  pinnedRef,
  canCreateKeys
}: {
  template: TemplateView
  detail: VersionDetailView
  baseUrl: string
  pinnedRef: string
  canCreateKeys: boolean
}) {
  const fields = detail.definition.input.fields
  const sample = sampleInput(fields)
  const unavailable =
    template.status === 'archived' || detail.status === 'model_unavailable'

  return (
    <>
      <Section
        id="integrate-call"
        title="Llamar a la API"
        icon={<KeyRoundIcon />}
        description={
          <>
            Autentícate con una API key en la cabecera {code('x-api-key')} (o{' '}
            {code('Authorization: Bearer')}) y envía un{' '}
            {code('Idempotency-Key')} por operación: si reintentas con la misma
            clave durante 24 h, obtienes la misma ejecución en lugar de una
            nueva.
          </>
        }
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary" className="font-mono">
            POST
          </Badge>
          <code className="min-w-0 font-mono text-xs break-all">
            {runUrl(baseUrl, pinnedRef)}
          </code>
        </div>
        <CodeSnippets
          baseUrl={baseUrl}
          decisionRef={pinnedRef}
          input={sample}
        />
        <p className="text-sm text-muted-foreground">
          La entrada de ejemplo usa todos los campos de la versión{' '}
          {detail.version}; los opcionales puedes omitirlos. Añade{' '}
          {code('metadata')} (hasta 50 claves) para guardar tus propios ids con
          la ejecución.
        </p>
        <Link
          to="/api-keys"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          <KeyRoundIcon aria-hidden className="size-4" />
          {canCreateKeys ? 'Crear una API key' : 'Ver las API keys'}
        </Link>
      </Section>

      <Section
        id="integrate-input"
        title="Contrato de entrada"
        icon={<PlugZapIcon />}
        description={
          <>
            Se valida en cada llamada: un campo que falta o con otro tipo
            responde {code('422 VALIDATION_FAILED')} con rutas como{' '}
            {code('input.campo')}. Las claves no declaradas se descartan.
          </>
        }
      >
        <InputContract detail={detail} />
      </Section>

      <Section
        id="integrate-response"
        title="Respuesta"
        icon={<BellRingIcon />}
        description={
          <>
            {code('decision')} es una de estas etiquetas; úsala junto con{' '}
            {code('finalDecision')}, que también refleja lo que decida una
            persona.
          </>
        }
      >
        <DecisionValues detail={detail} />
        <Disclosure title="Ejemplo de respuesta" hint="200 OK">
          <JsonView
            value={exampleRunResponse({
              slug: template.slug,
              version: detail.version,
              definition: detail.definition
            })}
            label="Ejemplo de respuesta"
            maxHeight="max-h-96"
          />
        </Disclosure>
        <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-medium">
            Cuando la respuesta es {code(NEEDS_REVIEW)}
          </p>
          <p className="text-sm text-muted-foreground">
            Se crea una tarea en{' '}
            <Link
              to="/reviews"
              className="font-medium text-foreground underline underline-offset-4"
            >
              Revisión
            </Link>{' '}
            y {code('finalDecision')} vale {code('null')}. {code('suggestion')}{' '}
            indica lo que el motor habría decidido. Consulta la ejecución (por
            ejemplo, cada minuto) hasta que {code('finalDecision')} tenga valor:
          </p>
          <CodeBlock
            code={pollSnippet(baseUrl)}
            label="Consultar una ejecución"
          />
        </div>
      </Section>

      <Section
        id="integrate-test-keys"
        title="Claves de prueba"
        icon={<FlaskConicalIcon />}
      >
        <p className="text-sm text-muted-foreground">
          Con una clave {code('lr_test_…')} las ejecuciones corren en modo
          prueba: deciden igual y sus revisiones se marcan como prueba, pero
          nunca disparan efectos (webhooks, avisos) y se filtran aparte en
          Ejecuciones. Úsalas en desarrollo y CI; en producción, una{' '}
          {code('lr_live_…')}.
        </p>
      </Section>

      <Section
        id="integrate-try"
        title="Probar ahora"
        icon={<RocketIcon />}
        description="Ejecuta la versión publicada tal como lo haría tu integración y mira la respuesta exacta."
      >
        <TryNow
          key={detail.id}
          decisionRef={pinnedRef}
          sample={sample}
          fields={fields}
          disabled={unavailable}
          disabledReason={
            unavailable
              ? 'Esta versión no se puede ejecutar ahora mismo (ver el aviso de arriba).'
              : undefined
          }
        />
      </Section>
    </>
  )
}
