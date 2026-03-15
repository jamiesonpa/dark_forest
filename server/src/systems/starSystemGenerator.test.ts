import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAR_SYSTEM_CONFIG,
  generateStarSystemSnapshot,
  getFarthestWarpablePair,
  getWarpableCelestials,
} from './starSystemGenerator.js'

describe('starSystemGenerator', () => {
  it('is deterministic for same seed and config', () => {
    const config = {
      ...DEFAULT_STAR_SYSTEM_CONFIG,
      seed: 42,
      planetCount: 3,
      moonCount: 1,
      asteroidBeltCount: 2,
    }
    const a = generateStarSystemSnapshot(config)
    const b = generateStarSystemSnapshot(config)
    expect(a).toEqual(b)
  })

  it('changes layout when seed changes', () => {
    const a = generateStarSystemSnapshot({
      ...DEFAULT_STAR_SYSTEM_CONFIG,
      seed: 77,
    })
    const b = generateStarSystemSnapshot({
      ...DEFAULT_STAR_SYSTEM_CONFIG,
      seed: 78,
    })
    expect(a.system.celestials).not.toEqual(b.system.celestials)
  })

  it('always generates one star and at least two warpables', () => {
    const generated = generateStarSystemSnapshot({
      ...DEFAULT_STAR_SYSTEM_CONFIG,
      planetCount: 0,
      moonCount: 0,
      asteroidBeltCount: 0,
    })
    const stars = generated.system.celestials.filter((c) => c.type === 'star')
    const warpables = getWarpableCelestials(generated.system)
    expect(stars).toHaveLength(1)
    expect(warpables.length).toBeGreaterThanOrEqual(2)
  })

  it('returns the true farthest warpable pair', () => {
    const generated = generateStarSystemSnapshot({
      ...DEFAULT_STAR_SYSTEM_CONFIG,
      seed: 90210,
      planetCount: 4,
      moonCount: 2,
      asteroidBeltCount: 1,
    })
    const pair = getFarthestWarpablePair(generated.system)
    const warpables = getWarpableCelestials(generated.system)
    expect(pair).not.toBeNull()
    if (!pair) return

    const pairDistSq =
      (pair[0].position[0] - pair[1].position[0]) ** 2 +
      (pair[0].position[1] - pair[1].position[1]) ** 2 +
      (pair[0].position[2] - pair[1].position[2]) ** 2
    let maxDistSq = -1
    for (let i = 0; i < warpables.length; i += 1) {
      for (let j = i + 1; j < warpables.length; j += 1) {
        const distSq =
          (warpables[i].position[0] - warpables[j].position[0]) ** 2 +
          (warpables[i].position[1] - warpables[j].position[1]) ** 2 +
          (warpables[i].position[2] - warpables[j].position[2]) ** 2
        if (distSq > maxDistSq) {
          maxDistSq = distSq
        }
      }
    }
    expect(pairDistSq).toBe(maxDistSq)
  })
})
