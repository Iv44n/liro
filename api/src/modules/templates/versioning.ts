import { canonicalJson } from '#shared/core/hash'
import type {
  DecisionDef,
  InputField,
  QuestionDef,
  TemplateDefinition
} from './definition'
import { isPathPrefix } from './paths'
import type { VersionStatus } from './templates.schemas'

/**
 * Template versioning: `major.minor` numbers, the diff shown before a publish
 * (its breaking subset is only allowed in a new major), and the references
 * callers use to pick a version (`slug`, `slug@1`, `slug@1.2`).
 */

// ── Version numbers ──────────────────────────────────────────────────────

export interface VersionNumber {
  major: number
  minor: number
}

/** `1.2`: how versions appear in refs, responses and the UI. */
export const formatVersion = (version: VersionNumber): string =>
  `${version.major}.${version.minor}`

/** Sort comparator: negative when `a` is older than `b`, `0` when equal. */
export function compareVersions(a: VersionNumber, b: VersionNumber): number {
  return a.major - b.major || a.minor - b.minor
}

/**
 * The number the next publish gets: `1.0` for the first one (whatever
 * `major` says), then `(M+1).0` when the author ticks "major", else `M.(m+1)`.
 */
export function nextVersion(
  latest: VersionNumber | null,
  options: { major: boolean }
): VersionNumber {
  if (!latest) return { major: 1, minor: 0 }
  return options.major
    ? { major: latest.major + 1, minor: 0 }
    : { major: latest.major, minor: latest.minor + 1 }
}

// ── Definition diff ──────────────────────────────────────────────────────

/**
 * - `breaking`: callers written against the previous version may break
 *   (new/removed labels, a stricter input contract); requires a new major.
 * - `behavior`: same contract, but decisions may change (model, questions,
 *   policy, what Jev sees); allowed in a minor, highlighted in the diff.
 * - `compatible`: a looser input contract or documentation only.
 */
export type ChangeSeverity = 'breaking' | 'behavior' | 'compatible'

/** Every change code with its (fixed) severity. */
export const CHANGE_SEVERITY = {
  LABEL_ADDED: 'breaking',
  LABEL_REMOVED: 'breaking',
  REQUIRED_FIELD_ADDED: 'breaking',
  FIELD_REMOVED: 'breaking',
  FIELD_TYPE_CHANGED: 'breaking',
  FIELD_MADE_REQUIRED: 'breaking',
  ENUM_VALUE_REMOVED: 'breaking',
  FIELD_CONSTRAINT_TIGHTENED: 'breaking',
  MODEL_CHANGED: 'behavior',
  QUESTIONS_CHANGED: 'behavior',
  POLICY_CHANGED: 'behavior',
  STATE_CHANGED: 'behavior',
  OPTIONAL_FIELD_ADDED: 'compatible',
  FIELD_MADE_OPTIONAL: 'compatible',
  ENUM_VALUE_ADDED: 'compatible',
  FIELD_CONSTRAINT_RELAXED: 'compatible',
  DESCRIPTION_CHANGED: 'compatible'
} as const satisfies Record<string, ChangeSeverity>

export type ChangeCode = keyof typeof CHANGE_SEVERITY

export interface DefinitionChange {
  code: ChangeCode
  severity: ChangeSeverity
  message: string
  /**
   * The changed element by identity, not array index (indexes differ between
   * the two versions): `decisions.<label>`, `input.fields.<path>`,
   * `questions.<id>`, `rules.<id>`, or a section (`model`, `rules`,
   * `fallback`, `state.include`, `state.context`…).
   */
  path?: string
}

const SEVERITY_RANK: Record<ChangeSeverity, number> = {
  breaking: 0,
  behavior: 1,
  compatible: 2
}

/**
 * What changed from `previous` to `next`, breaking first, then behavior, then
 * compatible; within a severity by section (labels, fields, model,
 * questions, policy, state) and then by key. Order-only edits (labels,
 * fields, enum values, question keys, `state.include`) and value-preserving
 * spellings (`alwaysReview: false` vs absent, `context: {}` vs absent) are
 * not changes. Documentation-only text — field/decision descriptions,
 * question notes and rule names — is `DESCRIPTION_CHANGED`.
 */
export function diffDefinitions(
  previous: TemplateDefinition,
  next: TemplateDefinition
): DefinitionChange[] {
  return [
    ...diffDecisions(previous.decisions, next.decisions),
    ...diffFields(previous.input.fields, next.input.fields),
    ...diffModel(previous.model, next.model),
    ...diffQuestions(previous.questions, next.questions),
    ...diffPolicy(previous, next),
    ...diffState(previous, next)
  ].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

/** The changes that require publishing a new major. */
export function breakingChanges(
  changes: readonly DefinitionChange[]
): DefinitionChange[] {
  return changes.filter(change => change.severity === 'breaking')
}

const change = (
  code: ChangeCode,
  path: string,
  message: string
): DefinitionChange => ({
  code,
  severity: CHANGE_SEVERITY[code],
  message,
  path
})

const same = (a: unknown, b: unknown): boolean =>
  canonicalJson(a) === canonicalJson(b)

const sortedUnion = (a: Iterable<string>, b: Iterable<string>): string[] =>
  [...new Set([...a, ...b])].sort()

const quoted = (values: readonly string[]): string =>
  values.map(value => `\`${value}\``).join(', ')

/** Items by key, first occurrence winning (duplicates are lint errors, and the engine also uses the first). */
function byKey<T>(
  items: readonly T[],
  key: (item: T) => string
): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) {
    const id = key(item)
    if (!map.has(id)) map.set(id, item)
  }
  return map
}

function diffDecisions(
  previous: readonly DecisionDef[],
  next: readonly DecisionDef[]
): DefinitionChange[] {
  const before = byKey(previous, decision => decision.label)
  const after = byKey(next, decision => decision.label)
  const changes: DefinitionChange[] = []

  for (const label of sortedUnion(before.keys(), after.keys())) {
    const path = `decisions.${label}`
    const old = before.get(label)
    const now = after.get(label)
    if (!now) {
      changes.push(change('LABEL_REMOVED', path, `Label \`${label}\` removed`))
    } else if (!old) {
      changes.push(change('LABEL_ADDED', path, `Label \`${label}\` added`))
    } else {
      const policy: string[] = []
      if (old.minConfidence !== now.minConfidence) {
        policy.push(
          `minConfidence ${old.minConfidence ?? 'none'} → ${now.minConfidence ?? 'none'}`
        )
      }
      const oldReview = old.alwaysReview ?? false
      const newReview = now.alwaysReview ?? false
      if (oldReview !== newReview) {
        policy.push(`alwaysReview ${oldReview} → ${newReview}`)
      }
      if (policy.length > 0) {
        changes.push(
          change(
            'POLICY_CHANGED',
            path,
            `Label \`${label}\`: ${policy.join(', ')}`
          )
        )
      }
      if (old.description !== now.description) {
        changes.push(
          change(
            'DESCRIPTION_CHANGED',
            path,
            `Description of label \`${label}\` changed`
          )
        )
      }
    }
  }
  return changes
}

const limit = (value: number | undefined) =>
  value === undefined ? 'no limit' : String(value)

function diffFields(
  previous: readonly InputField[],
  next: readonly InputField[]
): DefinitionChange[] {
  const before = byKey(previous, field => field.path)
  const after = byKey(next, field => field.path)
  const changes: DefinitionChange[] = []

  for (const path of sortedUnion(before.keys(), after.keys())) {
    const at = `input.fields.${path}`
    const old = before.get(path)
    const now = after.get(path)
    if (!now) {
      changes.push(change('FIELD_REMOVED', at, `Field \`${path}\` removed`))
      continue
    }
    if (!old) {
      changes.push(
        now.required
          ? change(
              'REQUIRED_FIELD_ADDED',
              at,
              `Required field \`${path}\` added`
            )
          : change(
              'OPTIONAL_FIELD_ADDED',
              at,
              `Optional field \`${path}\` added`
            )
      )
      continue
    }

    if (old.type !== now.type) {
      changes.push(
        change(
          'FIELD_TYPE_CHANGED',
          at,
          `Field \`${path}\` changed type from ${old.type} to ${now.type}`
        )
      )
    }
    if (!old.required && now.required) {
      changes.push(
        change('FIELD_MADE_REQUIRED', at, `Field \`${path}\` is now required`)
      )
    }
    if (old.required && !now.required) {
      changes.push(
        change('FIELD_MADE_OPTIONAL', at, `Field \`${path}\` is now optional`)
      )
    }

    // Constraints only compare within one type; a type change says it all.
    if (old.type === now.type) {
      const oldValues = old.enum ?? []
      const newValues = now.enum ?? []
      const removed = oldValues.filter(value => !newValues.includes(value))
      const added = newValues.filter(value => !oldValues.includes(value))
      if (removed.length > 0) {
        changes.push(
          change(
            'ENUM_VALUE_REMOVED',
            at,
            `Field \`${path}\` no longer accepts ${quoted(removed)}`
          )
        )
      }
      if (added.length > 0) {
        changes.push(
          change(
            'ENUM_VALUE_ADDED',
            at,
            `Field \`${path}\` now also accepts ${quoted(added)}`
          )
        )
      }

      const from = old.maxLength
      const to = now.maxLength
      const message = `maxLength of \`${path}\` changed from ${limit(from)} to ${limit(to)}`
      if (to !== undefined && (from === undefined || to < from)) {
        changes.push(change('FIELD_CONSTRAINT_TIGHTENED', at, message))
      } else if (from !== undefined && (to === undefined || to > from)) {
        changes.push(change('FIELD_CONSTRAINT_RELAXED', at, message))
      }
    }

    if (old.description !== now.description) {
      changes.push(
        change(
          'DESCRIPTION_CHANGED',
          at,
          `Description of field \`${path}\` changed`
        )
      )
    }
  }
  return changes
}

const modelName = (model: TemplateDefinition['model']) =>
  model.version
    ? `${model.family}-${model.version}`
    : `${model.family} (latest)`

function diffModel(
  previous: TemplateDefinition['model'],
  next: TemplateDefinition['model']
): DefinitionChange[] {
  if (previous.family === next.family && previous.version === next.version) {
    return []
  }
  return [
    change(
      'MODEL_CHANGED',
      'model',
      `Model changed from ${modelName(previous)} to ${modelName(next)}`
    )
  ]
}

/**
 * A question property as it affects the run: boolean `criteria: {}` sends
 * the same request as no criteria (see `toCanonicalQuestion`).
 */
function property(question: QuestionDef, key: string): unknown {
  const value = (question as Record<string, unknown>)[key]
  const empty =
    question.type === 'boolean' &&
    key === 'criteria' &&
    value !== null &&
    typeof value === 'object' &&
    Object.values(value).every(entry => entry === undefined)
  return empty ? undefined : value
}

function diffQuestions(
  previous: TemplateDefinition['questions'],
  next: TemplateDefinition['questions']
): DefinitionChange[] {
  // Maps, not the records themselves: an id like `constructor` must not hit Object.prototype.
  const before = new Map(Object.entries(previous))
  const after = new Map(Object.entries(next))
  const changes: DefinitionChange[] = []

  for (const id of sortedUnion(before.keys(), after.keys())) {
    const path = `questions.${id}`
    const old = before.get(id)
    const now = after.get(id)
    if (!now) {
      changes.push(
        change('QUESTIONS_CHANGED', path, `Question \`${id}\` removed`)
      )
      continue
    }
    if (!old) {
      changes.push(
        change('QUESTIONS_CHANGED', path, `Question \`${id}\` added`)
      )
      continue
    }
    // `note` is never sent to Jev: documentation, not behavior.
    const parts = sortedUnion(Object.keys(old), Object.keys(now)).filter(
      key => key !== 'note' && !same(property(old, key), property(now, key))
    )
    if (parts.length > 0) {
      changes.push(
        change(
          'QUESTIONS_CHANGED',
          path,
          `Question \`${id}\` changed (${parts.join(', ')})`
        )
      )
    }
    if (old.note !== now.note) {
      changes.push(
        change(
          'DESCRIPTION_CHANGED',
          path,
          `Note of question \`${id}\` changed`
        )
      )
    }
  }
  return changes
}

type PolicySection = 'preconditions' | 'signals' | 'flagRules' | 'rules'

const SECTION_TITLES: Record<PolicySection, string> = {
  preconditions: 'Preconditions',
  signals: 'Signals',
  flagRules: 'Flag rules',
  rules: 'Rules'
}

type RuleSection = Exclude<PolicySection, 'signals'>

const RULE_NOUNS: Record<RuleSection, string> = {
  preconditions: 'precondition',
  flagRules: 'flag rule',
  rules: 'rule'
}

/**
 * One `POLICY_CHANGED` per section whose content differs, naming the ids
 * added, removed and changed, and whether the order changed (it matters:
 * first match wins, and a signal only sees earlier ones).
 */
function diffSection<T>(
  section: PolicySection,
  previous: readonly T[],
  next: readonly T[],
  key: (item: T) => string,
  body: (item: T) => unknown
): DefinitionChange[] {
  if (same(previous.map(body), next.map(body))) return []

  const before = byKey(previous, key)
  const after = byKey(next, key)
  const added = [...after.keys()].filter(id => !before.has(id))
  const removed = [...before.keys()].filter(id => !after.has(id))
  const changed: string[] = []
  for (const [id, item] of after) {
    const old = before.get(id)
    if (old !== undefined && !same(body(old), body(item))) changed.push(id)
  }
  const kept = (items: Map<string, T>, other: Map<string, T>) =>
    [...items.keys()].filter(id => other.has(id))

  const details: string[] = []
  if (added.length > 0) details.push(`added ${quoted(added)}`)
  if (removed.length > 0) details.push(`removed ${quoted(removed)}`)
  if (changed.length > 0) details.push(`changed ${quoted(changed)}`)
  if (!same(kept(before, after), kept(after, before))) details.push('reordered')

  const title = SECTION_TITLES[section]
  return [
    change(
      'POLICY_CHANGED',
      section,
      details.length > 0
        ? `${title}: ${details.join('; ')}`
        : `${title} changed`
    )
  ]
}

interface NamedRule {
  id: string
  name?: string
}

/** A rule's `name` is a display name: renaming it changes no decision. */
const ruleBody = (rule: NamedRule) => ({ ...rule, name: undefined })

function diffRuleNames(
  section: RuleSection,
  previous: readonly NamedRule[],
  next: readonly NamedRule[]
): DefinitionChange[] {
  const before = byKey(previous, rule => rule.id)
  const changes: DefinitionChange[] = []
  for (const [id, rule] of byKey(next, rule => rule.id)) {
    const old = before.get(id)
    if (old && old.name !== rule.name) {
      changes.push(
        change(
          'DESCRIPTION_CHANGED',
          `${section}.${id}`,
          `Name of ${RULE_NOUNS[section]} \`${id}\` changed`
        )
      )
    }
  }
  return changes
}

function diffPolicy(
  previous: TemplateDefinition,
  next: TemplateDefinition
): DefinitionChange[] {
  const ruleId = (rule: NamedRule) => rule.id
  const changes = [
    ...diffSection(
      'preconditions',
      previous.preconditions,
      next.preconditions,
      ruleId,
      ruleBody
    ),
    ...diffSection(
      'signals',
      previous.signals,
      next.signals,
      signal => signal.name,
      signal => signal
    ),
    ...diffSection(
      'flagRules',
      previous.flagRules,
      next.flagRules,
      ruleId,
      ruleBody
    ),
    ...diffSection('rules', previous.rules, next.rules, ruleId, ruleBody)
  ]

  if (previous.fallback.decision !== next.fallback.decision) {
    changes.push(
      change(
        'POLICY_CHANGED',
        'fallback',
        `Fallback changed from \`${previous.fallback.decision}\` to \`${next.fallback.decision}\``
      )
    )
  }

  return [
    ...changes,
    ...diffRuleNames(
      'preconditions',
      previous.preconditions,
      next.preconditions
    ),
    ...diffRuleNames('flagRules', previous.flagRules, next.flagRules),
    ...diffRuleNames('rules', previous.rules, next.rules)
  ]
}

/**
 * The declared input paths that reach Jev: `state.include` (default: every
 * field), with an included parent expanded to the fields under it — the
 * input is validated (unknown keys stripped) before the state is built, so
 * adding a field under an included parent does change what Jev sees. A path
 * inside a declared field (an `object`'s key) is kept as is; one that is
 * neither (a lint error) reaches nothing, so declaring it later is a change.
 */
function statePaths(definition: TemplateDefinition): string[] {
  const fields = definition.input.fields.map(field => field.path)
  const paths = new Set<string>()
  for (const include of definition.state.include ?? fields) {
    const covered = fields.filter(field => isPathPrefix(include, field))
    const inside = fields.some(field => isPathPrefix(field, include))
    for (const path of covered.length > 0 ? covered : inside ? [include] : []) {
      paths.add(path)
    }
  }
  return [...paths].sort()
}

function diffState(
  previous: TemplateDefinition,
  next: TemplateDefinition
): DefinitionChange[] {
  const changes: DefinitionChange[] = []

  const before = statePaths(previous)
  const after = statePaths(next)
  const added = after.filter(path => !before.includes(path))
  const removed = before.filter(path => !after.includes(path))
  if (added.length > 0 || removed.length > 0) {
    const details: string[] = []
    if (added.length > 0) details.push(`now includes ${quoted(added)}`)
    if (removed.length > 0) {
      details.push(`no longer includes ${quoted(removed)}`)
    }
    changes.push(
      change(
        'STATE_CHANGED',
        'state.include',
        `Input sent to Jev ${details.join('; ')}`
      )
    )
  }

  const oldContext = new Map(Object.entries(previous.state.context ?? {}))
  const newContext = new Map(Object.entries(next.state.context ?? {}))
  const keys = sortedUnion(oldContext.keys(), newContext.keys()).filter(
    key =>
      oldContext.has(key) !== newContext.has(key) ||
      !same(oldContext.get(key), newContext.get(key))
  )
  if (keys.length > 0) {
    changes.push(
      change(
        'STATE_CHANGED',
        'state.context',
        `Static context sent to Jev changed (${quoted(keys)})`
      )
    )
  }
  return changes
}

// ── Slugs and refs ───────────────────────────────────────────────────────

/** Template slugs: lowercase ASCII words joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const SLUG_MAX_LENGTH = 64

/** Version parts must fit the Postgres `integer` columns they are compared with. */
const MAX_VERSION_PART = 2_147_483_647

/** No leading zeros: `1.02` is not a spelling of `1.2`. */
const REF_PATTERN = /^([^@]*)(?:@(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?)?$/

export const isSlug = (value: string): boolean =>
  value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value)

export interface ParsedRef {
  slug: string
  major?: number
  minor?: number
}

/**
 * Parses `slug`, `slug@1` or `slug@1.2` (what `/v1/decisions/:ref` takes);
 * anything else — bad slug, `@`, `@1.2.3`, leading zeros, whitespace — is
 * `null`.
 */
export function parseRef(ref: string): ParsedRef | null {
  const match = REF_PATTERN.exec(ref)
  if (!match) return null
  const [, slug = '', major, minor] = match
  if (!isSlug(slug)) return null
  if (major === undefined) return { slug }

  const majorNumber = Number(major)
  if (majorNumber > MAX_VERSION_PART) return null
  if (minor === undefined) return { slug, major: majorNumber }

  const minorNumber = Number(minor)
  if (minorNumber > MAX_VERSION_PART) return null
  return { slug, major: majorNumber, minor: minorNumber }
}

/** Letters Unicode decomposition doesn't reduce to ASCII. */
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

/**
 * A slug suggestion for a template name: ASCII-folded (`Reseñas` →
 * `resenas`), lowercase, every run of other characters → `-`, trimmed to
 * {@link SLUG_MAX_LENGTH}; `template` when nothing is left. Always matches
 * {@link SLUG_PATTERN}.
 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[ßæœøđðłþı]/g, letter => LETTER_FOLDS[letter] ?? '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-$/, '')
  return slug || 'template'
}

// ── Resolving refs ───────────────────────────────────────────────────────

export interface VersionCandidate {
  id: string
  major: number
  minor: number
  status: VersionStatus
}

export interface ResolvedVersion<
  T extends VersionCandidate = VersionCandidate
> {
  version: T
  /** The version is deprecated: it still runs, with a `Deprecation` header. */
  deprecated: boolean
  /** A bare slug picked it: the caller gets a `Warning` header (pin `slug@<major>`). */
  floating: boolean
}

/**
 * Statuses a ref may resolve to. An allowlist, not "anything but a draft", so
 * a status added later is unresolvable until someone decides otherwise.
 */
const RELEASED: ReadonlySet<VersionStatus> = new Set<VersionStatus>([
  'published',
  'deprecated',
  'model_unavailable'
])

const highest = <T extends VersionNumber>(
  versions: readonly T[]
): T | undefined =>
  versions.reduce<T | undefined>(
    (best, version) =>
      best === undefined || compareVersions(version, best) > 0 ? version : best,
    undefined
  )

/**
 * Picks the version a parsed ref points to (drafts, or any status not in
 * {@link RELEASED}, never qualify):
 * - `M.m`: exactly that version, even deprecated or `model_unavailable`
 *   (the caller refuses to run the latter with a clear error).
 * - `M`: the highest published `M.x`; if none, the highest deprecated one;
 *   never a `model_unavailable` one.
 * - bare: the highest published version overall (`floating`).
 * `null` when nothing qualifies, or for a `minor` without a `major`.
 * Generic so callers get their own rows back.
 */
export function resolveRef<T extends VersionCandidate>(
  versions: readonly T[],
  ref: { major?: number; minor?: number }
): ResolvedVersion<T> | null {
  const released = versions.filter(version => RELEASED.has(version.status))
  const withStatus = (candidates: readonly T[], status: VersionStatus) =>
    candidates.filter(version => version.status === status)

  if (ref.major === undefined) {
    if (ref.minor !== undefined) return null
    const latest = highest(withStatus(released, 'published'))
    return latest
      ? { version: latest, deprecated: false, floating: true }
      : null
  }

  const inMajor = released.filter(version => version.major === ref.major)
  if (ref.minor !== undefined) {
    const exact = inMajor.find(version => version.minor === ref.minor)
    return exact
      ? {
          version: exact,
          deprecated: exact.status === 'deprecated',
          floating: false
        }
      : null
  }

  const published = highest(withStatus(inMajor, 'published'))
  if (published)
    return { version: published, deprecated: false, floating: false }
  const deprecated = highest(withStatus(inMajor, 'deprecated'))
  return deprecated
    ? { version: deprecated, deprecated: true, floating: false }
    : null
}
