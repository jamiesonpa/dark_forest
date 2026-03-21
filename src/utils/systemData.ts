import type {
  StarSystemData,
  Celestial,
  StarSystemGenerationConfig,
  StarSystemSnapshot,
} from '@/types/game'
import { generatePrimaryStarDesignationFromSeed } from '../../shared/starDesignation'

export const DEFAULT_STAR_SYSTEM_CONFIG: StarSystemGenerationConfig = {
  seed: 1337,
  planetCount: 2,
  asteroidBeltCount: 1,
  minOrbitAu: 60,
  maxOrbitAu: 220,
  minSeparationAu: 35,
}

const defaultPrimaryStarName = generatePrimaryStarDesignationFromSeed(
  DEFAULT_STAR_SYSTEM_CONFIG.seed
)

export const STAR_SYSTEM: StarSystemData = {
  id: 'df-1',
  name: 'Dark Forest I',
  celestials: [
    {
      id: 'star',
      name: defaultPrimaryStarName,
      type: 'star',
      position: [0, 0, 0],
      gridRadius: 5000,
      radius: 800,
    },
    {
      id: 'planet-1',
      name: 'Planet I',
      type: 'planet',
      position: [15000, 0, 0],
      gridRadius: 2000,
      radius: 400,
    },
    {
      id: 'planet-2',
      name: 'Planet II',
      type: 'planet',
      position: [-12000, 0, 8000],
      gridRadius: 2000,
      radius: 350,
    },
    {
      id: 'belt',
      name: 'Asteroid Belt',
      type: 'asteroid_belt',
      position: [0, 0, -12000],
      gridRadius: 3000,
      radius: 200,
    },
  ],
}

export const DEFAULT_STAR_SYSTEM_SNAPSHOT: StarSystemSnapshot = {
  system: STAR_SYSTEM,
  seed: DEFAULT_STAR_SYSTEM_CONFIG.seed,
  config: DEFAULT_STAR_SYSTEM_CONFIG,
}

export function getCelestialById(
  id: string,
  starSystem: StarSystemData = STAR_SYSTEM
): Celestial | undefined {
  return starSystem.celestials.find((c) => c.id === id)
}

export function getCelestialPosition(c: Celestial): [number, number, number] {
  return [...c.position]
}
