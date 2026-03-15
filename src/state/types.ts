import type {
  GridObject,
  RWRContact,
  StarSystemData,
  StarSystemGenerationConfig,
  StarSystemSnapshot,
  WarpState,
} from '@/types/game'
import type { NetworkShipSnapshot } from '@/network/colyseusClient'

export interface ShipState {
  position: [number, number, number]
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
  actualInclination: number
  dacPitch: number
  rollAngle: number
  thermalSignature: number
  radioSignature: number
  irstMode: 'BHOT' | 'WHOT'
  laserRange: number
  irstZoom: number
  irstBearing: number
  irstInclination: number
}

export type EnemyRadarMode = 'off' | 'scan' | 'stt' | 'deception'

export interface EnemyState {
  thrustersOn: boolean
  shieldsUp: boolean
  speed: number
  heading: number
  radarMode: EnemyRadarMode
  position: [number, number, number]
  missileLaunched: boolean
}

export interface EwJammerState {
  mode: string | null
  active: boolean
  freq: number
}

export type NavAttitudeMode = 'AA' | 'DAC'

export interface GameStore {
  starSystem: StarSystemData
  starSystemSeed: number
  starSystemConfig: StarSystemGenerationConfig
  currentCelestialId: string
  debugPivotEnabled: boolean
  orientDebugEnabled: boolean
  showIRSTCone: boolean
  debugPivotPosition: [number, number, number]
  debugPivotDragging: boolean
  debugPivotResetCount: number
  localPlayerId: string
  shipsById: Record<string, ShipState>
  ship: ShipState
  enemy: EnemyState
  warpState: WarpState
  warpTargetId: string | null
  selectedTargetId: string | null
  selectedWarpDestinationId: string | null
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
  ewJammers: EwJammerState[]
  setEwJammers: (jammers: EwJammerState[]) => void
  setEwLockState: (updater: (prev: Record<string, 'soft' | 'hard'>) => Record<string, 'soft' | 'hard'>) => void
  setEwIffState: (updater: (prev: Record<string, string>) => Record<string, string>) => void
  setEwRadar: (partial: Partial<{ radarOn: boolean; radarMode: string; radarPower: number; radarFreq: number; radarPRF: string }>) => void
  setRwrContacts: (contacts: RWRContact[]) => void
  setEnemyState: (partial: Partial<EnemyState>) => void
  setStarSystemSnapshot: (snapshot: StarSystemSnapshot) => void
  setCurrentCelestial: (id: string) => void
  setDebugPivotEnabled: (enabled: boolean) => void
  setOrientDebugEnabled: (enabled: boolean) => void
  setShowIRSTCone: (enabled: boolean) => void
  setDebugPivotPosition: (position: [number, number, number]) => void
  setDebugPivotDragging: (dragging: boolean) => void
  resetDebugPivot: () => void
  setWarpState: (state: WarpState, targetId?: string | null) => void
  setSelectedTarget: (id: string | null) => void
  setSelectedWarpDestination: (id: string | null) => void
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
  asteroidBeltThickness: number
  asteroidBeltJitter: number
  asteroidBeltDensity: number
  asteroidBeltArcLength: number
  asteroidBeltRadius: number
  asteroidBeltMinSize: number
  asteroidBeltMaxSize: number
  asteroidBeltSpawnNonce: number
  setAsteroidBeltSettings: (partial: Partial<{
    thickness: number
    jitter: number
    density: number
    arcLength: number
    radius: number
    sizeMin: number
    sizeMax: number
  }>) => void
  spawnAsteroidBelt: () => void
  setLocalPlayerId: (id: string) => void
  setLocalShipState: (partial: Partial<ShipState>) => void
  upsertRemoteShips: (snapshot: Record<string, NetworkShipSnapshot>) => void
  setShipState: (partial: Partial<ShipState>) => void
  setTargetSpeed: (mps: number) => void
  setMwdActive: (active: boolean) => void
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
