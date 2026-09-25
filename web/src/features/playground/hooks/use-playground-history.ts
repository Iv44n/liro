import { create } from 'zustand'
import {
  createJSONStorage,
  persist,
  type StateStorage
} from 'zustand/middleware'
import type { JsonObject } from '#/features/templates/types/definition'
import type { PlaygroundTestResponse } from '#/sdk/modules/templates/types'
import type { AnswerView, StageView } from '../utils/format'

/**
 * The last test runs of each template, kept for the browser session
 * (`sessionStorage`: closing the tab forgets them, inputs included). Each
 * entry stores what it needs to be shown again, even after the definition
 * changes: the response plus the stage and answers derived from the
 * definition that ran.
 */

export const PLAYGROUND_HISTORY_LIMIT = 5

export interface PlaygroundHistoryEntry {
  /** The run id. */
  id: string
  /** ISO time the test finished. */
  at: string
  input: JsonObject
  response: PlaygroundTestResponse
  stage: StageView
  answers: AnswerView[]
}

interface PlaygroundHistoryState {
  /** Template id → newest first, at most `PLAYGROUND_HISTORY_LIMIT`. */
  entries: Record<string, PlaygroundHistoryEntry[]>
  add: (templateId: string, entry: PlaygroundHistoryEntry) => void
  clear: (templateId: string) => void
}

/** Adds `entry` first, dropping an older copy of it and the overflow. */
export function prependEntry(
  entries: readonly PlaygroundHistoryEntry[],
  entry: PlaygroundHistoryEntry,
  limit = PLAYGROUND_HISTORY_LIMIT
): PlaygroundHistoryEntry[] {
  return [entry, ...entries.filter(existing => existing.id !== entry.id)].slice(
    0,
    limit
  )
}

/** `sessionStorage` that never throws (private mode, quota, no `window`). */
const safeSessionStorage: StateStorage = {
  getItem: name => {
    try {
      return sessionStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      sessionStorage.setItem(name, value)
    } catch {
      // Too large or unavailable: the history just isn't kept.
    }
  },
  removeItem: name => {
    try {
      sessionStorage.removeItem(name)
    } catch {
      // Unavailable.
    }
  }
}

export const usePlaygroundHistoryStore = create<PlaygroundHistoryState>()(
  persist(
    set => ({
      entries: {},
      add: (templateId, entry) =>
        set(state => ({
          entries: {
            ...state.entries,
            [templateId]: prependEntry(state.entries[templateId] ?? [], entry)
          }
        })),
      clear: templateId =>
        set(state => {
          const { [templateId]: _removed, ...rest } = state.entries
          return { entries: rest }
        })
    }),
    {
      name: 'liro.playground.history',
      version: 1,
      storage: createJSONStorage(() => safeSessionStorage),
      partialize: state => ({ entries: state.entries })
    }
  )
)

const EMPTY: PlaygroundHistoryEntry[] = []

/** The template's recent test runs (newest first) and the store's actions. */
export function usePlaygroundHistory(templateId: string) {
  const entries = usePlaygroundHistoryStore(
    state => state.entries[templateId] ?? EMPTY
  )
  const add = usePlaygroundHistoryStore(state => state.add)
  const clear = usePlaygroundHistoryStore(state => state.clear)

  return {
    entries,
    add: (entry: PlaygroundHistoryEntry) => add(templateId, entry),
    clear: () => clear(templateId)
  }
}
