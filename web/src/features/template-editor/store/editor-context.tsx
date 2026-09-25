import { createContext, type ReactNode, useContext, useState } from 'react'
import { useStore } from 'zustand'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import type { DraftWithEtag, TemplateView } from '#/sdk/modules/templates/types'
import {
  createEditorStore,
  type EditorState,
  type EditorStore
} from './editor-store'

const StoreContext = createContext<EditorStore | null>(null)

/**
 * A fresh editor store for the subtree (one per mounted editor page — key it
 * by `templateId` where it's rendered, so switching templates starts a new
 * one). `initialDraft` is loaded synchronously, so the first render already
 * has a definition; later updates go through `receive` (see `DraftSync`).
 */
export function EditorStoreProvider({
  initialDraft,
  children
}: {
  initialDraft: DraftWithEtag
  children: ReactNode
}) {
  const [store] = useState(() => {
    const created = createEditorStore()
    created.getState().load(initialDraft)
    return created
  })
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useEditorStoreApi(): EditorStore {
  const store = useContext(StoreContext)
  if (!store) {
    throw new Error('useEditorStore must be used inside <EditorStoreProvider>')
  }
  return store
}

/** Subscribes to a slice of the editor state. */
export function useEditorStore<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorStoreApi(), selector)
}

/**
 * The local definition. Tabs only render once the draft is loaded, so it is
 * never `null` inside them.
 */
export function useDefinition(): TemplateDefinition {
  const definition = useEditorStore(state => state.definition)
  if (!definition) throw new Error('The draft is not loaded yet')
  return definition
}

/** `update` of the store: applies an immutable recipe to the local definition. */
export const useUpdateDefinition = () => useEditorStore(state => state.update)

export interface EditorContextValue {
  templateId: string
  template: TemplateView
  /** The role can't edit the draft: every control is disabled. */
  readOnly: boolean
}

const EditorContext = createContext<EditorContextValue | null>(null)

export const EditorContextProvider = EditorContext.Provider

export function useEditorContext(): EditorContextValue {
  const value = useContext(EditorContext)
  if (!value) {
    throw new Error('useEditorContext must be used inside the template editor')
  }
  return value
}
