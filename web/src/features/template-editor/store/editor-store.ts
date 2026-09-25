import { createStore } from 'zustand/vanilla'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import type { DraftWithEtag } from '#/sdk/modules/templates/types'
import type { StructureIssue } from '../schemas/definition'
import { jsonEqual } from '../utils/equal'

/**
 * State of one editor session: the draft as the server last had it (`base`,
 * with its ETag) and the local copy being edited (`definition`). Unsaved =
 * the two differ. One store per mounted editor page (see
 * `EditorStoreProvider`).
 */
export interface EditorState {
  /** The draft as last loaded or saved (lint, changes and ETag included). */
  base: DraftWithEtag | null
  /** The local, possibly unsaved, definition. */
  definition: TemplateDefinition | null
  /**
   * The server has a newer draft than `base` (seen on a refetch while there
   * were unsaved changes); its ETag.
   */
  remoteEtag: string | null
  /** Sub-editors (raw JSON) whose text can't be applied yet: key → what it edits. */
  invalid: Record<string, string>
  /** Side forms with unsaved changes (template settings): key → what. */
  pending: Record<string, string>
  /** Issues of the last save the API refused (422), relative to the definition. */
  serverIssues: StructureIssue[]
  /** The last "show me this" request from the lint panel. */
  focus: { path: string; nonce: number } | null

  /** Replaces everything with `draft` (initial load, reload, discard). */
  load: (draft: DraftWithEtag) => void
  /**
   * A (re)fetched draft: loaded when there's nothing unsaved; otherwise kept
   * aside as `remoteEtag` so the page can offer to reload.
   */
  receive: (draft: DraftWithEtag) => void
  /** A successful save of `draft`; local edits made meanwhile are kept. */
  saved: (draft: DraftWithEtag) => void
  /**
   * Takes `draft` as the new base but keeps the local edits (to overwrite a
   * conflicting draft with them on the next save).
   */
  rebase: (draft: DraftWithEtag) => void
  update: (
    recipe: (definition: TemplateDefinition) => TemplateDefinition
  ) => void
  /** Drops the unsaved changes (back to `base`). */
  discard: () => void
  setInvalid: (key: string, label: string | null) => void
  setPending: (key: string, label: string | null) => void
  setServerIssues: (issues: StructureIssue[]) => void
  requestFocus: (path: string) => void
}

const withKey = (
  record: Record<string, string>,
  key: string,
  label: string | null
): Record<string, string> => {
  if (label === null) {
    if (!(key in record)) return record
    const { [key]: _, ...rest } = record
    return rest
  }
  return record[key] === label ? record : { ...record, [key]: label }
}

export const selectIsDirty = (state: EditorState): boolean =>
  state.base !== null &&
  state.definition !== null &&
  !jsonEqual(state.definition, state.base.draft.definition)

/** Unsaved work of any kind: the definition, or a side form. */
export const selectHasUnsavedWork = (state: EditorState): boolean =>
  selectIsDirty(state) ||
  Object.keys(state.pending).length > 0 ||
  Object.keys(state.invalid).length > 0

export function createEditorStore() {
  return createStore<EditorState>()((set, get) => ({
    base: null,
    definition: null,
    remoteEtag: null,
    invalid: {},
    pending: {},
    serverIssues: [],
    focus: null,

    load: draft =>
      set({
        base: draft,
        definition: draft.draft.definition,
        remoteEtag: null,
        invalid: {},
        serverIssues: []
      }),

    receive: draft => {
      const state = get()
      if (state.base?.etag === draft.etag) {
        if (state.remoteEtag !== null) set({ remoteEtag: null })
        return
      }
      const busy = selectIsDirty(state) || Object.keys(state.invalid).length > 0
      if (state.base === null || !busy) {
        state.load(draft)
        return
      }
      set({ remoteEtag: draft.etag })
    },

    saved: draft => set({ base: draft, remoteEtag: null, serverIssues: [] }),

    rebase: draft => set({ base: draft, remoteEtag: null }),

    update: recipe => {
      const { definition } = get()
      if (!definition) return
      const next = recipe(definition)
      if (next !== definition) set({ definition: next })
    },

    discard: () => {
      const { base } = get()
      if (base) set({ definition: base.draft.definition, invalid: {} })
    },

    setInvalid: (key, label) =>
      set(state => {
        const invalid = withKey(state.invalid, key, label)
        return invalid === state.invalid ? state : { invalid }
      }),

    setPending: (key, label) =>
      set(state => {
        const pending = withKey(state.pending, key, label)
        return pending === state.pending ? state : { pending }
      }),

    setServerIssues: serverIssues => set({ serverIssues }),

    requestFocus: path =>
      set(state => ({ focus: { path, nonce: (state.focus?.nonce ?? 0) + 1 } }))
  }))
}

export type EditorStore = ReturnType<typeof createEditorStore>
