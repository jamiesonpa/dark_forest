import { describe, expect, it } from 'vitest'
import { getNextCapacitor, getThrustAuthority, normalizeSigned180 } from '@/systems/simulation/shipMath'

describe('shipMath', () => {
  it('normalizes signed 180-degree angles', () => {
    expect(normalizeSigned180(270)).toBe(-90)
    expect(normalizeSigned180(-270)).toBe(90)
  })

  it('computes thrust authority from capacitor fraction', () => {
    expect(getThrustAuthority(50, 100, 0.1)).toEqual({
      capacitorFraction: 0.5,
      thrustAuthority: 1,
    })

    const lowCapAuthority = getThrustAuthority(2, 100, 0.1)
    expect(lowCapAuthority.capacitorFraction).toBe(0.02)
    expect(lowCapAuthority.thrustAuthority).toBeCloseTo(0.2)
  })

  it('recharges capacitor when thrust demand is low', () => {
    const next = getNextCapacitor({
      capacitor: 200,
      capacitorMax: 800,
      selectedSpeedRatio: 0,
      ewGravScannerOn: true,
      dampenersActive: true,
      dampenersJustReengaged: false,
      actualSpeed: 100,
      maxSelectedSpeed: 215,
      drainTimeAtMaxSpeedSec: 120,
      rechargeFractionOfMaxDrain: 0.6,
      dampenersDrainFractionOfMaxDrain: 0.15,
      dampenersReengageCapDrainPerMps: 0.0005,
      dt: 1,
    })

    expect(next).toBeGreaterThan(200)
    expect(next).toBeLessThanOrEqual(800)
  })
})
