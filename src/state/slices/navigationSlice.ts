import type { StateCreator } from 'zustand'
import type { FlareLaunchMode, GameStore } from '@/state/types'
import type {
  OrdnanceSnapshotMessage,
  WireLaunchedChaff,
  WireLaunchedCylinder,
  WireLaunchedFlare,
  WireTorpedoExplosion,
} from '../../../shared/contracts/multiplayer'
import { DEFAULT_STAR_SYSTEM_SNAPSHOT, getCelestialById } from '@/utils/systemData'
import {
  getWarpCapacitorRequiredAmount,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'
import { TORPEDO_ACCEL_DURATION_SECONDS } from '@/systems/simulation/torpedoConstants'
import { getAsteroidMergedGeometryRadius } from '@/systems/asteroid/asteroidModelMetrics'
import { DEW_BEAM_STORE_LIFETIME_MS } from '@/constants/dewBeam'
import { useIRSTStore } from '@/state/irstStore'

const SHIP_CENTER_PIVOT: [number, number, number] = [0, 0, 0]
const OFFLINE_LOCAL_PLAYER_ID = 'local-player'
const WARP_MIN_POST_CAPACITOR = 1
const WARP_ARRIVAL_MIN_DISTANCE_KM = 15
const WARP_ARRIVAL_MAX_DISTANCE_KM = 50
const WARP_ARRIVAL_STEP_KM = 5
const FALLBACK_PLAYER_SHIP_BOUNDING_LENGTH = 600
/** Must match `ASTEROID_MODEL_URLS.length` in AsteroidBelt.tsx */
const ASTEROID_MODEL_COUNT = 5
const DEFAULT_DEBUG_ASTEROID_OFFSET: [number, number, number] = [0, 0, -1200]
const LAUNCHED_CYLINDER_SCALE = 0.5
const TORPEDO_THRUST_ACCELERATION = 130
const TORPEDO_LAUNCH_ACCELERATION_MULTIPLIER = 10
const TORPEDO_LAUNCH_ACCELERATION_TAPER_SECONDS = 2
const TORPEDO_NAVIGATION_CONSTANT = 4
const TORPEDO_MAX_LATERAL_ACCELERATION = 220
const TORPEDO_MIN_TARGET_RANGE = 1
const FLARE_EJECTION_SPEED = 1680
const FLARE_LIFETIME_SECONDS = 3
const FLARE_VELOCITY_DECAY_RATE = 0.8
const FLARE_ANGLE_RANDOM_JITTER_DEG = 5
const FLARE_PATTERN_MAX_SPREAD_DEG = 80
const FLARE_PATTERN_STEP_DEG = 18
const FLARE_MAX_COUNT = 20
const FLARE_STARTING_INVENTORY = 40
const CHAFF_PIECES_PER_SALVO = 56
const CHAFF_EJECTION_SPEED_MIN = 360
const CHAFF_EJECTION_SPEED_RANGE = 480
const CHAFF_BEARING_JITTER_DEG = 78
const CHAFF_INCLINATION_JITTER_DEG = 62
const CHAFF_LIFETIME_SECONDS = 14
const CHAFF_VELOCITY_DECAY_RATE = 0.2
const CHAFF_STARTING_INVENTORY = 10
const CHAFF_MAX_SIMULTANEOUS_PIECES = 1400
const TORPEDO_MIN_PN_SPEED = 20
const TORPEDO_HIT_RADIUS = 50
const TORPEDO_EXPLOSION_LIFETIME_SECONDS = 7.2
/** IR seeker: max range from missile to target ship for flare decoys to affect guidance. */
const IR_FLARE_CONFUSION_MISSILE_TO_TARGET_MAX_M = 4200
/** Only flares this young count as a “fresh” decoy deployment. */
const IR_FLARE_CONFUSION_FLARE_MAX_AGE_S = 1.35
/** Flares must stay near the defending ship to count. */
const IR_FLARE_CONFUSION_FLARE_MAX_DIST_FROM_SHIP_M = 1500
const IR_FLARE_CONFUSION_BASE_BLEND = 0.16
const IR_FLARE_CONFUSION_BLEND_PER_FLARE = 0.065
const IR_FLARE_CONFUSION_BLEND_MAX = 0.44
const IR_FLARE_CONFUSION_POSITION_JITTER_M = 55
const NETWORK_ORDNANCE_MAX_PER_CATEGORY = 512

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

/** Matches `IRSTCamera` / `SunSystem` IRST boresight (world +Y up). */
const IR_SEEKER_LOS_RANGE_M = 5_000_000

function normalizeIrstBearingDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

function clampIrstInclinationDeg(deg: number): number {
  return Math.max(-85, Math.min(85, deg))
}

function getIrstLosUnitFromShip(
  ship: GameStore['ship'],
  stabilized: boolean,
): [number, number, number] {
  const effectiveBearing = stabilized
    ? ship.irstBearing
    : normalizeIrstBearingDeg(360 - ship.actualHeading + ship.irstBearing)
  const effectiveInclination = stabilized
    ? ship.irstInclination
    : clampIrstInclinationDeg(ship.actualInclination + ship.irstInclination)
  const bearingRad = (effectiveBearing * Math.PI) / 180
  const inclinationRad = (effectiveInclination * Math.PI) / 180
  const outX = Math.sin(bearingRad) * Math.cos(inclinationRad)
  const outY = Math.sin(inclinationRad)
  const outZ = Math.cos(bearingRad) * Math.cos(inclinationRad)
  return [outX, outY, outZ]
}

function normalizeVector(vector: [number, number, number], fallback: [number, number, number]): [number, number, number] {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2])
  if (magnitude <= 0.000001) {
    return [...fallback]
  }
  return [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude]
}

function getTorpedoLaunchAccelerationMultiplier(flightTimeSeconds: number) {
  const clampedFlightTime = Math.max(0, flightTimeSeconds)
  const taperProgress = Math.min(1, clampedFlightTime / TORPEDO_LAUNCH_ACCELERATION_TAPER_SECONDS)
  return TORPEDO_LAUNCH_ACCELERATION_MULTIPLIER
    + (1 - TORPEDO_LAUNCH_ACCELERATION_MULTIPLIER) * taperProgress
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

function clampFlareCount(value: number | undefined) {
  if (!Number.isFinite(value)) return 1
  return Math.max(1, Math.min(FLARE_MAX_COUNT, Math.floor(value ?? 1)))
}

function buildPatternAngles(count: number): number[] {
  if (count <= 1) return [0]
  const totalSpread = Math.min(FLARE_PATTERN_MAX_SPREAD_DEG, (count - 1) * FLARE_PATTERN_STEP_DEG)
  const leftmost = -totalSpread / 2
  const step = totalSpread / (count - 1)
  return Array.from({ length: count }, (_, index) => leftmost + step * index)
}

function flareDeployingShipId(flare: GameStore['launchedFlares'][number]): string | null {
  if (typeof flare.deployedByShipId === 'string' && flare.deployedByShipId.length > 0) {
    return flare.deployedByShipId
  }
  const parts = flare.id.split('::')
  const ownerPrefix = parts.length >= 2 ? parts[0] : undefined
  if (ownerPrefix != null && ownerPrefix.length > 0) return ownerPrefix
  return null
}

function collectFlaresForIrSeekerConfusion(
  s: GameStore,
  targetShipId: string,
  celestialId: string,
  shipPos: [number, number, number],
): GameStore['launchedFlares'] {
  const out: GameStore['launchedFlares'] = []
  for (const flare of [...s.launchedFlares, ...s.remoteLaunchedFlares]) {
    if (flare.currentCelestialId !== celestialId) continue
    if (flare.flightTimeSeconds > IR_FLARE_CONFUSION_FLARE_MAX_AGE_S) continue
    if (flareDeployingShipId(flare) !== targetShipId) continue
    const dx = flare.position[0] - shipPos[0]
    const dy = flare.position[1] - shipPos[1]
    const dz = flare.position[2] - shipPos[2]
    if (Math.hypot(dx, dy, dz) > IR_FLARE_CONFUSION_FLARE_MAX_DIST_FROM_SHIP_M) continue
    out.push(flare)
  }
  return out
}

function blendIrSeekerPnAimWithFlares(
  shipPos: [number, number, number],
  flares: GameStore['launchedFlares'],
): [number, number, number] {
  if (flares.length === 0) return shipPos
  let sx = 0
  let sy = 0
  let sz = 0
  for (const f of flares) {
    sx += f.position[0]
    sy += f.position[1]
    sz += f.position[2]
  }
  const n = flares.length
  const cx = sx / n
  const cy = sy / n
  const cz = sz / n
  const blend = Math.min(
    IR_FLARE_CONFUSION_BLEND_MAX,
    IR_FLARE_CONFUSION_BASE_BLEND + n * IR_FLARE_CONFUSION_BLEND_PER_FLARE,
  )
  const j = IR_FLARE_CONFUSION_POSITION_JITTER_M
  return [
    shipPos[0] * (1 - blend) + cx * blend + (Math.random() * 2 - 1) * j,
    shipPos[1] * (1 - blend) + cy * blend + (Math.random() * 2 - 1) * j,
    shipPos[2] * (1 - blend) + cz * blend + (Math.random() * 2 - 1) * j,
  ]
}

function resolveLockTargetPosition(
  state: GameStore,
  lockId: string | null
): [number, number, number] | null {
  if (!lockId) return null
  const ship = state.shipsById[lockId]
  if (!ship) return null
  return [ship.position[0], ship.position[1], ship.position[2]]
}

function resolveLockTargetVelocity(
  state: GameStore,
  lockId: string | null
): [number, number, number] | null {
  if (!lockId) return null
  const ship = state.shipsById[lockId]
  if (!ship) return null
  const vx = ship.actualVelocity[0]
  const vy = ship.actualVelocity[1]
  const vz = ship.actualVelocity[2]
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) return null
  return [vx, vy, vz]
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function toFiniteNumber(value: unknown): number | null {
  if (isFiniteNumber(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function sanitizeVector3(input: unknown): [number, number, number] | null {
  if (!input) return null
  let xRaw: unknown
  let yRaw: unknown
  let zRaw: unknown
  if (Array.isArray(input)) {
    if (input.length < 3) return null
    xRaw = input[0]
    yRaw = input[1]
    zRaw = input[2]
  } else if (typeof input === 'object') {
    const vectorLike = input as Record<string, unknown>
    xRaw = vectorLike.x ?? vectorLike[0]
    yRaw = vectorLike.y ?? vectorLike[1]
    zRaw = vectorLike.z ?? vectorLike[2]
  } else {
    return null
  }
  const x = toFiniteNumber(xRaw)
  const y = toFiniteNumber(yRaw)
  const z = toFiniteNumber(zRaw)
  if (x === null || y === null || z === null) return null
  return [x, y, z]
}

function asCollection<T>(value: unknown): T[] {
  if (!value) return []
  if (Array.isArray(value)) return value as T[]
  if (value instanceof Map) return Array.from(value.values()) as T[]
  if (typeof value === 'object') return Object.values(value as Record<string, T>)
  return []
}

function sanitizeNetworkCylinders(
  snapshot: OrdnanceSnapshotMessage
): GameStore['remoteLaunchedCylinders'] {
  const next: GameStore['remoteLaunchedCylinders'] = []
  for (const [ownerId, ordnance] of Object.entries(snapshot)) {
    for (const cylinder of asCollection<WireLaunchedCylinder>(ordnance?.launchedCylinders)) {
      if (!cylinder || typeof cylinder.id !== 'string') continue
      const position = sanitizeVector3(cylinder.position)
      const velocity = sanitizeVector3(cylinder.velocity)
      const direction = sanitizeVector3(cylinder.direction)
      if (
        !position
        || !velocity
        || !direction
        || !isFiniteNumber(cylinder.radius)
        || !isFiniteNumber(cylinder.length)
        || !isFiniteNumber(cylinder.flightTimeSeconds)
        || typeof cylinder.currentCelestialId !== 'string'
      ) {
        continue
      }
      next.push({
        id: `${ownerId}::${cylinder.id}`,
        currentCelestialId: cylinder.currentCelestialId,
        position,
        velocity,
        radius: Math.max(0.1, cylinder.radius),
        length: Math.max(0.1, cylinder.length),
        direction,
        targetLockId: cylinder.targetLockId ?? null,
        flightTimeSeconds: Math.max(0, cylinder.flightTimeSeconds),
        ...(cylinder.guidance === 'ir_seeker' ? { guidance: 'ir_seeker' as const } : {}),
      })
      if (next.length >= NETWORK_ORDNANCE_MAX_PER_CATEGORY) return next
    }
  }
  return next
}

function sanitizeNetworkFlares(snapshot: OrdnanceSnapshotMessage): GameStore['remoteLaunchedFlares'] {
  const next: GameStore['remoteLaunchedFlares'] = []
  for (const [ownerId, ordnance] of Object.entries(snapshot)) {
    for (const flare of asCollection<WireLaunchedFlare>(ordnance?.launchedFlares)) {
      if (!flare || typeof flare.id !== 'string' || typeof flare.currentCelestialId !== 'string') continue
      const position = sanitizeVector3(flare.position)
      const velocity = sanitizeVector3(flare.velocity)
      if (!position || !velocity || !isFiniteNumber(flare.flightTimeSeconds)) continue
      const deployer =
        typeof flare.deployedByShipId === 'string' && flare.deployedByShipId.length > 0
          ? flare.deployedByShipId
          : ownerId
      next.push({
        id: `${ownerId}::${flare.id}`,
        currentCelestialId: flare.currentCelestialId,
        position,
        velocity,
        flightTimeSeconds: Math.max(0, flare.flightTimeSeconds),
        deployedByShipId: deployer,
      })
      if (next.length >= NETWORK_ORDNANCE_MAX_PER_CATEGORY) return next
    }
  }
  return next
}

function sanitizeNetworkChaff(snapshot: OrdnanceSnapshotMessage): GameStore['remoteLaunchedChaff'] {
  const next: GameStore['remoteLaunchedChaff'] = []
  for (const [ownerId, ordnance] of Object.entries(snapshot)) {
    for (const piece of asCollection<WireLaunchedChaff>(ordnance?.launchedChaff)) {
      if (!piece || typeof piece.id !== 'string' || typeof piece.currentCelestialId !== 'string') continue
      const position = sanitizeVector3(piece.position)
      const velocity = sanitizeVector3(piece.velocity)
      if (!position || !velocity || !isFiniteNumber(piece.flightTimeSeconds)) continue
      next.push({
        id: `${ownerId}::${piece.id}`,
        currentCelestialId: piece.currentCelestialId,
        position,
        velocity,
        flightTimeSeconds: Math.max(0, piece.flightTimeSeconds),
      })
      if (next.length >= NETWORK_ORDNANCE_MAX_PER_CATEGORY) return next
    }
  }
  return next
}

function sanitizeNetworkExplosions(
  snapshot: OrdnanceSnapshotMessage
): GameStore['remoteTorpedoExplosions'] {
  const next: GameStore['remoteTorpedoExplosions'] = []
  for (const [ownerId, ordnance] of Object.entries(snapshot)) {
    for (const explosion of asCollection<WireTorpedoExplosion>(ordnance?.torpedoExplosions)) {
      if (!explosion || typeof explosion.id !== 'string' || typeof explosion.currentCelestialId !== 'string') continue
      const position = sanitizeVector3(explosion.position)
      if (!position || !isFiniteNumber(explosion.flightTimeSeconds)) continue
      next.push({
        id: `${ownerId}::${explosion.id}`,
        currentCelestialId: explosion.currentCelestialId,
        position,
        flightTimeSeconds: Math.max(0, explosion.flightTimeSeconds),
        targetShipId: typeof explosion.targetShipId === 'string' ? explosion.targetShipId : undefined,
      })
      if (next.length >= NETWORK_ORDNANCE_MAX_PER_CATEGORY) return next
    }
  }
  return next
}

function applyLayeredDamageToShip(
  ship: GameStore['ship'],
  damage: number
): GameStore['ship'] {
  const appliedDamage = Math.max(0, damage)
  if (appliedDamage <= 0) return ship

  let remaining = appliedDamage
  let shield = ship.shield
  let armor = ship.armor
  let hull = ship.hull

  if (ship.shieldsUp && shield > 0) {
    const absorbed = Math.min(shield, remaining)
    shield -= absorbed
    remaining -= absorbed
  }
  if (remaining > 0 && armor > 0) {
    const absorbed = Math.min(armor, remaining)
    armor -= absorbed
    remaining -= absorbed
  }
  if (remaining > 0) {
    hull = Math.max(0, hull - remaining)
  }

  return {
    ...ship,
    shield,
    armor,
    hull,
  }
}

export const createNavigationSlice: StateCreator<GameStore, [], [], Partial<GameStore>> = (set) => ({
  starSystem: DEFAULT_STAR_SYSTEM_SNAPSHOT.system,
  starSystemSeed: DEFAULT_STAR_SYSTEM_SNAPSHOT.seed,
  starSystemConfig: DEFAULT_STAR_SYSTEM_SNAPSHOT.config,
  currentCelestialId: 'planet-1',
  debugPivotEnabled: false,
  orientDebugEnabled: false,
  showIRSTCone: false,
  showBScopeRadarCone: false,
  showColliderDebug: false,
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
  asteroidBeltMinSize: 26,
  asteroidBeltMaxSize: 140,
  debugAsteroids: [],
  debugAsteroidSpawnNonce: 0,
  debugAsteroidSpawnOffset: [...DEFAULT_DEBUG_ASTEROID_OFFSET] as [number, number, number],
  debugAsteroidDefaultScale: 80,
  debugAsteroidRandomizeScale: false,
  playerShipBoundingLength: FALLBACK_PLAYER_SHIP_BOUNDING_LENGTH,
  launchedCylinders: [],
  launchedFlares: [],
  launchedChaff: [],
  torpedoExplosions: [],
  dewBeams: [],
  flareInventory: FLARE_STARTING_INVENTORY,
  flareInventoryMax: FLARE_STARTING_INVENTORY,
  chaffInventory: CHAFF_STARTING_INVENTORY,
  chaffInventoryMax: CHAFF_STARTING_INVENTORY,
  countermeasuresPowered: true,
  dewPowered: false,
  torpedoTubesPowered: true,
  dewCharging: false,
  remoteLaunchedCylinders: [],
  remoteLaunchedFlares: [],
  remoteLaunchedChaff: [],
  remoteTorpedoExplosions: [],
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
  setShowColliderDebug: (enabled) => set({ showColliderDebug: enabled }),
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
  setDebugAsteroidSpawnOffset: (position) =>
    set({
      debugAsteroidSpawnOffset: [
        Number.isFinite(position[0]) ? position[0] : DEFAULT_DEBUG_ASTEROID_OFFSET[0],
        Number.isFinite(position[1]) ? position[1] : DEFAULT_DEBUG_ASTEROID_OFFSET[1],
        Number.isFinite(position[2]) ? position[2] : DEFAULT_DEBUG_ASTEROID_OFFSET[2],
      ],
    }),
  setDebugAsteroidDefaultScale: (scale) =>
    set({
      debugAsteroidDefaultScale: Number.isFinite(scale)
        ? Math.max(4, Math.min(500, scale))
        : 80,
    }),
  setDebugAsteroidRandomizeScale: (value) => set({ debugAsteroidRandomizeScale: Boolean(value) }),
  spawnDebugAsteroid: (options) =>
    set((s) => {
      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      const localShip = s.shipsById[localId] ?? s.ship
      const id = `debug-ast-${Date.now()}-${Math.floor(Math.random() * 100000)}`
      const modelIndex =
        options?.modelIndex !== undefined
          ? Math.max(0, Math.min(ASTEROID_MODEL_COUNT - 1, Math.floor(options.modelIndex)))
          : Math.floor(Math.random() * ASTEROID_MODEL_COUNT)
      const sizeSpan = Math.max(0, s.asteroidBeltMaxSize - s.asteroidBeltMinSize)
      let scale: number
      if (options?.scale !== undefined && Number.isFinite(options.scale)) {
        scale = Math.max(4, Math.min(500, options.scale))
      } else if (s.debugAsteroidRandomizeScale) {
        scale = Math.max(
          4,
          Math.min(500, s.asteroidBeltMinSize + Math.random() * sizeSpan)
        )
      } else {
        scale = Math.max(4, Math.min(500, s.debugAsteroidDefaultScale))
      }

      const explicitOff = options?.offset
      let ox: number
      let oy: number
      let oz: number
      if (explicitOff !== undefined) {
        ox = Number.isFinite(explicitOff[0]) ? explicitOff[0] : 0
        oy = Number.isFinite(explicitOff[1]) ? explicitOff[1] : 0
        oz = Number.isFinite(explicitOff[2]) ? explicitOff[2] : 0
      } else {
        const modelRadius = getAsteroidMergedGeometryRadius(modelIndex)
        const maxExtent = scale * modelRadius
        ox = 2 * maxExtent
        const u = s.debugAsteroidSpawnOffset
        oy = Number.isFinite(u[1]) ? u[1] : 0
        oz = Number.isFinite(u[2]) ? u[2] : 0
      }

      const pos: [number, number, number] = [
        localShip.position[0] + ox,
        localShip.position[1] + oy,
        localShip.position[2] + oz,
      ]
      const rotation: [number, number, number] = [
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
      ]
      return {
        debugAsteroids: [
          ...s.debugAsteroids,
          { id, position: pos, rotation, scale, modelIndex },
        ],
        debugAsteroidSpawnNonce: s.debugAsteroidSpawnNonce + 1,
      }
    }),
  removeDebugAsteroid: (id) =>
    set((s) => {
      const next = s.debugAsteroids.filter((a) => a.id !== id)
      if (next.length === s.debugAsteroids.length) return {}
      return {
        debugAsteroids: next,
        debugAsteroidSpawnNonce: s.debugAsteroidSpawnNonce + 1,
      }
    }),
  clearDebugAsteroids: () =>
    set((s) => {
      if (s.debugAsteroids.length === 0) return {}
      return {
        debugAsteroids: [],
        debugAsteroidSpawnNonce: s.debugAsteroidSpawnNonce + 1,
      }
    }),
  setPlayerShipBoundingLength: (length) =>
    set({
      playerShipBoundingLength:
        Number.isFinite(length) && length > 1 ? length : FALLBACK_PLAYER_SHIP_BOUNDING_LENGTH,
    }),
  setCountermeasuresPowered: (powered) =>
    set({
      countermeasuresPowered: powered,
    }),
  setDewPowered: (powered) =>
    set((s) => ({
      dewPowered: powered,
      dewCharging: powered ? s.dewCharging : false,
    })),
  setTorpedoTubesPowered: (powered) =>
    set({
      torpedoTubesPowered: powered,
    }),
  setDewCharging: (charging) =>
    set((s) => ({
      dewCharging: s.dewPowered ? charging : false,
    })),
  launchLockedCylinder: (shipBoundingLength, options) =>
    set((s) => {
      if (!s.torpedoTubesPowered) return {}
      const explicitTarget =
        typeof options?.targetLockId === 'string' && options.targetLockId.length > 0
          ? options.targetLockId
          : null
      let targetLockId: string | null = null
      if (explicitTarget) {
        if (!resolveLockTargetPosition(s, explicitTarget)) return {}
        targetLockId = explicitTarget
      } else {
        if (!hasRadarLock(s.ewLockState)) {
          return {}
        }
        targetLockId = getPreferredRadarLockId(s.ewLockState)
      }
      if (!targetLockId) return {}
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
            targetLockId,
            flightTimeSeconds: 0,
            ...(explicitTarget ? { guidance: 'ir_seeker' as const } : {}),
          },
        ],
      }
    }),
  advanceLaunchedCylinders: (deltaSeconds) =>
    set((s) => {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || s.launchedCylinders.length === 0) {
        return {}
      }
      const TORPEDO_DAMAGE = 7000
      const survivingCylinders: typeof s.launchedCylinders = []
      const shipDamage: Record<string, number> = {}
      const createdExplosions: GameStore['torpedoExplosions'] = []
      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      const localShip = s.shipsById[localId] ?? s.ship

      for (const cylinder of s.launchedCylinders) {
        let nextDirection: [number, number, number] = [...cylinder.direction]
        let nextVelocity: [number, number, number] = [...cylinder.velocity]
        const thrustAccelerationActive =
          cylinder.flightTimeSeconds < TORPEDO_ACCEL_DURATION_SECONDS

        let pnTargetPosition: [number, number, number] | null = null
        let pnTargetVelocity: [number, number, number] | null = null
        let hitTestWorldPosition: [number, number, number] | null = null
        let hitTestLockId: string | null = null

        if (cylinder.guidance === 'ir_seeker') {
          const irstState = useIRSTStore.getState()
          const lockHeld =
            irstState.pointTrackEnabled
            && irstState.pointTrackTargetId != null
            && irstState.pointTrackTargetId === cylinder.targetLockId
          const lockedPosition = lockHeld ? resolveLockTargetPosition(s, cylinder.targetLockId) : null
          if (lockHeld && lockedPosition) {
            const shipVel = resolveLockTargetVelocity(s, cylinder.targetLockId)
            pnTargetPosition = lockedPosition
            pnTargetVelocity = shipVel
            hitTestWorldPosition = lockedPosition
            hitTestLockId = cylinder.targetLockId

            const distMissileToTarget = Math.hypot(
              cylinder.position[0] - lockedPosition[0],
              cylinder.position[1] - lockedPosition[1],
              cylinder.position[2] - lockedPosition[2],
            )
            if (
              distMissileToTarget <= IR_FLARE_CONFUSION_MISSILE_TO_TARGET_MAX_M
              && cylinder.targetLockId
            ) {
              const decoyFlares = collectFlaresForIrSeekerConfusion(
                s,
                cylinder.targetLockId,
                cylinder.currentCelestialId,
                lockedPosition,
              )
              if (decoyFlares.length > 0) {
                pnTargetPosition = blendIrSeekerPnAimWithFlares(lockedPosition, decoyFlares)
                pnTargetVelocity = shipVel
              }
            }
          } else {
            const [lx, ly, lz] = getIrstLosUnitFromShip(localShip, irstState.stabilized)
            pnTargetPosition = [
              localShip.position[0] + lx * IR_SEEKER_LOS_RANGE_M,
              localShip.position[1] + ly * IR_SEEKER_LOS_RANGE_M,
              localShip.position[2] + lz * IR_SEEKER_LOS_RANGE_M,
            ]
            pnTargetVelocity = [0, 0, 0]
            hitTestWorldPosition = null
            hitTestLockId = null
          }
        } else {
          pnTargetPosition = resolveLockTargetPosition(s, cylinder.targetLockId)
          pnTargetVelocity = resolveLockTargetVelocity(s, cylinder.targetLockId)
          hitTestWorldPosition = pnTargetPosition
          hitTestLockId = cylinder.targetLockId
        }

        const nextFlightTime = cylinder.flightTimeSeconds + deltaSeconds
        if (thrustAccelerationActive) {
          const launchAccelerationMultiplier = getTorpedoLaunchAccelerationMultiplier(cylinder.flightTimeSeconds)
          const thrustDelta = TORPEDO_THRUST_ACCELERATION * launchAccelerationMultiplier * deltaSeconds
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

        const postThrustSpeed = Math.hypot(nextVelocity[0], nextVelocity[1], nextVelocity[2])
        if (thrustAccelerationActive && pnTargetPosition && postThrustSpeed > TORPEDO_MIN_PN_SPEED) {
          const relX = pnTargetPosition[0] - cylinder.position[0]
          const relY = pnTargetPosition[1] - cylinder.position[1]
          const relZ = pnTargetPosition[2] - cylinder.position[2]
          const relMag = Math.hypot(relX, relY, relZ)
          if (relMag > TORPEDO_MIN_TARGET_RANGE) {
            const targetVelX = pnTargetVelocity?.[0] ?? 0
            const targetVelY = pnTargetVelocity?.[1] ?? 0
            const targetVelZ = pnTargetVelocity?.[2] ?? 0
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

              const correctedX = nextVelocity[0] + accelX * deltaSeconds
              const correctedY = nextVelocity[1] + accelY * deltaSeconds
              const correctedZ = nextVelocity[2] + accelZ * deltaSeconds
              const dot = correctedX * nextVelocity[0] + correctedY * nextVelocity[1] + correctedZ * nextVelocity[2]
              if (dot > 0) {
                nextVelocity = [correctedX, correctedY, correctedZ]
              }
            }
          }
        }

        const finalSpeed = Math.hypot(nextVelocity[0], nextVelocity[1], nextVelocity[2])
        if (finalSpeed > 0.000001) {
          nextDirection = [
            nextVelocity[0] / finalSpeed,
            nextVelocity[1] / finalSpeed,
            nextVelocity[2] / finalSpeed,
          ]
        }

        const nextPosition: [number, number, number] = [
          cylinder.position[0] + nextVelocity[0] * deltaSeconds,
          cylinder.position[1] + nextVelocity[1] * deltaSeconds,
          cylinder.position[2] + nextVelocity[2] * deltaSeconds,
        ]

        if (hitTestWorldPosition && hitTestLockId) {
          const hitDist = Math.hypot(
            nextPosition[0] - hitTestWorldPosition[0],
            nextPosition[1] - hitTestWorldPosition[1],
            nextPosition[2] - hitTestWorldPosition[2]
          )
          if (hitDist <= TORPEDO_HIT_RADIUS) {
            shipDamage[hitTestLockId] = (shipDamage[hitTestLockId] ?? 0) + TORPEDO_DAMAGE
            createdExplosions.push({
              id: `torpedo-explosion-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
              currentCelestialId: cylinder.currentCelestialId,
              position: [nextPosition[0], nextPosition[1], nextPosition[2]],
              flightTimeSeconds: 0,
              targetShipId: hitTestLockId,
            })
            continue
          }
        }

        survivingCylinders.push({
          ...cylinder,
          position: nextPosition,
          velocity: nextVelocity,
          direction: nextDirection,
          flightTimeSeconds: nextFlightTime,
        })
      }

      const hitIds = Object.keys(shipDamage)
      if (hitIds.length === 0) {
        return {
          launchedCylinders: survivingCylinders,
          torpedoExplosions: createdExplosions.length > 0
            ? [...s.torpedoExplosions, ...createdExplosions]
            : s.torpedoExplosions,
        }
      }

      const nextShips = { ...s.shipsById }
      for (const targetId of hitIds) {
        const target = nextShips[targetId]
        if (!target) continue
        let remaining = shipDamage[targetId] ?? 0
        let { shield, armor, hull } = target
        if (target.shieldsUp && shield > 0) {
          const absorbed = Math.min(shield, remaining)
          shield -= absorbed
          remaining -= absorbed
        }
        if (remaining > 0 && armor > 0) {
          const absorbed = Math.min(armor, remaining)
          armor -= absorbed
          remaining -= absorbed
        }
        if (remaining > 0) {
          hull = Math.max(0, hull - remaining)
        }
        nextShips[targetId] = { ...target, shield, armor, hull }
      }
      return {
        launchedCylinders: survivingCylinders,
        shipsById: nextShips,
        torpedoExplosions: createdExplosions.length > 0
          ? [...s.torpedoExplosions, ...createdExplosions]
          : s.torpedoExplosions,
      }
    }),
  launchFlares: (shipBoundingLength, options) =>
    set((s) => {
      if (!s.countermeasuresPowered) {
        return {}
      }
      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      const localShip = s.shipsById[localId] ?? s.ship
      const launchMode: FlareLaunchMode = options?.mode === 'single' ? 'single' : 'pattern'
      const defaultCount = launchMode === 'single' ? 1 : 5
      const requestedCount = clampFlareCount(options?.count ?? defaultCount)
      const availableFlares = Math.max(0, Math.floor(s.flareInventory))
      const flareCount = Math.min(requestedCount, availableFlares)
      if (flareCount <= 0) {
        return {}
      }
      const launchAngles = launchMode === 'single' ? [0] : buildPatternAngles(flareCount)
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
          ...launchAngles.map((angleDeg, index) => {
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
              deployedByShipId: localId,
            }
          }),
        ],
        flareInventory: Math.max(0, availableFlares - flareCount),
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
  launchChaff: (shipBoundingLength) =>
    set((s) => {
      if (!s.countermeasuresPowered) {
        return {}
      }
      const available = Math.max(0, Math.floor(s.chaffInventory))
      if (available <= 0) {
        return {}
      }
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
      const spawnOffset = normalizedLength * 0.58
      const shipVelocity: [number, number, number] = [
        localShip.actualVelocity[0],
        localShip.actualVelocity[1],
        localShip.actualVelocity[2],
      ]
      const now = Date.now()
      const newPieces = Array.from({ length: CHAFF_PIECES_PER_SALVO }, (_, index) => {
        const bearingJitterDeg = (Math.random() * 2 - 1) * CHAFF_BEARING_JITTER_DEG
        const inclinationJitterDeg = (Math.random() * 2 - 1) * CHAFF_INCLINATION_JITTER_DEG
        const directionWithBearingJitter = rotateVectorAroundAxis(backward, up, bearingJitterDeg)
        const pieceDirection = normalizeVector(
          rotateVectorAroundAxis(directionWithBearingJitter, right, inclinationJitterDeg),
          directionWithBearingJitter
        )
        const ejectionSpeed = CHAFF_EJECTION_SPEED_MIN + Math.random() * CHAFF_EJECTION_SPEED_RANGE
        const jx = (Math.random() * 2 - 1) * normalizedLength * 0.04
        const jy = (Math.random() * 2 - 1) * normalizedLength * 0.04
        const jz = (Math.random() * 2 - 1) * normalizedLength * 0.04
        return {
          id: `chaff-${now}-${index}-${Math.floor(Math.random() * 100000)}`,
          currentCelestialId: localShip.currentCelestialId,
          position: [
            localShip.position[0] + backward[0] * spawnOffset + jx,
            localShip.position[1] + backward[1] * spawnOffset + jy,
            localShip.position[2] + backward[2] * spawnOffset + jz,
          ] as [number, number, number],
          velocity: [
            shipVelocity[0] + pieceDirection[0] * ejectionSpeed,
            shipVelocity[1] + pieceDirection[1] * ejectionSpeed,
            shipVelocity[2] + pieceDirection[2] * ejectionSpeed,
          ] as [number, number, number],
          flightTimeSeconds: 0,
        }
      })
      let combined = [...s.launchedChaff, ...newPieces]
      if (combined.length > CHAFF_MAX_SIMULTANEOUS_PIECES) {
        combined = combined.slice(combined.length - CHAFF_MAX_SIMULTANEOUS_PIECES)
      }
      return {
        launchedChaff: combined,
        chaffInventory: available - 1,
      }
    }),
  advanceLaunchedChaff: (deltaSeconds) =>
    set((s) => {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || s.launchedChaff.length === 0) {
        return {}
      }
      const velocityDecayMultiplier = Math.exp(-CHAFF_VELOCITY_DECAY_RATE * deltaSeconds)
      return {
        launchedChaff: s.launchedChaff
          .map((piece) => {
            const nextFlightTime = piece.flightTimeSeconds + deltaSeconds
            const nextVelocity: [number, number, number] = [
              piece.velocity[0] * velocityDecayMultiplier,
              piece.velocity[1] * velocityDecayMultiplier,
              piece.velocity[2] * velocityDecayMultiplier,
            ]
            return {
              ...piece,
              position: [
                piece.position[0] + nextVelocity[0] * deltaSeconds,
                piece.position[1] + nextVelocity[1] * deltaSeconds,
                piece.position[2] + nextVelocity[2] * deltaSeconds,
              ] as [number, number, number],
              velocity: nextVelocity,
              flightTimeSeconds: nextFlightTime,
            }
          })
          .filter((piece) => piece.flightTimeSeconds <= CHAFF_LIFETIME_SECONDS),
      }
    }),
  advanceTorpedoExplosions: (deltaSeconds) =>
    set((s) => {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0 || s.torpedoExplosions.length === 0) {
        return {}
      }
      return {
        torpedoExplosions: s.torpedoExplosions
          .map((explosion) => ({
            ...explosion,
            flightTimeSeconds: explosion.flightTimeSeconds + deltaSeconds,
          }))
          .filter(
            (explosion) =>
              explosion.flightTimeSeconds
              <= (explosion.lifetimeSeconds ?? TORPEDO_EXPLOSION_LIFETIME_SECONDS)
          ),
      }
    }),
  addTorpedoExplosion: (explosion) =>
    set((s) => ({
      torpedoExplosions: [
        ...s.torpedoExplosions,
        {
          ...explosion,
          flightTimeSeconds: Math.max(0, explosion.flightTimeSeconds),
        },
      ],
    })),
  applyShipDamage: (targetShipId, damage, options) =>
    set((s) => {
      const target = s.shipsById[targetShipId]
      const appliedDamage = Math.max(0, damage)
      if (!target || appliedDamage <= 0) return {}
      if (
        options?.currentCelestialId
        && target.currentCelestialId !== options.currentCelestialId
      ) {
        return {}
      }

      const updatedTarget = applyLayeredDamageToShip(target, appliedDamage)
      const nextShipsById = {
        ...s.shipsById,
        [targetShipId]: updatedTarget,
      }
      const nextState: Partial<GameStore> = {
        shipsById: nextShipsById,
      }
      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      if (targetShipId === localId) {
        nextState.ship = updatedTarget
      }
      return nextState
    }),
  fireDew: (originPosition, targetPosition, celestialId, targetShipId, damage = 0) =>
    set((s) => {
      const nextState: Partial<GameStore> = {
        dewBeams: [
          ...s.dewBeams,
          {
            id: `dew-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            currentCelestialId: celestialId,
            originPosition,
            targetPosition,
            originShipId: s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID,
            ...(targetShipId ? { targetShipId } : {}),
            firedAtMs: performance.now(),
          },
        ],
      }
      const appliedDamage = Math.max(0, damage)
      if (!targetShipId || appliedDamage <= 0) {
        return nextState
      }
      const target = s.shipsById[targetShipId]
      if (!target || target.currentCelestialId !== celestialId) {
        return nextState
      }

      const updatedTarget = applyLayeredDamageToShip(target, appliedDamage)
      const nextShipsById = {
        ...s.shipsById,
        [targetShipId]: updatedTarget,
      }
      nextState.shipsById = nextShipsById

      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      if (targetShipId === localId) {
        nextState.ship = updatedTarget
      }

      return nextState
    }),
  advanceDewBeams: () =>
    set((s) => {
      if (s.dewBeams.length === 0) return {}
      const now = performance.now()
      return {
        dewBeams: s.dewBeams.filter((beam) => now - beam.firedAtMs <= DEW_BEAM_STORE_LIFETIME_MS),
      }
    }),
  setRemoteOrdnanceSnapshot: (snapshot) =>
    set({
      remoteLaunchedCylinders: sanitizeNetworkCylinders(snapshot),
      remoteLaunchedFlares: sanitizeNetworkFlares(snapshot),
      remoteLaunchedChaff: sanitizeNetworkChaff(snapshot),
      remoteTorpedoExplosions: sanitizeNetworkExplosions(snapshot),
    }),
  clearRemoteOrdnance: () =>
    set({
      remoteLaunchedCylinders: [],
      remoteLaunchedFlares: [],
      remoteLaunchedChaff: [],
      remoteTorpedoExplosions: [],
    }),
  randomizePlanetTextures: () =>
    set((s) => ({
      planetTextureRandomizeNonce: s.planetTextureRandomizeNonce + 1,
    })),
  startWarp: (targetCelestialId) =>
    set((s) => {
      if (s.warpState !== 'idle' || !s.warpAligned) return {}
      const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      const localShip = s.shipsById[localId] ?? s.ship
      if (localShip.warpCoreAttenuated) return {}
      const sourceCelestial = getCelestialById(s.currentCelestialId, s.starSystem)
      const destinationCelestial = getCelestialById(targetCelestialId, s.starSystem)
      if (!sourceCelestial || !destinationCelestial || sourceCelestial.id === destinationCelestial.id) {
        return {}
      }

      const sourceWorld = worldPositionForCelestial(sourceCelestial)
      const destinationWorld = worldPositionForCelestial(destinationCelestial)
      const distanceWorldUnits = vectorMagnitude(vectorBetweenWorldPoints(sourceWorld, destinationWorld))
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
