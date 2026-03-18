import { describe, expect, it } from 'vitest'
import {
  getNextCapacitor,
  getShieldRechargeFrame,
  getThrustAuthority,
  normalizeSigned180,
} from '@/systems/simulation/shipMath'

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
      scannerPanelsOfflineCount: 0,
      dampenersActive: true,
      drainTimeAtMaxSpeedSec: 120,
      rechargeFractionOfMaxDrain: 0.6,
      dampenersDrainFractionOfMaxDrain: 0.15,
      dampenersRecoveryDrain: 0,
      dt: 1,
    })

    expect(next).toBeGreaterThan(200)
    expect(next).toBeLessThanOrEqual(800)
  })

  it('applies capacitor recharge bonus for each offline scanner panel', () => {
    const baseInput = {
      capacitor: 200,
      capacitorMax: 800,
      selectedSpeedRatio: 0,
      dampenersActive: false,
      drainTimeAtMaxSpeedSec: 120,
      rechargeFractionOfMaxDrain: 0.6,
      dampenersDrainFractionOfMaxDrain: 0.15,
      dampenersRecoveryDrain: 0,
      dt: 1,
    }

    const baseRecharge = getNextCapacitor({
      ...baseInput,
      scannerPanelsOfflineCount: 0,
    }) - baseInput.capacitor
    const oneOfflineRecharge = getNextCapacitor({
      ...baseInput,
      scannerPanelsOfflineCount: 1,
    }) - baseInput.capacitor
    const twoOfflineRecharge = getNextCapacitor({
      ...baseInput,
      scannerPanelsOfflineCount: 2,
    }) - baseInput.capacitor

    expect(oneOfflineRecharge).toBeCloseTo(baseRecharge * 1.1)
    expect(twoOfflineRecharge).toBeCloseTo(baseRecharge * 1.2)
  })

  it('does not recharge or drain capacitor when shield recharge rate is zero', () => {
    const frame = getShieldRechargeFrame({
      shieldsUp: true,
      shield: 4000,
      shieldMax: 5000,
      shieldRechargeRatePct: 0,
      capacitor: 500,
      capacitorMax: 800,
      maxShieldRechargePerSecondAt100Pct: 100,
      maxCapDrainFractionPerSecondAt100Pct: 0.01,
      dt: 1,
    })

    expect(frame.shield).toBe(4000)
    expect(frame.capacitor).toBe(500)
    expect(frame.shieldRechargeApplied).toBe(0)
    expect(frame.shieldCapDrainApplied).toBe(0)
  })

  it('recharges 100 shield/s at 100% rate with 1% capacitor drain/s', () => {
    const frame = getShieldRechargeFrame({
      shieldsUp: true,
      shield: 4000,
      shieldMax: 5000,
      shieldRechargeRatePct: 100,
      capacitor: 500,
      capacitorMax: 800,
      maxShieldRechargePerSecondAt100Pct: 100,
      maxCapDrainFractionPerSecondAt100Pct: 0.01,
      dt: 1,
    })

    expect(frame.shield).toBe(4100)
    expect(frame.capacitor).toBe(492)
    expect(frame.shieldRechargeApplied).toBe(100)
    expect(frame.shieldCapDrainApplied).toBe(8)
  })

  it('does not drain capacitor at max shields', () => {
    const frame = getShieldRechargeFrame({
      shieldsUp: true,
      shield: 5000,
      shieldMax: 5000,
      shieldRechargeRatePct: 100,
      capacitor: 500,
      capacitorMax: 800,
      maxShieldRechargePerSecondAt100Pct: 100,
      maxCapDrainFractionPerSecondAt100Pct: 0.01,
      dt: 1,
    })

    expect(frame.shield).toBe(5000)
    expect(frame.capacitor).toBe(500)
    expect(frame.shieldRechargeApplied).toBe(0)
    expect(frame.shieldCapDrainApplied).toBe(0)
  })
})
