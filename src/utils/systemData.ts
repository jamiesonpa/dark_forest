import type { StarSystemData, Celestial } from '@/types/game'

export const STAR_SYSTEM: StarSystemData = {
  id: 'df-1',
  name: 'Dark Forest I',
  celestials: [
    {
      id: 'star',
      name: 'Dark Forest Prime',
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
      position: [-12000, 8000, 0],
      gridRadius: 2000,
      radius: 350,
    },
    {
      id: 'station',
      name: 'Central Station',
      type: 'station',
      position: [5000, 5000, 3000],
      gridRadius: 1500,
      radius: 80,
    },
    {
      id: 'gate',
      name: 'Stargate Alpha',
      type: 'stargate',
      position: [-8000, -6000, 0],
      gridRadius: 1000,
      radius: 120,
    },
    {
      id: 'belt',
      name: 'Asteroid Belt',
      type: 'asteroid_belt',
      position: [0, -10000, 5000],
      gridRadius: 3000,
      radius: 200,
    },
  ],
}

export function getCelestialById(id: string): Celestial | undefined {
  return STAR_SYSTEM.celestials.find((c) => c.id === id)
}

export function getCelestialPosition(c: Celestial): [number, number, number] {
  return [...c.position]
}
