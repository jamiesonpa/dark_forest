import type { StateCreator } from 'zustand'
import { defaultEnemyState } from '@/state/defaults'
import type { GameStore } from '@/state/types'

export const createEnemySlice: StateCreator<GameStore, [], [], Partial<GameStore>> = (set) => ({
  enemy: defaultEnemyState,
  setEnemyState: (partial) =>
    set((s) => ({ enemy: { ...s.enemy, ...partial } })),
})
