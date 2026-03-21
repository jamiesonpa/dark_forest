import { B_SCOPE_AZ_LIMIT_DEG, bScopeRadarDetectionRangeM } from '@/systems/ew/bScopeConstants'

/** Delegates to shared B-scope power→range curve (uses default PRF = LOW → 500 km full-power cap). */
export function npcRadarDetectionRangeM(radarPowerPct: number): number {
  return bScopeRadarDetectionRangeM(radarPowerPct)
}

function shipForwardWorld(headingDeg: number, inclinationDeg: number): [number, number, number] {
  const headingRad = (headingDeg * Math.PI) / 180
  const inclinationRad = (inclinationDeg * Math.PI) / 180
  const cosInclination = Math.cos(inclinationRad)
  return [
    -Math.sin(headingRad) * cosInclination,
    Math.sin(inclinationRad),
    Math.cos(headingRad) * cosInclination,
  ]
}

/**
 * True if the player lies inside the NPC boresight cone (±`B_SCOPE_AZ_LIMIT_DEG` off axis)
 * and within horizontal range per `npcRadarDetectionRangeM`, matching the debug B-scope cone.
 */
export function isPlayerInNpcBScopeRadarCone(params: {
  npcPosition: readonly [number, number, number]
  npcHeadingDeg: number
  npcInclinationDeg: number
  playerPosition: readonly [number, number, number]
  radarPowerPct: number
}): boolean {
  const { npcPosition, npcHeadingDeg, npcInclinationDeg, playerPosition, radarPowerPct } = params
  if (radarPowerPct <= 0) return false
  const dx = playerPosition[0] - npcPosition[0]
  const dy = playerPosition[1] - npcPosition[1]
  const dz = playerPosition[2] - npcPosition[2]
  const rangeHoriz = Math.hypot(dx, dz)
  const maxR = npcRadarDetectionRangeM(radarPowerPct)
  if (rangeHoriz > maxR) return false

  const [fx, fy, fz] = shipForwardWorld(npcHeadingDeg, npcInclinationDeg)
  const len3 = Math.hypot(dx, dy, dz)
  if (len3 < 1e-6) return false
  const ux = dx / len3
  const uy = dy / len3
  const uz = dz / len3
  const dot = fx * ux + fy * uy + fz * uz
  const clamped = Math.max(-1, Math.min(1, dot))
  const angleDeg = (Math.acos(clamped) * 180) / Math.PI
  return angleDeg <= B_SCOPE_AZ_LIMIT_DEG
}
