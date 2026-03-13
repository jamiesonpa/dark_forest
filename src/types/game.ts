export type CelestialType = 'star' | 'planet' | 'moon' | 'station' | 'stargate' | 'asteroid_belt'

export interface Celestial {
  id: string
  name: string
  type: CelestialType
  position: [number, number, number]
  gridRadius: number
  radius?: number
}

export interface StarSystemData {
  id: string
  name: string
  celestials: Celestial[]
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
  /** Signal strength 1–10 (1 = faint search, 10 = missile terminal guidance) */
  signalStrength: number
  /** True if this emitter has single-target-tracked (locked) us */
  sttLock: boolean
}
