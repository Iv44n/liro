import {
  isLabel,
  NAME_MAX_LENGTH,
  NEEDS_REVIEW,
  SLUG_MAX_LENGTH
} from '../types/definition'

/** Letters Unicode decomposition doesn't reduce to ASCII (as in the API). */
const LETTER_FOLDS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  þ: 'th',
  ı: 'i'
}

/** Lowercase ASCII: accents dropped (`Reseñas` → `resenas`), `ß` → `ss`… */
function foldToAscii(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[ßæœøđðłþı]/g, letter => LETTER_FOLDS[letter] ?? '')
}

/**
 * Mirror of the API's `slugify` (`api/src/modules/templates/versioning.ts`):
 * ASCII-folded, lowercase, every run of other characters → `-`, trimmed to
 * {@link SLUG_MAX_LENGTH}; `template` when nothing is left. The API derives
 * the same slug when the request omits it.
 */
export function slugify(name: string): string {
  const slug = foldToAscii(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-$/, '')
  return slug || 'template'
}

/** The slug a name suggests while typing: `''` until the name has text. */
export const suggestSlug = (name: string): string =>
  name.trim() === '' ? '' : slugify(name)

/**
 * `slug` itself when it isn't `taken`, else the first free `slug-2`,
 * `slug-3`… (shortened so the suffix fits in {@link SLUG_MAX_LENGTH}).
 */
export function uniqueSlug(slug: string, taken: ReadonlySet<string>): string {
  if (slug === '' || !taken.has(slug)) return slug
  for (let counter = 2; ; counter++) {
    const suffix = `-${counter}`
    const base = slug
      .slice(0, SLUG_MAX_LENGTH - suffix.length)
      .replace(/-+$/, '')
    const candidate = `${base}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Free text turned into a decision label (`Facturación urgente` →
 * `facturacion_urgente`): ASCII-folded, lowercase, runs of other characters
 * → `_` (a run of hyphens stays `-`). `''` when nothing valid is left, or
 * when the result is reserved (`needs_review`, `constructor`…).
 */
export function toLabel(text: string): string {
  const label = foldToAscii(text)
    .replace(/[^a-z0-9]+/g, run => (/^-+$/.test(run) ? '-' : '_'))
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, NAME_MAX_LENGTH)
    .replace(/[_-]+$/, '')
  return label !== NEEDS_REVIEW && isLabel(label) ? label : ''
}
