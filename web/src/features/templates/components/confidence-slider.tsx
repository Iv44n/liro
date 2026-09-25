import { useId } from 'react'
import {
  Field,
  FieldDescription,
  FieldLabel
} from '#/shared/components/ui/field'
import { Slider } from '#/shared/components/ui/slider'
import { formatPercent } from '../utils/thresholds'

/** The Classify wizard's shared `minConfidence`, as a whole percentage (0..100). */
export function ConfidenceSlider({
  value,
  onChange
}: {
  value: number
  onChange: (value: number) => void
}) {
  const labelId = useId()
  const descriptionId = useId()

  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel id={labelId}>Confianza mínima</FieldLabel>
        <span className="font-mono text-sm tabular-nums" aria-hidden="true">
          {formatPercent(value)}
        </span>
      </div>
      <Slider
        // `Slider`'s thumb renders the actual `<input type="range">`, whose id
        // base-ui generates internally and doesn't expose for `htmlFor`, so the
        // visible `FieldLabel`/`FieldDescription` are associated via
        // `aria-labelledby`/`aria-describedby` instead.
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        value={[value]}
        min={0}
        max={100}
        step={1}
        aria-valuetext={formatPercent(value)}
        onValueChange={values => {
          const [next] = Array.isArray(values) ? values : [values]
          if (typeof next === 'number') onChange(next)
        }}
      />
      <FieldDescription id={descriptionId}>
        Por debajo de {formatPercent(value)}, la decisión se envía a revisión
        humana en vez de aplicarse sola, sugiriendo la etiqueta más probable.
      </FieldDescription>
    </Field>
  )
}
