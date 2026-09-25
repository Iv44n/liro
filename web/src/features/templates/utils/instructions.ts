import { PATH_SEGMENT_PATTERN } from '../types/definition'

/**
 * Instructions and criteria reference input fields between backticks
 * (`` `ticket.message` ``). The API lints dotted tokens that aren't declared
 * fields (`INSTRUCTION_UNKNOWN_PATH`); these helpers let the wizards warn
 * about them while typing and insert references at the cursor.
 */

const BACKTICKED = /`([^`]+)`/g

/**
 * Backticked tokens shaped like a dot path (as the API's lint reads them).
 * Single words are not paths: authors backtick option names too.
 */
export function backtickedPaths(text: string): string[] {
  return [...text.matchAll(BACKTICKED)]
    .map(match => match[1] ?? '')
    .filter(token => {
      const segments = token.split('.')
      return (
        segments.length > 1 &&
        segments.every(segment => PATH_SEGMENT_PATTERN.test(segment))
      )
    })
}

/** Declared field paths plus the objects they imply (`ticket` of `ticket.message`). */
export function declaredPaths(fieldPaths: readonly string[]): Set<string> {
  const declared = new Set<string>()
  for (const path of fieldPaths) {
    const segments = path.split('.')
    for (let end = 1; end <= segments.length; end++) {
      declared.add(segments.slice(0, end).join('.'))
    }
  }
  return declared
}

/**
 * Dotted references in `texts` that are neither a declared field nor one of
 * the objects the fields imply: unique, in order of appearance.
 */
export function unknownReferences(
  texts: readonly string[],
  fieldPaths: readonly string[]
): string[] {
  const declared = declaredPaths(fieldPaths)
  const unknown = new Set<string>()
  for (const text of texts) {
    for (const token of backtickedPaths(text)) {
      if (!declared.has(token)) unknown.add(token)
    }
  }
  return [...unknown]
}

/**
 * `text` with `` `path` `` replacing the selection `[start, end)`, preceded by
 * a space when it would otherwise stick to the previous word, and the caret
 * position right after the inserted reference.
 */
export function insertReference(
  text: string,
  start: number,
  end: number,
  path: string
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  const before = text.slice(0, from)
  const needsSpace = before !== '' && !/[\s([{"'¿¡]$/.test(before)
  const reference = `${needsSpace ? ' ' : ''}\`${path}\``
  return {
    text: `${before}${reference}${text.slice(to)}`,
    caret: from + reference.length
  }
}
