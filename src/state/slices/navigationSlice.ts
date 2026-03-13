import type { StateCreator } from 'zustand'
import type { GameStore } from '@/state/types'

const SHIP_CENTER_PIVOT: [number, number, number] = [0, 0, 0]

function sanitizePivot(position: [number, number, number]): [number, number, number] {
  const [x, y, z] = position
  return [
    Number.isFinite(x) ? x : SHIP_CENTER_PIVOT[0],
    Number.isFinite(y) ? y : SHIP_CENTER_PIVOT[1],
    Number.isFinite(z) ? z : SHIP_CENTER_PIVOT[2],
  ]
}

export const createNavigationSlice: StateCreator<GameStore, [], [], Partial<GameStore>> = (set) => ({
  currentCelestialId: 'planet-1',
  debugPivotEnabled: false,
  showIRSTCone: false,
  debugPivotPosition: SHIP_CENTER_PIVOT,
  debugPivotDragging: false,
  debugPivotResetCount: 0,
  warpState: 'idle',
  warpTargetId: null,
  selectedTargetId: null,
  gridObjects: [],
  asteroidBeltThickness: 2600,
  asteroidBeltJitter: 420,
  asteroidBeltDensity: 2.4,
  asteroidBeltArcLength: 180,
  asteroidBeltRadius: 18000,
  asteroidBeltMinSize: 26,
  asteroidBeltMaxSize: 140,
  asteroidBeltSpawnNonce: 0,
  setCurrentCelestial: (id) => set({ currentCelestialId: id }),
  setDebugPivotEnabled: (enabled) => set({ debugPivotEnabled: enabled }),
  setShowIRSTCone: (enabled) => set({ showIRSTCone: enabled }),
  setDebugPivotPosition: (position) => set({ debugPivotPosition: sanitizePivot(position) }),
  setDebugPivotDragging: (dragging) => set({ debugPivotDragging: dragging }),
  resetDebugPivot: () =>
    set((s) => ({
      debugPivotPosition: [...SHIP_CENTER_PIVOT] as [number, number, number],
      debugPivotResetCount: s.debugPivotResetCount + 1,
    })),
  setWarpState: (state, targetId = null) =>
    set({ warpState: state, warpTargetId: targetId ?? null }),
  setSelectedTarget: (id) => set({ selectedTargetId: id }),
  setGridObjects: (objects) => set({ gridObjects: objects }),
  setAsteroidBeltSettings: (partial) =>
    set((s) => {
      let nextMinSize =
        partial.sizeMin === undefined
          ? s.asteroidBeltMinSize
          : Math.max(4, Math.min(400, partial.sizeMin))
      let nextMaxSize =
        partial.sizeMax === undefined
          ? s.asteroidBeltMaxSize
          : Math.max(6, Math.min(500, partial.sizeMax))

      if (nextMinSize > nextMaxSize) {
        if (partial.sizeMin !== undefined && partial.sizeMax === undefined) {
          nextMaxSize = nextMinSize
        } else if (partial.sizeMax !== undefined && partial.sizeMin === undefined) {
          nextMinSize = nextMaxSize
        } else {
          const swap = nextMinSize
          nextMinSize = nextMaxSize
          nextMaxSize = swap
        }
      }

      return {
        asteroidBeltThickness:
          partial.thickness === undefined ? s.asteroidBeltThickness : Math.max(50, Math.min(2500, partial.thickness)),
        asteroidBeltJitter:
          partial.jitter === undefined ? s.asteroidBeltJitter : Math.max(0, Math.min(3000, partial.jitter)),
        asteroidBeltDensity:
          partial.density === undefined ? s.asteroidBeltDensity : Math.max(0.1, Math.min(12, partial.density)),
        asteroidBeltArcLength:
          partial.arcLength === undefined ? s.asteroidBeltArcLength : Math.max(20, Math.min(360, partial.arcLength)),
        asteroidBeltRadius:
          partial.radius === undefined ? s.asteroidBeltRadius : Math.max(2000, Math.min(80000, partial.radius)),
        asteroidBeltMinSize: nextMinSize,
        asteroidBeltMaxSize: nextMaxSize,
      }
    }),
  spawnAsteroidBelt: () =>
    set((s) => ({
      asteroidBeltSpawnNonce: s.asteroidBeltSpawnNonce + 1,
    })),
  startWarp: (targetCelestialId) =>
    set({ warpState: 'aligning', warpTargetId: targetCelestialId }),
  finishWarp: () =>
    set((s) => ({
      currentCelestialId: s.warpTargetId ?? s.currentCelestialId,
      warpState: 'idle',
      warpTargetId: null,
    })),
})
