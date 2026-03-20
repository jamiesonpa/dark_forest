/**
 * Runtime radii of merged asteroid FBX geometry (model space), matching
 * `geometryBaseRadii` in `AsteroidBelt.tsx` (`boundingSphere.radius`, min 1).
 * Updated when `AsteroidBelt` loads assets so debug spawn can place rocks by extent.
 */
const FALLBACK_MERGED_RADII = [24, 24, 24, 24, 24]

let mergedGeometryRadii: number[] = [...FALLBACK_MERGED_RADII]

export function registerAsteroidMergedGeometryRadii(radii: number[]): void {
  if (!radii.length) return
  mergedGeometryRadii = radii.map((r) => (Number.isFinite(r) && r > 0 ? Math.max(1, r) : 1))
}

/** Bounding-sphere radius of merged model geometry for `modelIndex` (model units, ≥ 1). */
export function getAsteroidMergedGeometryRadius(modelIndex: number): number {
  const n = mergedGeometryRadii.length
  if (n === 0) return 1
  const i = Math.max(0, Math.min(n - 1, modelIndex))
  const r = mergedGeometryRadii[i] ?? 0
  return Number.isFinite(r) && r > 0 ? r : 1
}
