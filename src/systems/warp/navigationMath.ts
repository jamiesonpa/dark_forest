import type { Celestial } from '@/types/game'

// Gameplay scale: 1 AU is compressed to world units for readable HUD distances.
// Tuned so current celestial separations are in the ~100+ AU range.
export const WORLD_UNITS_PER_AU = 140
export const WARP_ALIGNMENT_TOLERANCE_DEG = 2.5
// Design target: a 100 AU warp requires 25% capacitor.
export const WARP_CAPACITOR_FRACTION_PER_AU = 0.25 / 100

export function normalizeBearingDeg(value: number) {
  return ((value % 360) + 360) % 360
}

export function clampInclinationDeg(value: number) {
  return Math.max(-90, Math.min(90, value))
}

export function shortestAngleDeltaDeg(fromDeg: number, toDeg: number) {
  return ((toDeg - fromDeg + 540) % 360) - 180
}

export function worldPositionForCelestial(celestial: Celestial): [number, number, number] {
  return [...celestial.position]
}

export function vectorBetweenWorldPoints(
  fromPoint: readonly [number, number, number],
  toPoint: readonly [number, number, number]
): [number, number, number] {
  return [
    toPoint[0] - fromPoint[0],
    toPoint[1] - fromPoint[1],
    toPoint[2] - fromPoint[2],
  ]
}

export function vectorMagnitude(vector: readonly [number, number, number]) {
  return Math.hypot(vector[0], vector[1], vector[2])
}

export function bearingInclinationFromVector(vector: readonly [number, number, number]) {
  const [dx, dy, dz] = vector
  const horizMag = Math.hypot(dx, dz)
  // Ship heading uses a right-handed convention where +bearing turns visual
  // nose toward negative world-X, so invert X here to keep nav readouts aligned
  // with what the pilot sees in-cockpit.
  const bearing = normalizeBearingDeg((Math.atan2(-dx, dz) * 180) / Math.PI)
  const inclination = clampInclinationDeg((Math.atan2(dy, Math.max(0.000001, horizMag)) * 180) / Math.PI)
  return { bearing, inclination }
}

export function computeAlignmentErrorDeg(
  actualBearingDeg: number,
  actualInclinationDeg: number,
  requiredBearingDeg: number,
  requiredInclinationDeg: number
) {
  const bearingErrorDeg = Math.abs(shortestAngleDeltaDeg(actualBearingDeg, requiredBearingDeg))
  const inclinationErrorDeg = Math.abs(requiredInclinationDeg - actualInclinationDeg)
  const totalErrorDeg = Math.hypot(bearingErrorDeg, inclinationErrorDeg)
  return { totalErrorDeg, bearingErrorDeg, inclinationErrorDeg }
}

export function isWarpAligned(
  actualBearingDeg: number,
  actualInclinationDeg: number,
  requiredBearingDeg: number,
  requiredInclinationDeg: number,
  toleranceDeg = WARP_ALIGNMENT_TOLERANCE_DEG
) {
  const { totalErrorDeg, bearingErrorDeg, inclinationErrorDeg } = computeAlignmentErrorDeg(
    actualBearingDeg,
    actualInclinationDeg,
    requiredBearingDeg,
    requiredInclinationDeg
  )
  return {
    aligned: totalErrorDeg <= toleranceDeg,
    totalErrorDeg,
    bearingErrorDeg,
    inclinationErrorDeg,
  }
}

export function formatDistanceAu(distanceWorldUnits: number) {
  if (distanceWorldUnits <= 0) return '0 AU'
  return `${Math.max(1, Math.round(distanceWorldUnits / WORLD_UNITS_PER_AU))} AU`
}

export function getDistanceScaledWarpDurationMs(distanceWorldUnits: number) {
  const distanceAu = distanceWorldUnits / WORLD_UNITS_PER_AU
  const minMs = 3500
  const maxMs = 15000
  const normalized = Math.min(1, Math.max(0, Math.log10(1 + distanceAu) / 2.2))
  return Math.round(minMs + (maxMs - minMs) * normalized)
}

export function getWarpCapacitorRequiredFraction(distanceWorldUnits: number) {
  if (distanceWorldUnits <= 0) return 0
  const distanceAu = distanceWorldUnits / WORLD_UNITS_PER_AU
  return Math.max(0, Math.min(1, distanceAu * WARP_CAPACITOR_FRACTION_PER_AU))
}

export function getWarpCapacitorRequiredAmount(
  distanceWorldUnits: number,
  capacitorMax: number
) {
  if (capacitorMax <= 0) return 0
  return capacitorMax * getWarpCapacitorRequiredFraction(distanceWorldUnits)
}

export function getWorldShipPosition(
  shipLocalPosition: readonly [number, number, number],
  currentCelestialWorldPosition: readonly [number, number, number]
): [number, number, number] {
  return [
    currentCelestialWorldPosition[0] + shipLocalPosition[0],
    currentCelestialWorldPosition[1] + shipLocalPosition[1],
    currentCelestialWorldPosition[2] + shipLocalPosition[2],
  ]
}
