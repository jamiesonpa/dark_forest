import type {
  Celestial,
  CelestialType,
  StarSystemData,
  StarSystemGenerationConfig,
  StarSystemSnapshot,
} from '../types/starSystem.js'

export const WORLD_UNITS_PER_AU = 140

export const DEFAULT_STAR_SYSTEM_CONFIG: StarSystemGenerationConfig = {
  seed: 1337,
  planetCount: 2,
  moonCount: 0,
  asteroidBeltCount: 1,
  minOrbitAu: 60,
  maxOrbitAu: 220,
  minSeparationAu: 35,
}

const CELESTIAL_NAMES: Record<Exclude<CelestialType, 'star'>, string> = {
  planet: 'Planet',
  moon: 'Moon',
  asteroid_belt: 'Belt',
}

const GRID_RADIUS_BY_TYPE: Record<Exclude<CelestialType, 'star'>, number> = {
  planet: 2000,
  moon: 1200,
  asteroid_belt: 3000,
}

const RADIUS_BY_TYPE: Record<Exclude<CelestialType, 'star'>, number> = {
  planet: 360,
  moon: 180,
  asteroid_belt: 220,
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function clampFloat(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function safeNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let n = Math.imul(t ^ (t >>> 15), 1 | t)
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n)
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296
  }
}

function randomRange(rand: () => number, min: number, max: number) {
  return min + (max - min) * rand()
}

function shuffleInPlace<T>(arr: T[], rand: () => number) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const swap = arr[i]
    arr[i] = arr[j]
    arr[j] = swap
  }
}

export function normalizeGenerationConfig(
  input: Partial<StarSystemGenerationConfig> | undefined
): StarSystemGenerationConfig {
  const merged = {
    ...DEFAULT_STAR_SYSTEM_CONFIG,
    ...(input ?? {}),
  }
  return {
    seed: clampInt(safeNumber(merged.seed, DEFAULT_STAR_SYSTEM_CONFIG.seed), 1, 2_147_483_647),
    planetCount: clampInt(safeNumber(merged.planetCount, DEFAULT_STAR_SYSTEM_CONFIG.planetCount), 0, 10),
    moonCount: clampInt(safeNumber(merged.moonCount, DEFAULT_STAR_SYSTEM_CONFIG.moonCount), 0, 12),
    asteroidBeltCount: clampInt(safeNumber(merged.asteroidBeltCount, DEFAULT_STAR_SYSTEM_CONFIG.asteroidBeltCount), 0, 8),
    minOrbitAu: clampFloat(safeNumber(merged.minOrbitAu, DEFAULT_STAR_SYSTEM_CONFIG.minOrbitAu), 10, 5000),
    maxOrbitAu: clampFloat(safeNumber(merged.maxOrbitAu, DEFAULT_STAR_SYSTEM_CONFIG.maxOrbitAu), 20, 7000),
    minSeparationAu: clampFloat(safeNumber(merged.minSeparationAu, DEFAULT_STAR_SYSTEM_CONFIG.minSeparationAu), 1, 1500),
  }
}

function buildWarpableTypeList(config: StarSystemGenerationConfig) {
  const list: Array<Exclude<CelestialType, 'star'>> = []
  for (let i = 0; i < config.planetCount; i += 1) list.push('planet')
  for (let i = 0; i < config.moonCount; i += 1) list.push('moon')
  for (let i = 0; i < config.asteroidBeltCount; i += 1) list.push('asteroid_belt')
  return list
}

function sampleSeparatedOrbits(
  count: number,
  minOrbitAu: number,
  maxOrbitAu: number,
  minSeparationAu: number,
  rand: () => number
) {
  if (count <= 0) return []
  const sorted: number[] = []
  let attempts = 0
  const maxAttempts = Math.max(300, count * 120)
  while (sorted.length < count && attempts < maxAttempts) {
    attempts += 1
    const candidate = randomRange(rand, minOrbitAu, maxOrbitAu)
    const tooClose = sorted.some((value) => Math.abs(value - candidate) < minSeparationAu)
    if (!tooClose) {
      sorted.push(candidate)
      sorted.sort((a, b) => a - b)
    }
  }

  if (sorted.length < count) {
    const range = Math.max(minSeparationAu * (count + 1), maxOrbitAu - minOrbitAu)
    const safeMax = minOrbitAu + range
    for (let i = 0; i < count; i += 1) {
      sorted[i] = minOrbitAu + ((i + 1) / (count + 1)) * (safeMax - minOrbitAu)
    }
  }
  return sorted
}

export function generateStarSystemSnapshot(
  partialConfig: Partial<StarSystemGenerationConfig> | undefined
): StarSystemSnapshot {
  const normalized = normalizeGenerationConfig(partialConfig)
  const rand = mulberry32(normalized.seed)
  const warpableTypes = buildWarpableTypeList(normalized)
  const minimumWarpableCount = Math.max(2, warpableTypes.length)
  while (warpableTypes.length < minimumWarpableCount) {
    warpableTypes.push('planet')
  }
  shuffleInPlace(warpableTypes, rand)

  const minOrbit = Math.min(normalized.minOrbitAu, normalized.maxOrbitAu)
  const maxOrbit = Math.max(normalized.minOrbitAu, normalized.maxOrbitAu)
  const orbitsAu = sampleSeparatedOrbits(
    warpableTypes.length,
    minOrbit,
    maxOrbit,
    normalized.minSeparationAu,
    rand
  )
  const celestials: Celestial[] = [
    {
      id: 'star',
      name: 'Dark Forest Prime',
      type: 'star',
      position: [0, 0, 0],
      gridRadius: 5000,
      radius: 800,
    },
  ]

  const counters: Record<Exclude<CelestialType, 'star'>, number> = {
    planet: 0,
    moon: 0,
    asteroid_belt: 0,
  }

  warpableTypes.forEach((type, index) => {
    counters[type] += 1
    const orbitAu = orbitsAu[index] ?? (minOrbit + maxOrbit) / 2
    const azimuth = randomRange(rand, 0, Math.PI * 2)
    const elevation = randomRange(rand, -0.18, 0.18)
    const orbitUnits = orbitAu * WORLD_UNITS_PER_AU
    const horizontal = orbitUnits * Math.cos(elevation)
    const x = Math.cos(azimuth) * horizontal
    const y = Math.sin(elevation) * orbitUnits
    const z = Math.sin(azimuth) * horizontal
    const typePrefix = type === 'asteroid_belt' ? 'belt' : type
    const id = `${typePrefix}-${counters[type]}`
    celestials.push({
      id,
      name: `${CELESTIAL_NAMES[type]} ${counters[type]}`,
      type,
      position: [Math.round(x), Math.round(y), Math.round(z)],
      gridRadius: GRID_RADIUS_BY_TYPE[type],
      radius: RADIUS_BY_TYPE[type],
    })
  })

  const system: StarSystemData = {
    id: `df-${normalized.seed}`,
    name: 'Dark Forest Procedural',
    celestials,
  }

  return {
    system,
    seed: normalized.seed,
    config: normalized,
  }
}

function distanceSquared(a: Celestial, b: Celestial) {
  const dx = a.position[0] - b.position[0]
  const dy = a.position[1] - b.position[1]
  const dz = a.position[2] - b.position[2]
  return dx * dx + dy * dy + dz * dz
}

export function getWarpableCelestials(system: StarSystemData) {
  return system.celestials.filter((c) => c.type !== 'star')
}

export function getFarthestWarpablePair(system: StarSystemData): [Celestial, Celestial] | null {
  const warpables = getWarpableCelestials(system)
  if (warpables.length < 2) return null
  let bestPair: [Celestial, Celestial] = [warpables[0], warpables[1]]
  let bestDistanceSq = distanceSquared(bestPair[0], bestPair[1])
  for (let i = 0; i < warpables.length; i += 1) {
    for (let j = i + 1; j < warpables.length; j += 1) {
      const candidateDistanceSq = distanceSquared(warpables[i], warpables[j])
      if (candidateDistanceSq > bestDistanceSq) {
        bestDistanceSq = candidateDistanceSq
        bestPair = [warpables[i], warpables[j]]
      }
    }
  }
  return bestPair
}
