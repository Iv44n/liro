import { create } from 'zustand'
import { DEFAULT_RUN_FILTERS, type RunFilters } from '../utils/filters'

/**
 * The runs explorer's filters, kept in memory so they survive opening a run
 * and coming back. They belong to one organization: switching resets them.
 */
type RunsFiltersStore = {
  organizationId: string | null
  filters: RunFilters
  setFilters: (
    organizationId: string | null,
    patch: Partial<RunFilters>
  ) => void
  reset: (organizationId: string | null) => void
}

export const useRunsFiltersStore = create<RunsFiltersStore>(set => ({
  organizationId: null,
  filters: DEFAULT_RUN_FILTERS,
  setFilters: (organizationId, patch) =>
    set(state => ({
      organizationId,
      filters: {
        ...(state.organizationId === organizationId
          ? state.filters
          : DEFAULT_RUN_FILTERS),
        ...patch
      }
    })),
  reset: organizationId => set({ organizationId, filters: DEFAULT_RUN_FILTERS })
}))

/** The filters for `organizationId` (the defaults if they were another org's). */
export function useRunsFilters(organizationId: string | null) {
  const stored = useRunsFiltersStore(state =>
    state.organizationId === organizationId ? state.filters : null
  )
  const setFilters = useRunsFiltersStore(state => state.setFilters)
  const reset = useRunsFiltersStore(state => state.reset)

  return {
    filters: stored ?? DEFAULT_RUN_FILTERS,
    setFilters: (patch: Partial<RunFilters>) =>
      setFilters(organizationId, patch),
    reset: () => reset(organizationId)
  }
}
