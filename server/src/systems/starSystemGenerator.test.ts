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

  it('generates warpables with varied inclinations', () => {
    const generated = generateStarSystemSnapshot({
      ...DEFAULT_STAR_SYSTEM_CONFIG,
      seed: 501,
      planetCount: 6,
      asteroidBeltCount: 2,
    })
    const warpables = getWarpableCelestials(generated.system)
    expect(warpables.length).toBeGreaterThanOrEqual(2)
    const inclinations = warpables
      .map((warpable) => warpable.orbitalElements?.inclinationDeg ?? 0)
      .map((deg) => Math.round(Math.abs(deg) * 10) / 10)
    const uniqueInclinations = new Set(inclinations)
    expect(uniqueInclinations.size).toBeGreaterThan(1)
    expect(inclinations.some((deg) => deg > 0.5)).toBe(true)

    const maxAbsY = Math.max(...warpables.map((warpable) => Math.abs(warpable.position[1])))
    expect(maxAbsY).toBeGreaterThan(250)
  })

  it('uses circular orbits (no eccentricity)', () => {
    const generated = generateStarSystemSnapshot({
      ...DEFAULT_STAR_SYSTEM_CONFIG,
      seed: 77,
      planetCount: 5,
      asteroidBeltCount: 2,
    })
    const warpables = getWarpableCelestials(generated.system)
    const eccentricities = warpables.map((warpable) => warpable.orbitalElements?.eccentricity ?? 0)
    expect(eccentricities.every((value) => Math.abs(value) < 0.000001)).toBe(true)
  })

  it('pins planet-1 to 0 inclination and keeps all bodies within 30 degrees', () => {
    const generated = generateStarSystemSnapshot({
      ...DEFAULT_STAR_SYSTEM_CONFIG,
      seed: 2026,
      planetCount: 5,
      asteroidBeltCount: 2,
    })
    const warpables = getWarpableCelestials(generated.system)
    const planetOne = warpables.find((warpable) => warpable.id === 'planet-1')
    expect(planetOne).toBeDefined()
    expect(Math.abs(planetOne?.orbitalElements?.inclinationDeg ?? 999)).toBeLessThan(0.001)

    for (const warpable of warpables) {
      const inclinationDeg = warpable.orbitalElements?.inclinationDeg ?? 0
      expect(Math.abs(inclinationDeg)).toBeLessThanOrEqual(30)
    }
  })

  it('keeps semi-major axes separated by minimum configured gap', () => {
    const config = {
      ...DEFAULT_STAR_SYSTEM_CONFIG,
      seed: 31415,
      planetCount: 6,
      asteroidBeltCount: 2,
      minOrbitAu: 60,
      maxOrbitAu: 260,
      minSeparationAu: 22,
    }
    const generated = generateStarSystemSnapshot(config)
    const warpables = getWarpableCelestials(generated.system)
      .map((warpable) => ({
        id: warpable.id,
        semiMajorAxisAu: warpable.orbitalElements?.semiMajorAxisAu ?? 0,
      }))
      .sort((a, b) => a.semiMajorAxisAu - b.semiMajorAxisAu)

    for (let i = 0; i < warpables.length - 1; i += 1) {
      const inner = warpables[i]
      const outer = warpables[i + 1]
      expect(outer.semiMajorAxisAu - inner.semiMajorAxisAu).toBeGreaterThanOrEqual(config.minSeparationAu - 0.001)
    }
  })
})
