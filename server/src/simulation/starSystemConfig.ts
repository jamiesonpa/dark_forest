import {
  DEFAULT_STAR_SYSTEM_CONFIG,
  generateStarSystemSnapshot,
} from '../systems/starSystemGenerator.js'
import type { StarSystemGenerationConfig, StarSystemSnapshot } from '../types/starSystem.js'

function parseEnvInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export function getStartupStarSystemConfig(): StarSystemGenerationConfig {
  return {
    ...DEFAULT_STAR_SYSTEM_CONFIG,
    seed: parseEnvInt(process.env.DF_STAR_SYSTEM_SEED, DEFAULT_STAR_SYSTEM_CONFIG.seed, 0, 9999),
    planetCount: parseEnvInt(process.env.DF_STAR_SYSTEM_PLANETS, DEFAULT_STAR_SYSTEM_CONFIG.planetCount, 0, 3),
    asteroidBeltCount: parseEnvInt(
      process.env.DF_STAR_SYSTEM_BELTS,
      DEFAULT_STAR_SYSTEM_CONFIG.asteroidBeltCount,
      0,
      3
    ),
  }
}

export function buildStarSystemSnapshot(input: Partial<StarSystemGenerationConfig> | undefined): StarSystemSnapshot {
  return generateStarSystemSnapshot({
    ...DEFAULT_STAR_SYSTEM_CONFIG,
    ...(input ?? {}),
  })
}
