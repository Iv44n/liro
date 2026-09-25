/**
 * Tabs of the template editor (`/decisions/$templateId?tab=…`). Shared by the
 * route (search param validation) and the editor page.
 */
export const EDITOR_TABS = [
  'input',
  'questions',
  'decisions',
  'policy',
  'effects',
  'versions',
  'integrate'
] as const

export type EditorTab = (typeof EDITOR_TABS)[number]

export const DEFAULT_EDITOR_TAB: EditorTab = 'questions'

export const isEditorTab = (value: unknown): value is EditorTab =>
  typeof value === 'string' &&
  (EDITOR_TABS as readonly string[]).includes(value)

/** The tab a raw `tab` search param selects (the default when unknown). */
export const parseEditorTab = (value: unknown): EditorTab =>
  isEditorTab(value) ? value : DEFAULT_EDITOR_TAB
