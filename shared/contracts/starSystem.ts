export type CelestialType = 'star' | 'planet' | 'asteroid_belt'

export interface OrbitalElements {
  semiMajorAxisAu: number
  eccentricity: number
  inclinationDeg: number
  ascendingNodeDeg: number
  argumentOfPeriapsisDeg: number
  trueAnomalyDeg: number
}

export interface Celestial {
  id: string
  name: string
  type: CelestialType
  position: [number, number, number]
  gridRadius: number
  radius?: number
  orbitalElements?: OrbitalElements
}

export interface StarSystemData {
  id: string
  name: string
  celestials: Celestial[]
}

export interface StarSystemGenerationConfig {
  seed: number
  planetCount: number
  asteroidBeltCount: number
  minOrbitAu: number
  maxOrbitAu: number
  minSeparationAu: number
}

export interface StarSystemSnapshot {
  system: StarSystemData
  seed: number
  config: StarSystemGenerationConfig
}

export type WarpState = 'idle' | 'aligning' | 'warping' | 'landing'

export interface GridObject {
  id: string
  name: string
  type: 'ship' | 'celestial' | 'structure'
  position: [number, number, number]
  distance?: number
}

export type ThreatType = 'S' | 'A' | 'M' | 'U' | '2' | '4' | '8' | '10' | '15' | '20'

export interface RWRContact {
  id: string
  symbol: ThreatType
  bearing: number
  relativeElevation: number
  priority: 'critical' | 'high' | 'low'
  newContact: boolean
  signalStrength: number
  sttLock: boolean
}
