import { useEffect } from 'react'
import { useEditorStore } from '../store/editor-context'

const FLASH_CLASSES = [
  'ring-2',
  'ring-primary',
  'ring-offset-2',
  'ring-offset-background'
]

/** Selectors for `path` and every ancestor, most specific first. */
function targetSelectors(path: string): string[] {
  const segments = path.split('.').filter(Boolean)
  const selectors: string[] = []
  for (let end = segments.length; end > 0; end--) {
    const value = segments.slice(0, end).join('.')
    selectors.push(`[data-lint-target="${CSS.escape(value)}"]`)
  }
  return selectors
}

/**
 * Mounted once by the editor shell. Watches the store's `focus` request
 * (set by the lint panel and the publish dialog's changes list) and scrolls
 * to, briefly highlights, and focuses the closest element declaring a
 * matching `data-lint-target` — after giving a possible tab switch a tick
 * to render it.
 */
export function LintFocusHandler() {
  const focus = useEditorStore(state => state.focus)

  useEffect(() => {
    if (!focus) return
    const id = window.requestAnimationFrame(() => {
      for (const selector of targetSelectors(focus.path)) {
        const el = document.querySelector<HTMLElement>(selector)
        if (!el) continue
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add(...FLASH_CLASSES)
        const focusable = el.matches(
          'input, textarea, select, button, [tabindex]'
        )
          ? el
          : el.querySelector<HTMLElement>('input, textarea, select, button')
        focusable?.focus({ preventScroll: true })
        window.setTimeout(() => el.classList.remove(...FLASH_CLASSES), 1500)
        break
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [focus])

  return null
}
