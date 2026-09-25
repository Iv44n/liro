import { ChevronRightIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '#/shared/components/ui/collapsible'
import { cn } from '#/shared/utils/shadcn.utils'
import { formatJson } from '../utils/input-form'
import { CopyButton } from './copy-button'

/** Read-only, scrollable JSON (or any code) with a copy button. */
export function CodeBlock({
  code,
  label,
  className,
  maxHeight = 'max-h-80'
}: {
  code: string
  /** Accessible name of the block and of its copy button. */
  label: string
  className?: string
  maxHeight?: string
}) {
  return (
    <div
      className={cn(
        'relative min-w-0 rounded-xl border bg-muted/40',
        className
      )}
    >
      <CopyButton
        text={code}
        label={`Copiar ${label.toLowerCase()}`}
        className="absolute end-1.5 top-1.5 z-10 bg-background/70 backdrop-blur"
      />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: labels this scrollable code block for assistive tech; <section> would lose the "preformatted text" semantics */}
      <pre
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable for keyboard users
        tabIndex={0}
        className={cn(
          'overflow-auto p-3 pe-10 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          maxHeight
        )}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function JsonView({
  value,
  label,
  className,
  maxHeight
}: {
  value: unknown
  label: string
  className?: string
  maxHeight?: string
}) {
  return (
    <CodeBlock
      code={formatJson(value)}
      label={label}
      className={className}
      maxHeight={maxHeight}
    />
  )
}

/** A disclosure ("▸ title") whose panel holds a JSON view or other details. */
export function Disclosure({
  title,
  hint,
  children,
  defaultOpen = false
}: {
  title: ReactNode
  /** Muted text after the title, e.g. a size. */
  hint?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="min-w-0">
      <CollapsibleTrigger className="group/disclosure flex w-full items-center gap-1.5 rounded-md py-1 text-start text-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronRightIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/disclosure:rotate-90"
        />
        <span>{title}</span>
        {hint ? (
          <span className="ms-auto text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  )
}
