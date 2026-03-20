import type {
  GridObject,
  RWRContact,
  StarSystemData,
  StarSystemGenerationConfig,
  StarSystemSnapshot,
  WarpState,
} from '@/types/game'
import type { OrdnanceSnapshotMessage, WireShipSnapshot } from '../../shared/contracts/multiplayer'

export interface ShipState {
  currentCelestialId: string
  inWarpTransit: boolean
  position: [number, number, number]
  shieldsUp: boolean
  shieldOnlineLevel: number
  shieldRechargeRatePct: number
  shield: number
  shieldMax: number
  armor: number
  armorMax: number
  hull: number
  hullMax: number
  capacitor: number
  capacitorMax: number
  targetSpeed: number
  mwdActive: boolean
  mwdRemaining: number
  mwdCooldownRemaining: number
  dampenersActive: boolean
  bearing: number
  inclination: number
  actualHeading: number
  actualSpeed: number
  actualVelocity: [number, number, number]
  actualInclination: number
  dacPitch: number
  rollAngle: number
  thermalSignature: number
  radioSignature: number
  irstMode: 'BHOT' | 'WHOT'
  irstSpectrumMode: 'IR' | 'VIS'
  laserRange: number
  irstZoom: number
  irstBearing: number
  irstInclination: number
}

export type NpcBehaviorMode = 'manual' | 'stationary' | 'straight' | 'orbit'
export type NpcRadarMode = 'off' | 'scan' | 'stt'

export interface NpcShipConfig {
  behaviorMode: NpcBehaviorMode
  commandedHeading: number
  commandedInclination: number
  commandedSpeed: number
  mwdActive: boolean
  shieldsUp: boolean
  radarMode: NpcRadarMode
  orbitCenter: [number, number, number]
  orbitRadius: number
}

export interface EwJammerState {
  mode: string | null
  active: boolean
  freq: number
}

export interface EwGravAnalysisSession {
  celestialId: string
  anomalyId: string
  startedAt: number
  durationMs: number
  clarity: number
}

export interface EwGravAnalysisResult {
  celestialId: string
  completedAt: number
  durationMs: number
  clarity: number
}

export type NavAttitudeMode = 'AA' | 'DAC'

export interface LaunchedCylinder {
  id: string
  currentCelestialId: string
  position: [number, number, number]
  velocity: [number, number, number]
  radius: number
  length: number
  direction: [number, number, number]
  targetLockId: string | null
  flightTimeSeconds: number
  /** IR seeker: home on IRST point-track `targetLockId`; if lock breaks, chase LOS from launcher IRST. */
  guidance?: 'radar' | 'ir_seeker'
}

export interface LaunchedFlare {
  id: string
  currentCelestialId: string
  position: [number, number, number]
  velocity: [number, number, number]
  flightTimeSeconds: number
  /** Ship that launched this flare (for IR seeker vs decoy logic). */
  deployedByShipId?: string
}

/** Single foil fragment from a chaff salvo. */
export interface LaunchedChaffPiece {
  id: string
  currentCelestialId: string
  position: [number, number, number]
  velocity: [number, number, number]
  flightTimeSeconds: number
}

export type FlareLaunchMode = 'pattern' | 'single'

export interface FlareLaunchOptions {
  count?: number
  mode?: FlareLaunchMode
}

export interface TorpedoExplosion {
  id: string
  currentCelestialId: string
  position: [number, number, number]
  flightTimeSeconds: number
  targetShipId?: string
  kind?: 'torpedo' | 'ship-destruction'
  sizeMultiplier?: number
  lifetimeSeconds?: number
  glowMultiplier?: number
}

export interface DewBeam {
  id: string
  currentCelestialId: string
  originPosition: [number, number, number]
  targetPosition: [number, number, number]
  /** When set, visuals track this ship while it stays in `currentCelestialId`. */
  originShipId?: string
  targetShipId?: string
  firedAtMs: number
}

/** Single dev-spawned asteroid (matches `AsteroidInstance` in AsteroidBelt + stable id). */
export type DebugAsteroidEntry = {
  id: string
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  modelIndex: number
}

export interface GameStore {
  starSystem: StarSystemData
  starSystemSeed: number
  starSystemConfig: StarSystemGenerationConfig
  currentCelestialId: string
  debugPivotEnabled: boolean
  orientDebugEnabled: boolean
  showIRSTCone: boolean
  showBScopeRadarCone: boolean
  showColliderDebug: boolean
  unlimitAaOrbitZoomOut: boolean
  showCelestialGridCenterMarker: boolean
  debugPivotPosition: [number, number, number]
  debugPivotDragging: boolean
  debugPivotResetCount: number
  localPlayerId: string
  shipsById: Record<string, ShipState>
  ship: ShipState
  npcShips: Record<string, NpcShipConfig>
  npcSpawnPosition: [number, number, number]
  warpState: WarpState
  warpTargetId: string | null
  selectedTargetId: string | null
  selectedWarpDestinationId: string | null
  warpArrivalDistanceKm: number
  warpSourceCelestialId: string | null
  warpTravelProgress: number
  warpReferenceSpeed: number
  warpRequiredBearing: number
  warpRequiredInclination: number
  warpAlignmentErrorDeg: number
  warpAligned: boolean
  navAttitudeMode: NavAttitudeMode
  gridObjects: GridObject[]
  rwrContacts: RWRContact[]
  ewLockState: Record<string, 'soft' | 'hard'>
  ewIffState: Record<string, string>
  ewRadarOn: boolean
  ewRadarMode: string
  ewRadarPower: number
  ewRadarFreq: number
  ewRadarPRF: string
  ewUpperScannerOn: boolean
  ewLowerScannerOn: boolean
  irstCameraOn: boolean
  ewJammers: EwJammerState[]
  ewActiveGravAnalysis: EwGravAnalysisSession | null
  ewLastGravAnalysisResult: EwGravAnalysisResult | null
  ewRevealedCelestialIds: string[]
  setEwJammers: (jammers: EwJammerState[]) => void
  setEwUpperScannerOn: (on: boolean) => void
  setEwLowerScannerOn: (on: boolean) => void
  setIrstCameraOn: (on: boolean) => void
  startEwGravAnalysis: (session: EwGravAnalysisSession) => void
  completeEwGravAnalysis: () => void
  cancelEwGravAnalysis: () => void
  revealEwCelestial: (celestialId: string) => void
  setEwRevealedCelestialIds: (celestialIds: string[]) => void
  setEwLockState: (updater: (prev: Record<string, 'soft' | 'hard'>) => Record<string, 'soft' | 'hard'>) => void
  setEwIffState: (updater: (prev: Record<string, string>) => Record<string, string>) => void
  setEwRadar: (partial: Partial<{ radarOn: boolean; radarMode: string; radarPower: number; radarFreq: number; radarPRF: string }>) => void
  setRwrContacts: (contacts: RWRContact[]) => void
  setStarSystemSnapshot: (snapshot: StarSystemSnapshot) => void
  setCurrentCelestial: (id: string) => void
  setDebugPivotEnabled: (enabled: boolean) => void
  setOrientDebugEnabled: (enabled: boolean) => void
  setShowIRSTCone: (enabled: boolean) => void
  setShowBScopeRadarCone: (enabled: boolean) => void
  setShowColliderDebug: (enabled: boolean) => void
  setUnlimitAaOrbitZoomOut: (enabled: boolean) => void
  setShowCelestialGridCenterMarker: (enabled: boolean) => void
  setDebugPivotPosition: (position: [number, number, number]) => void
  setDebugPivotDragging: (dragging: boolean) => void
  resetDebugPivot: () => void
  setWarpState: (state: WarpState, targetId?: string | null) => void
  setSelectedTarget: (id: string | null) => void
  setSelectedWarpDestination: (id: string | null) => void
  setWarpArrivalDistanceKm: (distanceKm: number) => void
  setWarpAlignmentStatus: (payload: {
    requiredBearing: number
    requiredInclination: number
    totalErrorDeg: number
    aligned: boolean
  }) => void
  setWarpTravelProgress: (progress: number) => void
  setWarpReferenceSpeed: (speed: number) => void
  setNavAttitudeMode: (mode: NavAttitudeMode) => void
  setGridObjects: (objects: GridObject[]) => void
  /** Default random scale range for `spawnDebugAsteroid` when scale is omitted. */
  asteroidBeltMinSize: number
  asteroidBeltMaxSize: number
  /** Dev-only asteroids spawned at world positions (e.g. ship.position + offset). */
  debugAsteroids: DebugAsteroidEntry[]
  debugAsteroidSpawnNonce: number
  /**
   * Y/Z offset from local ship when spawning from the debug menu (world space).
   * X is computed as `2 × scale × merged mesh bounding-sphere radius` for that model.
   */
  debugAsteroidSpawnOffset: [number, number, number]
  /** World scale used when spawning unless `spawnDebugAsteroid({ scale })` overrides or randomize is on. */
  debugAsteroidDefaultScale: number
  /** When true, spawn uses a random scale between `asteroidBeltMinSize` and `asteroidBeltMaxSize`. */
  debugAsteroidRandomizeScale: boolean
  playerShipBoundingLength: number
  launchedCylinders: LaunchedCylinder[]
  launchedFlares: LaunchedFlare[]
  launchedChaff: LaunchedChaffPiece[]
  torpedoExplosions: TorpedoExplosion[]
  dewBeams: DewBeam[]
  flareInventory: number
  flareInventoryMax: number
  chaffInventory: number
  chaffInventoryMax: number
  countermeasuresPowered: boolean
  dewPowered: boolean
  dewCharging: boolean
  remoteLaunchedCylinders: LaunchedCylinder[]
  remoteLaunchedFlares: LaunchedFlare[]
  remoteLaunchedChaff: LaunchedChaffPiece[]
  remoteTorpedoExplosions: TorpedoExplosion[]
  planetTextureRandomizeNonce: number
  setDebugAsteroidSpawnOffset: (position: [number, number, number]) => void
  setDebugAsteroidDefaultScale: (scale: number) => void
  setDebugAsteroidRandomizeScale: (value: boolean) => void
  /** Pass `offset` to use explicit X/Y/Z; omit to use auto X (2× extents) + store Y/Z. */
  spawnDebugAsteroid: (options?: {
    offset?: [number, number, number]
    modelIndex?: number
    scale?: number
  }) => void
  removeDebugAsteroid: (id: string) => void
  clearDebugAsteroids: () => void
  setNpcSpawnPosition: (position: [number, number, number]) => void
  spawnNpcShip: (position?: [number, number, number], config?: Partial<NpcShipConfig>) => void
  removeNpcShip: (id: string) => void
  clearNpcShips: () => void
  setNpcShipConfig: (id: string, partial: Partial<NpcShipConfig>) => void
  advanceNpcShips: (deltaSeconds: number) => void
  setPlayerShipBoundingLength: (length: number) => void
  setCountermeasuresPowered: (powered: boolean) => void
  setDewPowered: (powered: boolean) => void
  setDewCharging: (charging: boolean) => void
  launchLockedCylinder: (
    shipBoundingLength: number,
    options?: { targetLockId?: string | null }
  ) => void
  advanceLaunchedCylinders: (deltaSeconds: number) => void
  launchFlares: (shipBoundingLength: number, options?: FlareLaunchOptions) => void
  advanceLaunchedFlares: (deltaSeconds: number) => void
  launchChaff: (shipBoundingLength: number) => void
  advanceLaunchedChaff: (deltaSeconds: number) => void
  advanceTorpedoExplosions: (deltaSeconds: number) => void
  addTorpedoExplosion: (explosion: TorpedoExplosion) => void
  applyShipDamage: (
    targetShipId: string,
    damage: number,
    options?: { currentCelestialId?: string }
  ) => void
  fireDew: (
    originPosition: [number, number, number],
    targetPosition: [number, number, number],
    celestialId: string,
    targetShipId?: string,
    damage?: number
  ) => void
  advanceDewBeams: () => void
  setRemoteOrdnanceSnapshot: (snapshot: OrdnanceSnapshotMessage) => void
  clearRemoteOrdnance: () => void
  randomizePlanetTextures: () => void
  setLocalPlayerId: (id: string) => void
  setLocalShipState: (partial: Partial<ShipState>) => void
  upsertRemoteShips: (snapshot: Record<string, WireShipSnapshot>) => void
  setShipState: (partial: Partial<ShipState>) => void
  setTargetSpeed: (mps: number) => void
  setMwdActive: (active: boolean, durationSeconds?: number) => void
  setMwdRemaining: (seconds: number) => void
  setDampenersActive: (active: boolean) => void
  setBearing: (deg: number) => void
  setInclination: (deg: number) => void
  setActualHeading: (deg: number) => void
  setActualSpeed: (mps: number) => void
  setActualInclination: (deg: number) => void
  startWarp: (targetCelestialId: string) => void
  finishWarp: () => void
}
