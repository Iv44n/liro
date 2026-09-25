import { useBlocker } from '@tanstack/react-router'

/**
 * Blocks navigation while there are unsaved changes — but only when it
 * actually leaves the editor: a tab switch (`?tab=`) is a navigation too,
 * and must not be blocked, so this only fires when the pathname itself
 * changes. `withResolver` surfaces a confirm/cancel dialog instead of the
 * browser's own prompt.
 */
export function useUnsavedChangesBlocker(shouldBlock: boolean) {
  return useBlocker({
    shouldBlockFn: ({ current, next }) =>
      shouldBlock && current.pathname !== next.pathname,
    withResolver: true
  })
}
