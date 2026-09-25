import type { DefinitionChange } from '#/features/templates/types/definition'
import { describeChange, groupChanges, SEVERITY_TEXTS } from '../utils/changes'

const ORDER = ['breaking', 'behavior', 'compatible'] as const

/** A definition diff grouped by severity, in Spanish (publish dialog, Versiones tab). */
export function ChangesList({
  changes
}: {
  changes: readonly DefinitionChange[]
}) {
  if (changes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin cambios detectables frente a la última versión publicada.
      </p>
    )
  }

  const groups = groupChanges(changes)

  return (
    <div className="space-y-3">
      {ORDER.map(severity => {
        const items = groups[severity]
        if (items.length === 0) return null
        const texts = SEVERITY_TEXTS[severity]
        return (
          <div key={severity} className="space-y-1.5">
            <div>
              <p className="text-sm font-medium">{texts.title}</p>
              <p className="text-xs text-muted-foreground">
                {texts.description}
              </p>
            </div>
            <ul className="space-y-1 text-sm">
              {items.map(change => (
                <li
                  key={`${change.code}-${change.path}-${change.message}`}
                  className="rounded-lg bg-muted/50 px-2.5 py-1.5"
                >
                  {describeChange(change)}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
