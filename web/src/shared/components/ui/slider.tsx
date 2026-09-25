import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "#/shared/utils/shadcn.utils"

type SliderProps = SliderPrimitive.Root.Props & {
  /**
   * Per-thumb `aria-label` for the underlying `<input type="range">`,
   * keyed by thumb index. Required to distinguish thumbs on a multi-thumb
   * (range) slider; for a single thumb, `aria-label` is used instead when
   * this is omitted.
   */
  getAriaLabel?: (index: number) => string
  /**
   * Per-thumb `aria-valuetext` for the underlying `<input type="range">`.
   * For a single thumb, `aria-valuetext` is used instead when this is
   * omitted.
   */
  getAriaValueText?: (
    formattedValue: string,
    value: number,
    index: number
  ) => string
  /**
   * `aria-describedby` for the underlying `<input type="range">`(s), e.g. to
   * point assistive tech at helper text rendered next to the slider. Applied
   * to every thumb, same as a plain `aria-label` would be.
   */
  "aria-describedby"?: string
}

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  getAriaLabel,
  getAriaValueText,
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
  "aria-describedby": ariaDescribedBy,
  ...props
}: SliderProps) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  // `SliderPrimitive.Root` renders a plain container `<div>`; the actual
  // `<input type="range">` assistive tech lands on is rendered by each
  // `SliderPrimitive.Thumb`. So per-thumb accessible name/value/description
  // must be passed there, not left to land on Root via `...props` — Root
  // only re-exposes `aria-labelledby` to the thumbs (via context), not
  // `aria-describedby`. For the common single-thumb case, fall back to a
  // plain `aria-label`/`aria-valuetext` so callers don't need
  // `getAriaLabel`/`getAriaValueText` just to label one control.
  const resolvedGetAriaLabel =
    getAriaLabel ?? (ariaLabel !== undefined ? () => ariaLabel : undefined)
  const resolvedGetAriaValueText =
    getAriaValueText ??
    (ariaValueText !== undefined ? () => ariaValueText : undefined)

  return (
    <SliderPrimitive.Root
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-4xl bg-muted select-none data-horizontal:h-3 data-horizontal:w-full data-vertical:h-full data-vertical:w-3"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            getAriaLabel={resolvedGetAriaLabel}
            getAriaValueText={resolvedGetAriaValueText}
            aria-describedby={ariaDescribedBy}
            className="block size-4 shrink-0 rounded-4xl border border-primary bg-white shadow-sm ring-ring/50 transition-colors select-none hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
