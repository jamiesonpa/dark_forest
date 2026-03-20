/** Visual beam pulse (fade in / hold / fade out) — keep in sync with `DewBeamEffects`. */
export const DEW_BEAM_VISUAL_LIFETIME_MS = 120 + 600 + 240

/** Smoke lingers in world space after the beam finishes. */
export const DEW_SMOKE_TRAIL_MS = 3000

/** `dewBeams` store entries must outlive beam + smoke so instances can simulate. */
export const DEW_BEAM_STORE_LIFETIME_MS = DEW_BEAM_VISUAL_LIFETIME_MS + DEW_SMOKE_TRAIL_MS
