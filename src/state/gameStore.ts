import { create } from 'zustand'
import { createEnemySlice } from '@/state/slices/enemySlice'
import { createEwSlice } from '@/state/slices/ewSlice'
import { createNavigationSlice } from '@/state/slices/navigationSlice'
import { createShipSlice } from '@/state/slices/shipSlice'
import type { EnemyRadarMode, EnemyState, GameStore, ShipState } from '@/state/types'

export type { EnemyRadarMode, EnemyState, ShipState }

export const useGameStore = create<GameStore>((set, _get, storeApi) => ({
  ...createNavigationSlice(set, _get, storeApi),
  ...createShipSlice(set, _get, storeApi),
  ...createEnemySlice(set, _get, storeApi),
  ...createEwSlice(set, _get, storeApi),
}) as GameStore)
