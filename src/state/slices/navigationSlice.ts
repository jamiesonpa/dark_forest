import type { StateCreator } from 'zustand'
import type { GameStore } from '@/state/types'
import { DEFAULT_STAR_SYSTEM_SNAPSHOT, getCelestialById } from '@/utils/systemData'
import {
  getWarpCapacitorRequiredAmount,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'

const SHIP_CENTER_PIVOT: [number, number, number] = [0, 0, 0]
const OFFLINE_LOCAL_PLAYER_ID = 'local-player'
const WARP_MIN_POST_CAPACITOR = 1
const WARP_ARRIVAL_MIN_DISTANCE_KM = 15
const WARP_ARRIVAL_MAX_DISTANCE_KM = 50
const WARP_ARRIVAL_STEP_KM = 5

function mergeKnownCelestialId(existingIds: string[], celestialId: string, starSystem = DEFAULT_STAR_SYSTEM_SNAPSHOT.system) {
  const celestial = getCelestialById(celestialId, starSystem)
  if (!celestial || celestial.type === 'star' || existingIds.includes(celestialId)) {
    return existingIds
  }
  return [...existingIds, celestialId]
}

function sanitizePivot(position: [number, number, number]): [number, number, number] {
  const [x, y, z] = position
  return [
    Number.isFinite(x) ? x : SHIP_CENTER_PIVOT[0],
    Number.isFinite(y) ? y : SHIP_CENTER_PIVOT[1],
    Number.isFinite(z) ? z : SHIP_CENTER_PIVOT[2],
  ]
}

function sanitizeWarpArrivalDistanceKm(distanceKm: number) {
  if (!Number.isFinite(distanceKm)) {
    return WARP_ARRIVAL_MIN_DISTANCE_KM
  }
  const clamped = Math.max(
    WARP_ARRIVAL_MIN_DISTANCE_KM,
    Math.min(WARP_ARRIVAL_MAX_DISTANCE_KM, distanceKm)
  )
  return Math.round(clamped / WARP_ARRIVAL_STEP_KM) * WARP_ARRIVAL_STEP_KM
}

export const createNavigationSlice: StateCreator<GameStore, [], [], Partial<GameStore>> = (set) => ({
  starSystem: DEFAULT_STAR_SYSTEM_SNAPSHOT.system,
  starSystemSeed: DEFAULT_STAR_SYSTEM_SNAPSHOT.seed,
  starSystemConfig: DEFAULT_STAR_SYSTEM_SNAPSHOT.config,
  currentCelestialId: 'planet-1',
  debugPivotEnabled: false,
  orientDebugEnabled: false,
  showIRSTCone: false,
  showCelestialGridCenterMarker: false,
  debugPivotPosition: SHIP_CENTER_PIVOT,
  debugPivotDragging: false,
  debugPivotResetCount: 0,
  warpState: 'idle',
  warpTargetId: null,
  selectedTargetId: null,
  selectedWarpDestinationId: null,
  warpArrivalDistanceKm: WARP_ARRIVAL_MIN_DISTANCE_KM,
  warpSourceCelestialId: null,
  warpTravelProgress: 0,
  warpReferenceSpeed: 0,
  warpRequiredBearing: 0,
  warpRequiredInclination: 0,
  warpAlignmentErrorDeg: Number.POSITIVE_INFINITY,
  warpAligned: false,
  navAttitudeMode: 'AA',
  gridObjects: [],
  asteroidBeltThickness: 2600,
  asteroidBeltJitter: 420,
  asteroidBeltDensity: 2.4,
  asteroidBeltArcLength: 180,
  asteroidBeltRadius: 18000,
  asteroidBeltMinSize: 26,
  asteroidBeltMaxSize: 140,
  asteroidBeltSpawnNonce: 0,
  setStarSystemSnapshot: (snapshot) =>
    set((s) => {
      const warpables = snapshot.system.celestials.filter((c) => c.id !== 'star')
      const fallbackCelestialId = warpables[0]?.id ?? 'star'
      const fallbackDestinationId =
        warpables.find((c) => c.id !== (s.currentCelestialId || fallbackCelestialId))?.id
        ?? fallbackCelestialId
      const currentExists = snapshot.system.celestials.some((c) => c.id === s.currentCelestialId)
      const selectedExists = s.selectedWarpDestinationId
        ? snapshot.system.celestials.some((c) => c.id === s.selectedWarpDestinationId)
        : false
      const sourceExists = s.warpSourceCelestialId
        ? snapshot.system.celestials.some((c) => c.id === s.warpSourceCelestialId)
        : false
      const targetExists = s.warpTargetId
        ? snapshot.system.celestials.some((c) => c.id === s.warpTargetId)
        : false
      const nextCurrentCelestialId = currentExists ? s.currentCelestialId : fallbackCelestialId
      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      const localShip = s.shipsById[localId] ?? s.ship
      const updatedLocalShip = {
        ...localShip,
        currentCelestialId: nextCurrentCelestialId,
      }

      return {
        starSystem: snapshot.system,
        starSystemSeed: snapshot.seed,
        starSystemConfig: snapshot.config,
        currentCelestialId: nextCurrentCelestialId,
        ewRevealedCelestialIds: mergeKnownCelestialId(
          s.ewRevealedCelestialIds,
          nextCurrentCelestialId,
          snapshot.system
        ),
        selectedWarpDestinationId: selectedExists ? s.selectedWarpDestinationId : fallbackDestinationId,
        warpSourceCelestialId: sourceExists ? s.warpSourceCelestialId : null,
        warpTargetId: targetExists ? s.warpTargetId : null,
        ship: updatedLocalShip,
        shipsById: {
          ...s.shipsById,
          [localId]: updatedLocalShip,
        },
      }
    }),
  setCurrentCelestial: (id) =>
    set((s) => {
      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      const localShip = s.shipsById[localId] ?? s.ship
      const updatedLocalShip = {
        ...localShip,
        currentCelestialId: id,
      }

      return {
        currentCelestialId: id,
        ewRevealedCelestialIds: mergeKnownCelestialId(s.ewRevealedCelestialIds, id, s.starSystem),
        ship: updatedLocalShip,
        shipsById: {
          ...s.shipsById,
          [localId]: updatedLocalShip,
        },
      }
    }),
  setDebugPivotEnabled: (enabled) => set({ debugPivotEnabled: enabled }),
  setOrientDebugEnabled: (enabled) => set({ orientDebugEnabled: enabled }),
  setShowIRSTCone: (enabled) => set({ showIRSTCone: enabled }),
  setShowCelestialGridCenterMarker: (enabled) => set({ showCelestialGridCenterMarker: enabled }),
  setDebugPivotPosition: (position) => set({ debugPivotPosition: sanitizePivot(position) }),
  setDebugPivotDragging: (dragging) => set({ debugPivotDragging: dragging }),
  resetDebugPivot: () =>
    set((s) => ({
      debugPivotPosition: [...SHIP_CENTER_PIVOT] as [number, number, number],
      debugPivotResetCount: s.debugPivotResetCount + 1,
    })),
  setWarpState: (state, targetId = null) =>
    set((s) => ({
      warpState: state,
      warpTargetId: targetId ?? null,
      warpTravelProgress: state === 'warping' ? s.warpTravelProgress : state === 'idle' ? 0 : s.warpTravelProgress,
      warpReferenceSpeed: state === 'idle' ? 0 : s.warpReferenceSpeed,
    })),
  setSelectedTarget: (id) => set({ selectedTargetId: id }),
  setSelectedWarpDestination: (id) => set({ selectedWarpDestinationId: id }),
  setWarpArrivalDistanceKm: (distanceKm) =>
    set({ warpArrivalDistanceKm: sanitizeWarpArrivalDistanceKm(distanceKm) }),
  setWarpAlignmentStatus: (payload) =>
    set({
      warpRequiredBearing: payload.requiredBearing,
      warpRequiredInclination: payload.requiredInclination,
      warpAlignmentErrorDeg: payload.totalErrorDeg,
      warpAligned: payload.aligned,
    }),
  setWarpTravelProgress: (progress) =>
    set({ warpTravelProgress: Math.max(0, Math.min(1, progress)) }),
  setWarpReferenceSpeed: (speed) =>
    set({ warpReferenceSpeed: Math.max(0, speed) }),
  setNavAttitudeMode: (mode) =>
    set({ navAttitudeMode: mode }),
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
    set((s) => {
      if (s.warpState !== 'idle' || !s.warpAligned) return {}
      const sourceCelestial = getCelestialById(s.currentCelestialId, s.starSystem)
      const destinationCelestial = getCelestialById(targetCelestialId, s.starSystem)
      if (!sourceCelestial || !destinationCelestial || sourceCelestial.id === destinationCelestial.id) {
        return {}
      }

      const sourceWorld = worldPositionForCelestial(sourceCelestial)
      const destinationWorld = worldPositionForCelestial(destinationCelestial)
      const distanceWorldUnits = vectorMagnitude(vectorBetweenWorldPoints(sourceWorld, destinationWorld))
      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      const localShip = s.shipsById[localId] ?? s.ship
      const requiredCapacitor = getWarpCapacitorRequiredAmount(distanceWorldUnits, localShip.capacitorMax)
      if (localShip.capacitor - requiredCapacitor < WARP_MIN_POST_CAPACITOR) return {}

      const updatedLocalShip = {
        ...localShip,
        capacitor: Math.max(0, localShip.capacitor - requiredCapacitor),
      }

      return {
        warpState: 'aligning',
        warpTargetId: targetCelestialId,
        warpSourceCelestialId: s.currentCelestialId,
        selectedWarpDestinationId: targetCelestialId,
        warpTravelProgress: 0,
        warpReferenceSpeed: 0,
        ship: updatedLocalShip,
        shipsById: {
          ...s.shipsById,
          [localId]: updatedLocalShip,
        },
      }
    }),
  finishWarp: () =>
    set((s) => {
      const nextCurrentCelestialId = s.warpTargetId ?? s.currentCelestialId
      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      const localShip = s.shipsById[localId] ?? s.ship
      const updatedLocalShip = {
        ...localShip,
        currentCelestialId: nextCurrentCelestialId,
      }
      return {
        selectedWarpDestinationId: s.warpSourceCelestialId ?? s.selectedWarpDestinationId,
        currentCelestialId: nextCurrentCelestialId,
        ewRevealedCelestialIds: mergeKnownCelestialId(s.ewRevealedCelestialIds, nextCurrentCelestialId, s.starSystem),
        warpState: 'idle',
        warpSourceCelestialId: null,
        warpTravelProgress: 0,
        warpReferenceSpeed: 0,
        warpTargetId: null,
        ship: updatedLocalShip,
        shipsById: {
          ...s.shipsById,
          [localId]: updatedLocalShip,
        },
      }
    }),
})
