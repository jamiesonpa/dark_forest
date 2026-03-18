import { create } from 'zustand'
import { createEwSlice } from '@/state/slices/ewSlice'
import { createNavigationSlice } from '@/state/slices/navigationSlice'
import { createNpcSlice } from '@/state/slices/npcSlice'
import { createShipSlice } from '@/state/slices/shipSlice'
import type { GameStore, NpcShipConfig, ShipState } from '@/state/types'

export type { NpcShipConfig, ShipState }

export const useGameStore = create<GameStore>((set, _get, storeApi) => ({
  ...createNavigationSlice(set, _get, storeApi),
  ...createShipSlice(set, _get, storeApi),
  ...createNpcSlice(set, _get, storeApi),
  ...createEwSlice(set, _get, storeApi),
}) as GameStore)
