export const B_SCOPE_RANGE_OPTIONS_KM = [10, 25, 50, 100, 160, 250, 500] as const
export const B_SCOPE_AZ_LIMIT_DEG = 60

/** Furthest ring on the B-scope range control (m). */
export const B_SCOPE_ABSOLUTE_MAX_RANGE_M = Math.max(...B_SCOPE_RANGE_OPTIONS_KM) * 1000

/** Max horizontal reach (km) at 100% power by PRF — higher PRF ⇒ shorter unambiguous range. */
export const B_SCOPE_PRF_MAX_RANGE_KM = {
  LOW: 500,
  MED: 250,
  HIGH: 100,
} as const

/** Meters; unknown PRF → MED. */
export function bScopeMaxRangeMForPrf(prf: string): number {
  const km =
    prf === 'LOW'
      ? B_SCOPE_PRF_MAX_RANGE_KM.LOW
      : prf === 'HIGH'
        ? B_SCOPE_PRF_MAX_RANGE_KM.HIGH
        : B_SCOPE_PRF_MAX_RANGE_KM.MED
  return km * 1000
}

/**
 * Power→range shaping: `rangeFraction = u ** this`, where `u = powerPct / 100`.
 * Values **> 1** pack more of max range into the **upper** half of the slider so
 * low power is easier to tune (similar to “first half of the knob → first ~10% of range”
 * without hardcoding breakpoints). Raise for finer control at low power; lower toward linear.
 */
export const B_SCOPE_RANGE_POWER_CURVE_EXPONENT = 3.35

/**
 * Fraction of PRF max range at this power (0…1).
 * 0% power → 0; 100% → 1; curve controlled by {@link B_SCOPE_RANGE_POWER_CURVE_EXPONENT}.
 */
export function bScopeRadarPowerToRangeFraction(radarPowerPct: number): number {
  const u = Math.max(0, Math.min(1, radarPowerPct / 100))
  if (u <= 0) return 0
  return u ** B_SCOPE_RANGE_POWER_CURVE_EXPONENT
}

/**
 * Horizontal radar reach (m) from power % and PRF.
 * Default PRF `LOW` (500 km cap) keeps single-arg call sites (e.g. NPC) at the previous global max.
 */
export function bScopeRadarDetectionRangeM(radarPowerPct: number, prf = 'LOW'): number {
  const p = Math.max(0, Math.min(100, radarPowerPct))
  return bScopeMaxRangeMForPrf(prf) * bScopeRadarPowerToRangeFraction(p)
}
