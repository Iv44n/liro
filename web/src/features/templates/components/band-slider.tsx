import { useId } from 'react'
import {
  Field,
  FieldDescription,
  FieldLabel
} from '#/shared/components/ui/field'
import { Slider } from '#/shared/components/ui/slider'
import {
  clampBands,
  formatPercent,
  type PercentBands
} from '../utils/thresholds'

/**
 * The Decide wizard's P(sí) bands: a two-thumb slider (`no` on the left,
 * `yes` on the right, always on their own side of 50 %) with a live
 * explanation of what falls in each zone.
 */
export function BandSlider({
  value,
  onChange
}: {
  value: PercentBands
  onChange: (value: PercentBands) => void
}) {
  const descriptionId = useId()

  return (
    <Field>
      <FieldLabel>Umbral de decisión</FieldLabel>
      <Slider
        value={[value.no, value.yes]}
        min={0}
        max={100}
        step={1}
        minStepsBetweenValues={2}
        getAriaLabel={index =>
          index === 0 ? 'Umbral inferior: no' : 'Umbral superior: sí'
        }
        getAriaValueText={(_formattedValue, thumbValue) =>
          formatPercent(thumbValue)
        }
        aria-describedby={descriptionId}
        onValueChange={values => {
          if (Array.isArray(values)) onChange(clampBands(values))
        }}
      />
      <FieldDescription id={descriptionId}>
        <span className="font-medium text-foreground">
          P(sí) ≥ {formatPercent(value.yes)}
        </span>{' '}
        → «sí».{' '}
        <span className="font-medium text-foreground">
          P(sí) ≤ {formatPercent(value.no)}
        </span>{' '}
        → «no». Entre ambos, la decisión se envía a revisión humana.
      </FieldDescription>
    </Field>
  )
}
