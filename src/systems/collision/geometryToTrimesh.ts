import * as THREE from 'three'

/**
 * FBXLoader (and others) often use `InterleavedBufferAttribute` for `position`, which is not
 * `instanceof BufferAttribute`. Always read via getX/Y/Z so physics meshes match rendered geometry.
 */
function appendGeometry(
  positions: number[],
  indices: number[],
  geometry: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4
) {
  const posAttr = geometry.getAttribute('position')
  if (!posAttr || posAttr.itemSize !== 3) return
  if (typeof posAttr.getX !== 'function') return

  const vStart = positions.length / 3
  const vCount = posAttr.count
  const v = new THREE.Vector3()
  for (let i = 0; i < vCount; i += 1) {
    v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(worldMatrix)
    positions.push(v.x, v.y, v.z)
  }

  const index = geometry.getIndex()
  if (index) {
    const arr = index.array
    for (let i = 0; i < index.count; i += 1) {
      indices.push(vStart + arr[i]!)
    }
  } else {
    for (let i = 0; i < vCount; i += 1) {
      indices.push(vStart + i)
    }
  }
}

/**
 * Merge all meshes under `root` into one indexed triangle mesh in root world space.
 */
export function object3dToTrimesh(root: THREE.Object3D): {
  vertices: Float32Array
  indices: Uint32Array
} | null {
  root.updateMatrixWorld(true)
  const positions: number[] = []
  const indices: number[] = []
  const tmp = new THREE.Matrix4()

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) return
    const geom = child.geometry
    if (!(geom instanceof THREE.BufferGeometry)) return
    tmp.copy(child.matrixWorld)
    appendGeometry(positions, indices, geom, tmp)
  })

  if (positions.length < 9 || indices.length < 3) return null

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  }
}

export function bufferGeometryToTrimesh(geometry: THREE.BufferGeometry): {
  vertices: Float32Array
  indices: Uint32Array
} | null {
  const positions: number[] = []
  const indices: number[] = []
  appendGeometry(positions, indices, geometry, new THREE.Matrix4())
  if (positions.length < 9 || indices.length < 3) return null
  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  }
}

/**
 * Extract just the vertex positions from one or more geometries into a flat
 * Float32Array suitable for `ColliderDesc.convexHull()`.
 */
export function geometriesToVertices(
  geometries: THREE.BufferGeometry[],
  worldMatrix?: THREE.Matrix4
): Float32Array | null {
  const mat = worldMatrix ?? new THREE.Matrix4()
  const out: number[] = []
  const v = new THREE.Vector3()
  for (const geometry of geometries) {
    const posAttr = geometry.getAttribute('position')
    if (!posAttr || posAttr.itemSize !== 3) continue
    if (typeof posAttr.getX !== 'function') continue
    for (let i = 0; i < posAttr.count; i += 1) {
      v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(mat)
      out.push(v.x, v.y, v.z)
    }
  }
  if (out.length < 12) return null
  return new Float32Array(out)
}

/**
 * Reduces a dense vertex cloud to at most one point per voxel cell (AABB-aligned).
 * In each cell we keep the vertex farthest from the mesh AABB center so the outer
 * silhouette is preserved better than averaging. Used before Rapier `convexHull`
 * to lower hull triangle count.
 */
export function subsampleVerticesVoxelForConvexHull(
  positions: Float32Array,
  cellsPerAxis: number
): Float32Array {
  const n = positions.length / 3
  const cells = Math.max(2, Math.floor(cellsPerAxis))
  if (n <= cells * cells * cells) return positions

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!
    const y = positions[i + 1]!
    const z = positions[i + 2]!
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }

  const sx = Math.max(maxX - minX, 1e-6)
  const sy = Math.max(maxY - minY, 1e-6)
  const sz = Math.max(maxZ - minZ, 1e-6)
  const cx = (minX + maxX) * 0.5
  const cy = (minY + maxY) * 0.5
  const cz = (minZ + maxZ) * 0.5

  const bucketBest = new Map<
    string,
    { x: number; y: number; z: number; d2: number }
  >()

  for (let vi = 0; vi < n; vi += 1) {
    const i = vi * 3
    const x = positions[i]!
    const y = positions[i + 1]!
    const z = positions[i + 2]!
    const ix = Math.min(cells - 1, Math.floor(((x - minX) / sx) * cells))
    const iy = Math.min(cells - 1, Math.floor(((y - minY) / sy) * cells))
    const iz = Math.min(cells - 1, Math.floor(((z - minZ) / sz) * cells))
    const key = `${ix},${iy},${iz}`
    const dx = x - cx
    const dy = y - cy
    const dz = z - cz
    const d2 = dx * dx + dy * dy + dz * dz
    const prev = bucketBest.get(key)
    if (!prev || d2 > prev.d2) {
      bucketBest.set(key, { x, y, z, d2 })
    }
  }

  const out: number[] = []
  for (const p of bucketBest.values()) {
    out.push(p.x, p.y, p.z)
  }
  return new Float32Array(out)
}
