import type { GameStore } from '@/state/types'

const OFFLINE_LOCAL_PLAYER_ID = 'local-player'

export const selectLocalShip = (state: GameStore) => state.ship
export const selectLocalPlayerId = (state: GameStore) => state.localPlayerId
export const selectWarpState = (state: GameStore) => state.warpState
export const selectNavAttitudeMode = (state: GameStore) => state.navAttitudeMode
export const selectDebugPivotEnabled = (state: GameStore) => state.debugPivotEnabled
export const selectDebugPivotPosition = (state: GameStore) => state.debugPivotPosition
export const selectDebugPivotDragging = (state: GameStore) => state.debugPivotDragging
export const selectStarSystemSeed = (state: GameStore) => state.starSystemSeed
export const selectStarSystemConfig = (state: GameStore) => state.starSystemConfig

export function getEffectiveLocalPlayerId(state: GameStore) {
  return state.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
}

export function getEffectiveLocalShip(state: GameStore) {
  const localId = getEffectiveLocalPlayerId(state)
  return state.shipsById[localId] ?? state.ship
}
