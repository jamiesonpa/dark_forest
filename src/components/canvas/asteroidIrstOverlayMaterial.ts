import * as THREE from 'three'

/** Matches IRST / main camera layer split (see `GameCanvas`, `IRSTCamera`). */
export const ASTEROID_IRST_OVERLAY_LAYER = 1

/** Slight inflation so the IRST shell clears z-fighting with the shaded hull. */
export const ASTEROID_IRST_OVERLAY_SCALE = 1.006

/** Only the largest fraction by effective world radius get IRST overlay instances (perf). */
export const ASTEROID_IRST_OVERLAY_SIZE_TOP_FRACTION = 0.4

/**
 * Scales the warm IR tint. Emissive provides a base thermal floor (visible even
 * in shadow); diffuse adds solar-heating variation on the lit side.
 */
export const ASTEROID_IRST_OVERLAY_INTENSITY = 0.2

const WARM_IR = new THREE.Color(0xfff2e6)

export function createAsteroidIrstOverlayMaterial(): THREE.MeshLambertMaterial {
  const warmColor = WARM_IR.clone().multiplyScalar(ASTEROID_IRST_OVERLAY_INTENSITY)
  return new THREE.MeshLambertMaterial({
    color: warmColor,
    emissive: warmColor,
    side: THREE.FrontSide,
    toneMapped: false,
  })
}
