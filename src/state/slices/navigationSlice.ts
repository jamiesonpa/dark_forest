import type { StateCreator } from 'zustand'
import type { GameStore } from '@/state/types'
import { DEFAULT_STAR_SYSTEM_SNAPSHOT, getCelestialById } from '@/utils/systemData'
import {
  getWarpCapacitorRequiredAmount,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'
import { TORPEDO_ACCEL_DURATION_SECONDS } from '@/systems/simulation/torpedoConstants'

const SHIP_CENTER_PIVOT: [number, number, number] = [0, 0, 0]
const DEFAULT_SHIP_TARGET_SPAWN_POSITION: [number, number, number] = [0, 0, -20000]
const OFFLINE_LOCAL_PLAYER_ID = 'local-player'
const WARP_MIN_POST_CAPACITOR = 1
const WARP_ARRIVAL_MIN_DISTANCE_KM = 15
const WARP_ARRIVAL_MAX_DISTANCE_KM = 50
const WARP_ARRIVAL_STEP_KM = 5
const FALLBACK_PLAYER_SHIP_BOUNDING_LENGTH = 600
const LAUNCHED_CYLINDER_SCALE = 0.5
const TORPEDO_THRUST_ACCELERATION = 130
const TORPEDO_NAVIGATION_CONSTANT = 4
const TORPEDO_MAX_LATERAL_ACCELERATION = 220
const TORPEDO_MIN_TARGET_RANGE = 1
const FLARE_EJECTION_SPEED = 1680
const FLARE_LIFETIME_SECONDS = 3
const FLARE_VELOCITY_DECAY_RATE = 0.8
const FLARE_ANGLE_RANDOM_JITTER_DEG = 5
const FLARE_SPREAD_DEGREES = [0, -20, 20, -40, 40] as const
const DEFAULT_SHIP_TARGET_HEADING_DEG = 0
const DEFAULT_SHIP_TARGET_INCLINATION_DEG = 0
const DEFAULT_SHIP_TARGET_SPEED = 0

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

function sanitizeShipTargetSpawnPosition(position: [number, number, number]): [number, number, number] {
  const [x, y, z] = position
  return [
    Number.isFinite(x) ? x : DEFAULT_SHIP_TARGET_SPAWN_POSITION[0],
    Number.isFinite(y) ? y : DEFAULT_SHIP_TARGET_SPAWN_POSITION[1],
    Number.isFinite(z) ? z : DEFAULT_SHIP_TARGET_SPAWN_POSITION[2],
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

function normalizeHeadingDeg(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_SHIP_TARGET_HEADING_DEG
  return ((value % 360) + 360) % 360
}

function clampInclinationDeg(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_SHIP_TARGET_INCLINATION_DEG
  return Math.max(-90, Math.min(90, value))
}

function clampTargetSpeed(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_SHIP_TARGET_SPEED
  return Math.max(0, value)
}

function hasRadarLock(lockState: Record<string, 'soft' | 'hard'>) {
  return Object.values(lockState).some((state) => state === 'hard' || state === 'soft')
}

function getPreferredRadarLockId(lockState: Record<string, 'soft' | 'hard'>): string | null {
  const hardLockId = Object.keys(lockState).find((id) => lockState[id] === 'hard')
  if (hardLockId) return hardLockId
  return Object.keys(lockState).find((id) => lockState[id] === 'soft') ?? null
}

function getShipForwardVector(headingDeg: number, inclinationDeg: number): [number, number, number] {
  const headingRad = (headingDeg * Math.PI) / 180
  const inclinationRad = (inclinationDeg * Math.PI) / 180
  const cosInclination = Math.cos(inclinationRad)
  return [
    -Math.sin(headingRad) * cosInclination,
    Math.sin(inclinationRad),
    Math.cos(headingRad) * cosInclination,
  ]
}

function normalizeVector(vector: [number, number, number], fallback: [number, number, number]): [number, number, number] {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2])
  if (magnitude <= 0.000001) {
    return [...fallback]
  }
  return [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude]
}

function crossProduct(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function rotateVectorAroundAxis(
  vector: [number, number, number],
  axis: [number, number, number],
  angleDeg: number
): [number, number, number] {
  const axisNormalized = normalizeVector(axis, [0, 1, 0])
  const angleRad = (angleDeg * Math.PI) / 180
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const dot =
    vector[0] * axisNormalized[0] + vector[1] * axisNormalized[1] + vector[2] * axisNormalized[2]
  const cross = crossProduct(axisNormalized, vector)

  return [
    vector[0] * cos + cross[0] * sin + axisNormalized[0] * dot * (1 - cos),
    vector[1] * cos + cross[1] * sin + axisNormalized[1] * dot * (1 - cos),
    vector[2] * cos + cross[2] * sin + axisNormalized[2] * dot * (1 - cos),
  ]
}

function resolveLockTargetPosition(
  state: GameStore,
  lockId: string | null
): [number, number, number] | null {
  if (!lockId) return null
  if (lockId === 'Σ' || lockId === 'M') {
    return [
      state.enemy.position[0],
      state.enemy.position[1],
      state.enemy.position[2],
    ]
  }
  if (lockId.startsWith('TGT-')) {
    const targetId = lockId.slice(4)
    const target = state.shipTargets.find((candidate) => candidate.id === targetId)
    if (!target) return null
    return [target.position[0], target.position[1], target.position[2]]
  }
  return null
}

function resolveLockTargetVelocity(
  state: GameStore,
  lockId: string | null
): [number, number, number] | null {
  if (!lockId) return null
  if (lockId === 'Σ' || lockId === 'M') {
    const headingRad = (state.enemy.heading * Math.PI) / 180
    const speed = Math.max(0, state.enemy.speed)
    return [
      -Math.sin(headingRad) * speed,
      0,
      -Math.cos(headingRad) * speed,
    ]
  }
  if (lockId.startsWith('TGT-')) {
    const speed = clampTargetSpeed(state.shipTargetSpeed)
    const [vx, vy, vz] = getShipForwardVector(
      normalizeHeadingDeg(state.shipTargetHeadingDeg),
      clampInclinationDeg(state.shipTargetInclinationDeg)
    )
    return [vx * speed, vy * speed, vz * speed]
  }
  return null
}

export const createNavigationSlice: StateCreator<GameStore, [], [], Partial<GameStore>> = (set) => ({
  starSystem: DEFAULT_STAR_SYSTEM_SNAPSHOT.system,
  starSystemSeed: DEFAULT_STAR_SYSTEM_SNAPSHOT.seed,
  starSystemConfig: DEFAULT_STAR_SYSTEM_SNAPSHOT.config,
  currentCelestialId: 'planet-1',
  debugPivotEnabled: false,
  orientDebugEnabled: false,
  showIRSTCone: false,
  showBScopeRadarCone: true,
  unlimitAaOrbitZoomOut: false,
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
  asteroidBeltClearNonce: 0,
  shipTargetSpawnPosition: DEFAULT_SHIP_TARGET_SPAWN_POSITION,
  shipTargets: [],
  shipTargetHeadingDeg: DEFAULT_SHIP_TARGET_HEADING_DEG,
  shipTargetInclinationDeg: DEFAULT_SHIP_TARGET_INCLINATION_DEG,
  shipTargetSpeed: DEFAULT_SHIP_TARGET_SPEED,
  playerShipBoundingLength: FALLBACK_PLAYER_SHIP_BOUNDING_LENGTH,
  launchedCylinders: [],
  launchedFlares: [],
  planetTextureRandomizeNonce: 0,
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
  setShowBScopeRadarCone: (enabled) => set({ showBScopeRadarCone: enabled }),
  setUnlimitAaOrbitZoomOut: (enabled) => set({ unlimitAaOrbitZoomOut: enabled }),
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
  clearSpawnedAsteroidBelt: () =>
    set((s) => ({
      asteroidBeltClearNonce: s.asteroidBeltClearNonce + 1,
    })),
  setShipTargetSpawnPosition: (position) =>
    set({ shipTargetSpawnPosition: sanitizeShipTargetSpawnPosition(position) }),
  setShipTargetMotionSettings: (partial) =>
    set((s) => ({
      shipTargetHeadingDeg:
        partial.headingDeg === undefined
          ? s.shipTargetHeadingDeg
          : normalizeHeadingDeg(partial.headingDeg),
      shipTargetInclinationDeg:
        partial.inclinationDeg === undefined
          ? s.shipTargetInclinationDeg
          : clampInclinationDeg(partial.inclinationDeg),
      shipTargetSpeed:
        partial.speed === undefined
          ? s.shipTargetSpeed
          : clampTargetSpeed(partial.speed),
    })),
  spawnShipTarget: () =>
    set((s) => {
      const [x, y, z] = sanitizeShipTargetSpawnPosition(s.shipTargetSpawnPosition)
      const id = `target-${Date.now()}-${Math.floor(Math.random() * 100000)}`
      return {
        shipTargets: [
          ...s.shipTargets,
          {
            id,
            currentCelestialId: s.currentCelestialId,
            position: [x, y, z] as [number, number, number],
          },
        ],
      }
    }),
  advanceShipTargets: (deltaSeconds) =>
    set((s) => {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || s.shipTargets.length === 0) {
        return {}
      }
      const speed = clampTargetSpeed(s.shipTargetSpeed)
      if (speed <= 0.0001) {
        return {}
      }
      const forward = getShipForwardVector(
        normalizeHeadingDeg(s.shipTargetHeadingDeg),
        clampInclinationDeg(s.shipTargetInclinationDeg)
      )
      return {
        shipTargets: s.shipTargets.map((target) => ({
          ...target,
          position: [
            target.position[0] + forward[0] * speed * deltaSeconds,
            target.position[1] + forward[1] * speed * deltaSeconds,
            target.position[2] + forward[2] * speed * deltaSeconds,
          ],
        })),
      }
    }),
  clearShipTargets: () =>
    set({
      shipTargets: [],
      selectedTargetId: null,
    }),
  setPlayerShipBoundingLength: (length) =>
    set({
      playerShipBoundingLength:
        Number.isFinite(length) && length > 1 ? length : FALLBACK_PLAYER_SHIP_BOUNDING_LENGTH,
    }),
  launchLockedCylinder: (shipBoundingLength) =>
    set((s) => {
      if (!hasRadarLock(s.ewLockState)) {
        return {}
      }
      const preferredLockId = getPreferredRadarLockId(s.ewLockState)
      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      const localShip = s.shipsById[localId] ?? s.ship
      const baseLength =
        Number.isFinite(shipBoundingLength) && shipBoundingLength > 1
          ? shipBoundingLength
          : s.playerShipBoundingLength
      const normalizedLength = Math.max(1, baseLength)
      const diameter = (normalizedLength / 20) * LAUNCHED_CYLINDER_SCALE
      const radius = diameter / 2
      const length = diameter * 5
      const forward = getShipForwardVector(localShip.actualHeading, localShip.actualInclination)
      const spawnOffset = normalizedLength * 0.6 + length * 0.5
      const velocityMagnitude = Math.max(0, localShip.actualSpeed)
      const velocity: [number, number, number] = [
        forward[0] * velocityMagnitude,
        forward[1] * velocityMagnitude,
        forward[2] * velocityMagnitude,
      ]
      const id = `launch-${Date.now()}-${Math.floor(Math.random() * 100000)}`
      return {
        launchedCylinders: [
          ...s.launchedCylinders,
          {
            id,
            currentCelestialId: localShip.currentCelestialId,
            position: [
              localShip.position[0] + forward[0] * spawnOffset,
              localShip.position[1] + forward[1] * spawnOffset,
              localShip.position[2] + forward[2] * spawnOffset,
            ],
            velocity,
            radius,
            length,
            direction: forward,
            targetLockId: preferredLockId,
            flightTimeSeconds: 0,
          },
        ],
      }
    }),
  advanceLaunchedCylinders: (deltaSeconds) =>
    set((s) => {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || s.launchedCylinders.length === 0) {
        return {}
      }
      return {
        launchedCylinders: s.launchedCylinders.map((cylinder) => {
          let nextDirection: [number, number, number] = [...cylinder.direction]
          let nextVelocity: [number, number, number] = [...cylinder.velocity]
          const targetPosition = resolveLockTargetPosition(s, cylinder.targetLockId)
          const targetVelocity = resolveLockTargetVelocity(s, cylinder.targetLockId)

          if (targetPosition) {
            const relX = targetPosition[0] - cylinder.position[0]
            const relY = targetPosition[1] - cylinder.position[1]
            const relZ = targetPosition[2] - cylinder.position[2]
            const relMag = Math.hypot(relX, relY, relZ)
            if (relMag > TORPEDO_MIN_TARGET_RANGE) {
              const targetVelX = targetVelocity?.[0] ?? 0
              const targetVelY = targetVelocity?.[1] ?? 0
              const targetVelZ = targetVelocity?.[2] ?? 0
              const relVelX = targetVelX - nextVelocity[0]
              const relVelY = targetVelY - nextVelocity[1]
              const relVelZ = targetVelZ - nextVelocity[2]

              const losUnitX = relX / relMag
              const losUnitY = relY / relMag
              const losUnitZ = relZ / relMag
              const closingSpeed = -(relVelX * losUnitX + relVelY * losUnitY + relVelZ * losUnitZ)

              if (closingSpeed > 0) {
                const relSq = relMag * relMag
                const losRateX = ((relY * relVelZ) - (relZ * relVelY)) / relSq
                const losRateY = ((relZ * relVelX) - (relX * relVelZ)) / relSq
                const losRateZ = ((relX * relVelY) - (relY * relVelX)) / relSq

                // 3D proportional navigation acceleration command.
                let accelX = TORPEDO_NAVIGATION_CONSTANT * closingSpeed * ((losRateY * losUnitZ) - (losRateZ * losUnitY))
                let accelY = TORPEDO_NAVIGATION_CONSTANT * closingSpeed * ((losRateZ * losUnitX) - (losRateX * losUnitZ))
                let accelZ = TORPEDO_NAVIGATION_CONSTANT * closingSpeed * ((losRateX * losUnitY) - (losRateY * losUnitX))

                const accelMag = Math.hypot(accelX, accelY, accelZ)
                if (accelMag > TORPEDO_MAX_LATERAL_ACCELERATION && accelMag > 0.000001) {
                  const scale = TORPEDO_MAX_LATERAL_ACCELERATION / accelMag
                  accelX *= scale
                  accelY *= scale
                  accelZ *= scale
                }

                nextVelocity = [
                  nextVelocity[0] + accelX * deltaSeconds,
                  nextVelocity[1] + accelY * deltaSeconds,
                  nextVelocity[2] + accelZ * deltaSeconds,
                ]
              }
            }
          }

          const nextFlightTime = cylinder.flightTimeSeconds + deltaSeconds
          if (nextFlightTime <= TORPEDO_ACCEL_DURATION_SECONDS) {
            const thrustDelta = TORPEDO_THRUST_ACCELERATION * deltaSeconds
            const speed = Math.hypot(nextVelocity[0], nextVelocity[1], nextVelocity[2])
            if (speed > 0.000001) {
              nextDirection = [
                nextVelocity[0] / speed,
                nextVelocity[1] / speed,
                nextVelocity[2] / speed,
              ]
            }
            nextVelocity = [
              nextVelocity[0] + nextDirection[0] * thrustDelta,
              nextVelocity[1] + nextDirection[1] * thrustDelta,
              nextVelocity[2] + nextDirection[2] * thrustDelta,
            ]
          }

          const finalSpeed = Math.hypot(nextVelocity[0], nextVelocity[1], nextVelocity[2])
          if (finalSpeed > 0.000001) {
            nextDirection = [
              nextVelocity[0] / finalSpeed,
              nextVelocity[1] / finalSpeed,
              nextVelocity[2] / finalSpeed,
            ]
          }

          return {
            ...cylinder,
            position: [
              cylinder.position[0] + nextVelocity[0] * deltaSeconds,
              cylinder.position[1] + nextVelocity[1] * deltaSeconds,
              cylinder.position[2] + nextVelocity[2] * deltaSeconds,
            ],
            velocity: nextVelocity,
            direction: nextDirection,
            flightTimeSeconds: nextFlightTime,
          }
        }),
      }
    }),
  launchFlares: (shipBoundingLength) =>
    set((s) => {
      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      const localShip = s.shipsById[localId] ?? s.ship
      const baseLength =
        Number.isFinite(shipBoundingLength) && shipBoundingLength > 1
          ? shipBoundingLength
          : s.playerShipBoundingLength
      const normalizedLength = Math.max(1, baseLength)
      const forward = getShipForwardVector(localShip.actualHeading, localShip.actualInclination)
      const backward: [number, number, number] = [-forward[0], -forward[1], -forward[2]]
      const right = normalizeVector(crossProduct(forward, [0, 1, 0]), [1, 0, 0])
      const up = normalizeVector(crossProduct(right, forward), [0, 1, 0])
      const spawnOffset = normalizedLength * 0.62
      const shipVelocity: [number, number, number] = [
        localShip.actualVelocity[0],
        localShip.actualVelocity[1],
        localShip.actualVelocity[2],
      ]
      const now = Date.now()

      return {
        launchedFlares: [
          ...s.launchedFlares,
          ...FLARE_SPREAD_DEGREES.map((angleDeg, index) => {
            const bearingJitterDeg = (Math.random() * 2 - 1) * FLARE_ANGLE_RANDOM_JITTER_DEG
            const inclinationJitterDeg = (Math.random() * 2 - 1) * FLARE_ANGLE_RANDOM_JITTER_DEG
            const randomizedBearingDeg = angleDeg + bearingJitterDeg
            const directionWithBearingJitter = rotateVectorAroundAxis(
              backward,
              up,
              randomizedBearingDeg
            )
            const flareDirection = normalizeVector(
              rotateVectorAroundAxis(directionWithBearingJitter, right, inclinationJitterDeg),
              directionWithBearingJitter
            )
            return {
              id: `flare-${now}-${index}-${Math.floor(Math.random() * 100000)}`,
              currentCelestialId: localShip.currentCelestialId,
              position: [
                localShip.position[0] + backward[0] * spawnOffset,
                localShip.position[1] + backward[1] * spawnOffset,
                localShip.position[2] + backward[2] * spawnOffset,
              ] as [number, number, number],
              velocity: [
                shipVelocity[0] + flareDirection[0] * FLARE_EJECTION_SPEED,
                shipVelocity[1] + flareDirection[1] * FLARE_EJECTION_SPEED,
                shipVelocity[2] + flareDirection[2] * FLARE_EJECTION_SPEED,
              ] as [number, number, number],
              flightTimeSeconds: 0,
            }
          }),
        ],
      }
    }),
  advanceLaunchedFlares: (deltaSeconds) =>
    set((s) => {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || s.launchedFlares.length === 0) {
        return {}
      }
      const velocityDecayMultiplier = Math.exp(-FLARE_VELOCITY_DECAY_RATE * deltaSeconds)
      return {
        launchedFlares: s.launchedFlares
          .map((flare) => {
            const nextFlightTime = flare.flightTimeSeconds + deltaSeconds
            const nextVelocity: [number, number, number] = [
              flare.velocity[0] * velocityDecayMultiplier,
              flare.velocity[1] * velocityDecayMultiplier,
              flare.velocity[2] * velocityDecayMultiplier,
            ]
            return {
              ...flare,
              position: [
                flare.position[0] + nextVelocity[0] * deltaSeconds,
                flare.position[1] + nextVelocity[1] * deltaSeconds,
                flare.position[2] + nextVelocity[2] * deltaSeconds,
              ] as [number, number, number],
              velocity: nextVelocity,
              flightTimeSeconds: nextFlightTime,
            }
          })
          .filter((flare) => flare.flightTimeSeconds <= FLARE_LIFETIME_SECONDS),
      }
    }),
  randomizePlanetTextures: () =>
    set((s) => ({
      planetTextureRandomizeNonce: s.planetTextureRandomizeNonce + 1,
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
