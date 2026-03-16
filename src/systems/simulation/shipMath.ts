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
  ewGravScannerOn: boolean
  dampenersActive: boolean
  dampenersJustReengaged: boolean
  actualSpeed: number
  maxSelectedSpeed: number
  drainTimeAtMaxSpeedSec: number
  rechargeFractionOfMaxDrain: number
  dampenersDrainFractionOfMaxDrain: number
  dampenersReengageCapDrainPerMps: number
  dt: number
}

export function getNextCapacitor(input: CapacitorFrameInput) {
  const capacitorDrainPerSecondAtMaxSpeed = input.capacitorMax / input.drainTimeAtMaxSpeedSec
  const gravScannerRechargeBonus = input.ewGravScannerOn ? 1 : 1.1
  const capacitorRechargePerSecond =
    capacitorDrainPerSecondAtMaxSpeed * input.rechargeFractionOfMaxDrain * gravScannerRechargeBonus
  const capacitorDrain = capacitorDrainPerSecondAtMaxSpeed * input.selectedSpeedRatio
  const dampenersDrainPerSecond = input.dampenersActive
    ? capacitorDrainPerSecondAtMaxSpeed * input.dampenersDrainFractionOfMaxDrain
    : 0
  const dampenersReengageDrain = input.dampenersJustReengaged
    ? clamp(
        Math.max(0, input.actualSpeed - input.maxSelectedSpeed) *
          input.dampenersReengageCapDrainPerMps *
          input.capacitorMax,
        0,
        input.capacitorMax
      )
    : 0
  const capacitorDelta =
    (capacitorRechargePerSecond - capacitorDrain - dampenersDrainPerSecond) * input.dt

  return clamp(
    input.capacitor - dampenersReengageDrain + capacitorDelta,
    0,
    input.capacitorMax
  )
}
