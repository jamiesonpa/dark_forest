export type CelestialType = 'star' | 'planet' | 'moon' | 'asteroid_belt'

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

export interface StarSystemGenerationConfig {
  seed: number
  planetCount: number
  moonCount: number
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
