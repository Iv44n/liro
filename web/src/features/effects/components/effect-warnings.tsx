import { AlertTriangleIcon } from 'lucide-react'
import { plural } from '#/features/template-editor/utils/format'
import {
  Alert,
  AlertDescription,
  AlertTitle
} from '#/shared/components/ui/alert'
import type { EffectWarning } from '../types'
import { warningText } from '../utils/labels'

/** Lists `UNBOUND_LABEL`/`ORPHAN_BINDING` warnings from `GET .../effects`. */
export function EffectWarningsBanner({
  warnings
}: {
  warnings: readonly EffectWarning[]
}) {
  if (warnings.length === 0) return null

  return (
    <Alert>
      <AlertTriangleIcon aria-hidden="true" />
      <AlertTitle>
        {plural(warnings.length, 'aviso', 'avisos')} sobre los efectos
      </AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-0.5 ps-4">
          {warnings.map(warning => (
            <li
              key={`${warning.code}-${warning.label ?? ''}-${warning.bindingId ?? ''}`}
            >
              {warningText(warning)}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
