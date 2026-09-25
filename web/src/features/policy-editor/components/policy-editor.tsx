import type { ReactNode } from 'react'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import { Spinner } from '#/shared/components/ui/spinner'
import { issuesAt, usePolicyLint } from '../hooks/use-policy-lint'
import { FallbackEditor } from './fallback-editor'
import { FlagRulesEditor } from './flag-rules-editor'
import { LintIssueList } from './lint-issue-list'
import { RuleListEditor } from './rule-list-editor'
import { SignalsEditor } from './signals-editor'

function Section({
  title,
  description,
  path,
  issues,
  children
}: {
  title: string
  description?: string
  path: string
  issues: ReturnType<typeof usePolicyLint>['issues']
  children: ReactNode
}) {
  return (
    <section className="space-y-2" data-lint-target={path}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      {children}
      <LintIssueList issues={issuesAt(issues, path)} />
    </section>
  )
}

/**
 * The Política tab's visual editor: precondiciones, señales, reglas de
 * marcas, reglas y la decisión por defecto — replacing JSON-only editing
 * (the "JSON avanzado" toggle in `PolicyTab` stays as an escape hatch). Live
 * lint (`usePolicyLint`, debounced) surfaces issues next to the field they
 * point at, by path, alongside the structural rules the pickers already
 * enforce by construction.
 */
export function PolicyEditor({
  templateId,
  definition,
  update
}: {
  templateId: string
  definition: TemplateDefinition
  update: (
    recipe: (definition: TemplateDefinition) => TemplateDefinition
  ) => void
}) {
  const { issues, isFetching } = usePolicyLint(templateId, definition)

  return (
    <div className="space-y-6">
      <Alert>
        <AlertDescription className="flex items-center justify-between gap-2">
          <span>
            Se evalúa en este orden — la primera que coincide gana:
            precondiciones, luego reglas, y la decisión por defecto si ninguna
            coincide. Si falta un dato, la condición que lo usa no se cumple (no
            se puede evaluar como verdadera).
          </span>
          {isFetching ? (
            <Spinner className="size-4 shrink-0" aria-label="Validando…" />
          ) : null}
        </AlertDescription>
      </Alert>

      <Section
        title="Precondiciones"
        description="Se evalúan antes de llamar al modelo: solo pueden leer la entrada (`input`) y valores literales."
        path="preconditions"
        issues={issues}
      >
        <RuleListEditor
          definition={definition}
          rules={definition.preconditions}
          onChange={preconditions => update(d => ({ ...d, preconditions }))}
          context="input-only"
          allowFromAnswer={false}
          section="preconditions"
          idBase="precondition"
          emptyText="Ninguna: siempre se llama al modelo."
          issues={issues}
        />
      </Section>

      <Section title="Señales" path="signals" issues={issues}>
        <SignalsEditor
          definition={definition}
          signals={definition.signals}
          onChange={signals => update(d => ({ ...d, signals }))}
          issues={issues}
        />
      </Section>

      <Section
        title="Reglas de marcas"
        description="Todas las que coincidan aplican (no solo la primera); una marca solo la ve una regla posterior."
        path="flagRules"
        issues={issues}
      >
        <FlagRulesEditor
          definition={definition}
          rules={definition.flagRules}
          onChange={flagRules => update(d => ({ ...d, flagRules }))}
          issues={issues}
        />
      </Section>

      <Section
        title="Reglas"
        description="En orden: la primera que coincide decide."
        path="rules"
        issues={issues}
      >
        <RuleListEditor
          definition={definition}
          rules={definition.rules}
          onChange={rules => update(d => ({ ...d, rules }))}
          context="full"
          allowFromAnswer
          section="rules"
          idBase="rule"
          emptyText="Ninguna: siempre decide la que sigue por defecto."
          issues={issues}
        />
      </Section>

      <Section
        title="Decisión por defecto"
        description="Cuando ninguna regla coincide."
        path="fallback"
        issues={issues}
      >
        <FallbackEditor
          definition={definition}
          onChange={decision => update(d => ({ ...d, fallback: { decision } }))}
        />
      </Section>
    </div>
  )
}
