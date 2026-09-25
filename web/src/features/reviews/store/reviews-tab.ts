import { create } from 'zustand'
import type { ReviewTab } from '../utils/labels'

/** The inbox's selected tab, kept while opening a review and coming back. */
type ReviewsTabStore = {
  tab: ReviewTab
  setTab: (tab: ReviewTab) => void
}

export const useReviewsTab = create<ReviewsTabStore>(set => ({
  tab: 'pending',
  setTab: tab => set({ tab })
}))
