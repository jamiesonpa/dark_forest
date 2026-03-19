import { clamp } from '@/systems/simulation/lib/math'

export function normalizeSigned180(value: number) {
  const wrapped = ((value % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}

export function getThrustAuthority(
  capacitor: number,
  capacitorMax: number,
  fullAuthorityCapFraction: number
) {
  const capacitorFraction = capacitorMax > 0
    ? clamp(capacitor / capacitorMax, 0, 1)
    : 0

  return {
    capacitorFraction,
    thrustAuthority: clamp(capacitorFraction / fullAuthorityCapFraction, 0, 1),
  }
}

type CapacitorFrameInput = {
  capacitor: number
  capacitorMax: number
  selectedSpeedRatio: number
  sensorSystemsOfflineCount: number
  radarPowerPct: number
  dampenersActive: boolean
  drainTimeAtMaxSpeedSec: number
  rechargeFractionOfMaxDrain: number
  dampenersDrainFractionOfMaxDrain: number
  dampenersRecoveryDrain: number
  dt: number
}

export function getNextCapacitor(input: CapacitorFrameInput) {
  const capacitorDrainPerSecondAtMaxSpeed = input.capacitorMax / input.drainTimeAtMaxSpeedSec
  const sensorSystemsOfflineCount = clamp(input.sensorSystemsOfflineCount, 0, 3)
  const scannerRechargeBonus = 1 + sensorSystemsOfflineCount * 0.1
  const radarPowerNorm = clamp(input.radarPowerPct, 0, 100) / 100
  const radarLowPowerRechargeBonus = 1 + (1 - radarPowerNorm) * 0.2
  const capacitorRechargePerSecond =
    capacitorDrainPerSecondAtMaxSpeed
    * input.rechargeFractionOfMaxDrain
    * scannerRechargeBonus
    * radarLowPowerRechargeBonus
  const capacitorDrain = capacitorDrainPerSecondAtMaxSpeed * input.selectedSpeedRatio
  const dampenersDrainPerSecond = input.dampenersActive
    ? capacitorDrainPerSecondAtMaxSpeed * input.dampenersDrainFractionOfMaxDrain
    : 0
  const capacitorDelta =
    (capacitorRechargePerSecond - capacitorDrain - dampenersDrainPerSecond) * input.dt

  return clamp(
    input.capacitor - input.dampenersRecoveryDrain + capacitorDelta,
    0,
    input.capacitorMax
  )
}

type ShieldRechargeFrameInput = {
  shieldsUp: boolean
  shield: number
  shieldMax: number
  shieldRechargeRatePct: number
  capacitor: number
  capacitorMax: number
  maxShieldRechargePerSecondAt100Pct: number
  maxCapDrainFractionPerSecondAt100Pct: number
  dt: number
}

export function getShieldRechargeFrame(input: ShieldRechargeFrameInput) {
  const rechargeRateFraction = clamp(input.shieldRechargeRatePct / 100, 0, 1)
  const shieldDeficit = Math.max(0, input.shieldMax - input.shield)
  const shouldRecharge =
    input.shieldsUp &&
    rechargeRateFraction > 0 &&
    shieldDeficit > 0 &&
    input.shieldMax > 0 &&
    input.capacitorMax > 0
  if (!shouldRecharge) {
    return {
      shield: clamp(input.shield, 0, input.shieldMax),
      capacitor: clamp(input.capacitor, 0, input.capacitorMax),
      shieldRechargeApplied: 0,
      shieldCapDrainApplied: 0,
    }
  }

  const requestedShieldRecharge = Math.min(
    shieldDeficit,
    input.maxShieldRechargePerSecondAt100Pct * rechargeRateFraction * input.dt
  )
  const requestedCapDrain =
    input.capacitorMax *
    input.maxCapDrainFractionPerSecondAt100Pct *
    rechargeRateFraction *
    input.dt
  if (requestedShieldRecharge <= 0 || requestedCapDrain <= 0) {
    return {
      shield: clamp(input.shield, 0, input.shieldMax),
      capacitor: clamp(input.capacitor, 0, input.capacitorMax),
      shieldRechargeApplied: 0,
      shieldCapDrainApplied: 0,
    }
  }

  const shieldCapDrainApplied = Math.min(input.capacitor, requestedCapDrain)
  const rechargeEfficiency = clamp(shieldCapDrainApplied / requestedCapDrain, 0, 1)
  const shieldRechargeApplied = requestedShieldRecharge * rechargeEfficiency

  return {
    shield: clamp(input.shield + shieldRechargeApplied, 0, input.shieldMax),
    capacitor: clamp(input.capacitor - shieldCapDrainApplied, 0, input.capacitorMax),
    shieldRechargeApplied,
    shieldCapDrainApplied,
  }
}
