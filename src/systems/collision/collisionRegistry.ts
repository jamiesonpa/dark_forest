import * as THREE from 'three'
import type { Collider, ColliderShapeCastHit, Rotation, RigidBody, Shape, World } from '@dimforge/rapier3d-compat'
import type { ShipState } from '@/state/types'
import {
  COLLISION_CONTACT_SKIN,
  COLLISION_MAX_CAST_ITERATIONS,
  COLLISION_MAX_DISPLACEMENT_PER_SUBSTEP,
  COLLISION_PUSH_OFF_SPEED,
  COLLISION_RESTITUTION,
  COLLISION_TANGENT_FRICTION,
  ASTEROID_HULL_VOXEL_CELLS_PER_AXIS,
  ASTEROID_HULL_SHRINK,
  TRIMESH_FLAGS,
} from './constants'
import {
  geometriesToVertices,
  object3dToTrimesh,
  subsampleVerticesVoxelForConvexHull,
} from './geometryToTrimesh'
import { ensureRapierLoaded, getRapier } from './ensureRapier'

export type AsteroidColliderInstance = {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  modelIndex: number
}

export type ResolveLocalShipCollisionInput = {
  dt: number
  currentPosition: [number, number, number]
  displacement: [number, number, number]
  velocityPerSec: [number, number, number]
  speed: number
  dacActive: boolean
  dacQuat: { x: number; y: number; z: number; w: number } | null
  headingDeg: number
  inclDeg: number
  rollDeg: number
  inertialDriftActive: boolean
  inertialVelocity: [number, number, number]
}

export type ResolveLocalShipCollisionOutput = {
  position: [number, number, number]
  velocityPerSec: [number, number, number]
  speed: number
  inertialVelocity: [number, number, number]
  collided: boolean
}

let world: World | null = null
let shipCastShape: Shape | null = null
let shipHullVerts: Float32Array | null = null
let shipHullIndices: Uint32Array | null = null
let hullColliderOffset: [number, number, number] = [0, 0, 0]
/** Indexed hull mesh for debug drawing (world-space vertices match trimesh). */
let debugHullTemplate: THREE.BufferGeometry | null = null
const asteroidBodies: RigidBody[] = []
let asteroidInstances: AsteroidColliderInstance[] = []
/** Per-model convex-hull debug geometry (untransformed; apply instance TRS at render time). */
let asteroidHullDebugGeometries: (THREE.BufferGeometry | null)[] = []
/** Per-model pre-computed hull vertex/index data used to stamp out per-instance colliders. */
let asteroidHullData: { vertices: Float32Array; indices: Uint32Array }[] = []
const remoteBodies = new Map<
  string,
  { body: RigidBody; collider: Collider }
>()

/** Set when bodies are added/removed/moved so the next resolve call runs `w.step()` to rebuild the broadphase. */
let _worldDirty = true

const _scoQuat = new THREE.Quaternion()
const _scoOff = new THREE.Vector3()
const _nhQuat = new THREE.Quaternion()
const _nhN = new THREE.Vector3()
const _srEuler = new THREE.Euler()
const _srQuat = new THREE.Quaternion()
const _tangent = new THREE.Vector3()
const _escDir = new THREE.Vector3()
const _motion = new THREE.Vector3()
const _slide = new THREE.Vector3()
const _vel = new THREE.Vector3()
const _iVel = new THREE.Vector3()

function ensureWorld(R: NonNullable<ReturnType<typeof getRapier>>): World {
  if (!world) {
    world = new R.World({ x: 0, y: 0, z: 0 })
  }
  return world
}

function clearAsteroidBodiesInternal() {
  if (!world) return
  for (const b of asteroidBodies) {
    if (b.isValid()) world.removeRigidBody(b)
  }
  asteroidBodies.length = 0
  asteroidInstances = []
  for (const g of asteroidHullDebugGeometries) g?.dispose()
  asteroidHullDebugGeometries = []
  asteroidHullData = []
  _worldDirty = true
}

export function isShipCollisionMeshReady(): boolean {
  return shipCastShape !== null
}

export function hasWorldObstacles(): boolean {
  return asteroidBodies.length > 0 || remoteBodies.size > 0
}

/**
 * Ship shape casts use a triangle mesh (not a convex hull). A convex hull of the
 * hull geometry fills concavities and behaves like a huge “bubble” vs asteroids.
 */
export function registerShipHullFromObject(
  hullRoot: THREE.Object3D,
  colliderOffset: [number, number, number]
): void {
  const R = getRapier()
  if (!R) return
  const data = object3dToTrimesh(hullRoot)
  if (!data) return
  hullColliderOffset = [...colliderOffset]

  shipCastShape = new R.TriMesh(data.vertices, data.indices, TRIMESH_FLAGS)
  shipHullVerts = data.vertices
  shipHullIndices = data.indices

  debugHullTemplate?.dispose()
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data.vertices), 3))
  g.setIndex(Array.from(data.indices))
  debugHullTemplate = g
}

export function getShipHullDebugTemplate(): THREE.BufferGeometry | null {
  return debugHullTemplate
}

export function getHullColliderOffsetForDebug(): [number, number, number] {
  return [...hullColliderOffset]
}


/**
 * Create Rapier convex-hull colliders for every asteroid instance.
 *
 * A convex hull is computed once per *model* from the combined part vertices,
 * then stamped out per instance with rotation + scale baked into the hull
 * vertex data.  This is dramatically cheaper than per-triangle trimesh
 * colliders and a good physical approximation for rocky asteroids.
 *
 * Collider bodies are placed at each instance's absolute world position so
 * they share the same coordinate frame as the local ship's shape-cast origin
 * and remote-ship colliders.
 */
export async function setAsteroidColliders(
  modelPartGeometries: THREE.BufferGeometry[][],
  instances: AsteroidColliderInstance[]
): Promise<(THREE.BufferGeometry | null)[]> {
  const R = await ensureRapierLoaded()
  const w = ensureWorld(R)
  clearAsteroidBodiesInternal()

  // --- Pre-compute one convex hull per model ---------------------------
  for (let mi = 0; mi < modelPartGeometries.length; mi += 1) {
    const parts = modelPartGeometries[mi]!
    const rawVerts = geometriesToVertices(parts)
    if (!rawVerts) {
      asteroidHullData.push({ vertices: new Float32Array(0), indices: new Uint32Array(0) })
      asteroidHullDebugGeometries.push(null)
      continue
    }

    /** Coarse → fine: try low voxel count first for fewer hull triangles; fall back if hull fails. */
    const voxelAttempts = [
      ASTEROID_HULL_VOXEL_CELLS_PER_AXIS,
      5,
      8,
      12,
      0,
    ].filter((c, i, a) => a.indexOf(c) === i)

    let hullDesc: ReturnType<typeof R.ColliderDesc.convexHull> = null
    let hullInputVerts = rawVerts
    let usedVoxelCells = 0
    for (const cells of voxelAttempts) {
      const pts =
        cells === 0 ? rawVerts : subsampleVerticesVoxelForConvexHull(rawVerts, cells)
      if (pts.length < 12) continue
      const desc = R.ColliderDesc.convexHull(pts)
      if (desc) {
        hullDesc = desc
        hullInputVerts = pts
        usedVoxelCells = cells
        break
      }
    }

    if (!hullDesc) {
      if (import.meta.env.DEV)
        console.warn(`[collision] convexHull failed for model ${mi}`)
      asteroidHullData.push({ vertices: new Float32Array(0), indices: new Uint32Array(0) })
      asteroidHullDebugGeometries.push(null)
      continue
    }
    const tempBody = w.createRigidBody(R.RigidBodyDesc.fixed())
    const tempCollider = w.createCollider(hullDesc, tempBody)
    const hullVerts = new Float32Array(tempCollider.vertices())
    const hullIdxRaw = tempCollider.indices()
    const hullIndices = hullIdxRaw ? new Uint32Array(hullIdxRaw) : new Uint32Array(0)
    w.removeRigidBody(tempBody)

    asteroidHullData.push({ vertices: hullVerts, indices: hullIndices })

    const dbg = new THREE.BufferGeometry()
    dbg.setAttribute('position', new THREE.BufferAttribute(hullVerts.slice(), 3))
    if (hullIndices.length > 0) dbg.setIndex(Array.from(hullIndices))
    asteroidHullDebugGeometries.push(dbg)

    if (import.meta.env.DEV) {
      const srcVerts = rawVerts.length / 3
      const inputVerts = hullInputVerts.length / 3
      const hullVertCount = hullVerts.length / 3
      const hullFaces = hullIndices.length / 3
      const voxelLabel = usedVoxelCells === 0 ? 'full' : `${usedVoxelCells}³ voxel`
      console.log(
        `[collision] model ${mi}: ${srcVerts} mesh verts → ${inputVerts} hull-input (${voxelLabel}) → hull ${hullVertCount} verts / ${hullFaces} faces`
      )
    }
  }

  // --- Stamp out per-instance colliders --------------------------------
  const tmpMat = new THREE.Matrix4()
  const tmpPos = new THREE.Vector3()
  const tmpQuat = new THREE.Quaternion()
  const tmpScale = new THREE.Vector3()
  const v = new THREE.Vector3()

  let totalColliders = 0
  for (const inst of instances) {
    const hull = asteroidHullData[inst.modelIndex]
    if (!hull || hull.vertices.length < 12) continue

    tmpPos.set(0, 0, 0)
    tmpQuat.setFromEuler(
      new THREE.Euler(inst.rotation[0], inst.rotation[1], inst.rotation[2], 'XYZ')
    )
    tmpScale.setScalar(inst.scale * ASTEROID_HULL_SHRINK)
    tmpMat.compose(tmpPos, tmpQuat, tmpScale)

    const xVerts = new Float32Array(hull.vertices.length)
    for (let i = 0; i < hull.vertices.length; i += 3) {
      v.set(hull.vertices[i]!, hull.vertices[i + 1]!, hull.vertices[i + 2]!).applyMatrix4(tmpMat)
      xVerts[i] = v.x
      xVerts[i + 1] = v.y
      xVerts[i + 2] = v.z
    }

    const colliderDesc = R.ColliderDesc.convexMesh(xVerts, hull.indices)
    if (!colliderDesc) continue

    const bodyDesc = R.RigidBodyDesc.fixed().setTranslation(
      inst.position[0],
      inst.position[1],
      inst.position[2]
    )
    const body = w.createRigidBody(bodyDesc)
    w.createCollider(colliderDesc, body)
    totalColliders += 1

    asteroidBodies.push(body)
    asteroidInstances.push(inst)
  }

  _worldDirty = true

  if (import.meta.env.DEV) {
    console.log(
      `[collision] setAsteroidColliders: ${asteroidBodies.length} bodies, ${totalColliders} colliders from ${instances.length} instances`
    )
  }

  return asteroidHullDebugGeometries
}

/**
 * No-op: asteroid bodies are `fixed` and positioned at creation time.
 * Retained for call-site compatibility.
 */
export function syncAsteroidColliderTransforms(): void {}

export function clearAsteroidColliders(): void {
  if (!getRapier()) return
  clearAsteroidBodiesInternal()
}

export function syncRemoteShipColliders(args: {
  shipsById: Record<string, ShipState>
  localPlayerId: string
  currentCelestialId: string
}): void {
  const R = getRapier()
  if (!R || !shipCastShape || !shipHullVerts) return
  const w = ensureWorld(R)

  const seen = new Set<string>()
  for (const [id, ship] of Object.entries(args.shipsById)) {
    if (id === args.localPlayerId) continue
    if (ship.hull <= 0) continue
    if (ship.inWarpTransit) continue
    if (ship.currentCelestialId !== args.currentCelestialId) continue

    seen.add(id)
    let entry = remoteBodies.get(id)
    if (!entry) {
      const body = w.createRigidBody(R.RigidBodyDesc.kinematicPositionBased())
      const idx = shipHullIndices ?? undefined
      if (!idx || idx.length === 0) continue
      const desc = R.ColliderDesc.trimesh(shipHullVerts, idx, TRIMESH_FLAGS).setTranslation(
        hullColliderOffset[0],
        hullColliderOffset[1],
        hullColliderOffset[2]
      )
      const collider = w.createCollider(desc, body)
      entry = { body, collider }
      remoteBodies.set(id, entry)
    }

    const rot = shipRotationToRapier(false, null, ship.actualHeading, ship.actualInclination, ship.rollAngle)
    entry.body.setTranslation(
      { x: ship.position[0], y: ship.position[1], z: ship.position[2] },
      true
    )
    entry.body.setRotation(rot, true)
    _worldDirty = true
  }

  for (const id of [...remoteBodies.keys()]) {
    if (!seen.has(id)) {
      const entry = remoteBodies.get(id)
      if (entry && world && entry.body.isValid()) {
        world.removeRigidBody(entry.body)
      }
      remoteBodies.delete(id)
      _worldDirty = true
    }
  }
}

function shipRotationToRapier(
  dacActive: boolean,
  dacQuat: { x: number; y: number; z: number; w: number } | null,
  headingDeg: number,
  inclDeg: number,
  rollDeg: number
): Rotation {
  if (dacActive && dacQuat) {
    return { x: dacQuat.x, y: dacQuat.y, z: dacQuat.z, w: dacQuat.w }
  }
  _srEuler.set(
    THREE.MathUtils.degToRad(-inclDeg),
    THREE.MathUtils.degToRad(-headingDeg),
    THREE.MathUtils.degToRad(rollDeg),
    'YXZ'
  )
  _srQuat.setFromEuler(_srEuler)
  return { x: _srQuat.x, y: _srQuat.y, z: _srQuat.z, w: _srQuat.w }
}

function shapeCastOrigin(
  shipPos: [number, number, number],
  rot: Rotation,
  offset: [number, number, number],
  R: NonNullable<ReturnType<typeof getRapier>>
) {
  _scoQuat.set(rot.x, rot.y, rot.z, rot.w)
  _scoOff.set(offset[0], offset[1], offset[2]).applyQuaternion(_scoQuat)
  return new R.Vector3(shipPos[0] + _scoOff.x, shipPos[1] + _scoOff.y, shipPos[2] + _scoOff.z)
}

/** Returns the shared `_nhN` vector — use before calling again. */
function normalWorldFromHit(hit: ColliderShapeCastHit): THREE.Vector3 {
  const nl = hit.normal2
  const rot = hit.collider.rotation()
  _nhQuat.set(rot.x, rot.y, rot.z, rot.w)
  _nhN.set(nl.x, nl.y, nl.z).applyQuaternion(_nhQuat).normalize()
  return _nhN
}

function orientNormalAgainstMotion(n: THREE.Vector3, motion: THREE.Vector3) {
  if (motion.lengthSq() < 1e-16) return
  if (n.dot(motion) > 0) n.negate()
}

function reflectAlongNormal(v: THREE.Vector3, n: THREE.Vector3) {
  const vn = v.dot(n)
  if (vn >= 0) return
  _tangent.copy(v).addScaledVector(n, -vn)
  _tangent.multiplyScalar(1 - COLLISION_TANGENT_FRICTION)
  const bounceNormal = Math.max(-vn * COLLISION_RESTITUTION, COLLISION_PUSH_OFF_SPEED)
  v.copy(_tangent).addScaledVector(n, bounceNormal)
}

export function resolveLocalShipCollision(
  input: ResolveLocalShipCollisionInput
): ResolveLocalShipCollisionOutput {
  const R = getRapier()
  const w = world
  const shape = shipCastShape
  if (!R || !w || !shape || !hasWorldObstacles()) {
    const [ix, iy, iz] = input.inertialVelocity
    return {
      position: [
        input.currentPosition[0] + input.displacement[0],
        input.currentPosition[1] + input.displacement[1],
        input.currentPosition[2] + input.displacement[2],
      ],
      velocityPerSec: [...input.velocityPerSec] as [number, number, number],
      speed: input.speed,
      inertialVelocity: [ix, iy, iz],
      collided: false,
    }
  }

  if (_worldDirty) {
    w.step()
    _worldDirty = false
  }

  const rot = shipRotationToRapier(
    input.dacActive,
    input.dacQuat,
    input.headingDeg,
    input.inclDeg,
    input.rollDeg
  )

  let px = input.currentPosition[0]
  let py = input.currentPosition[1]
  let pz = input.currentPosition[2]

  const v = _vel.set(input.velocityPerSec[0], input.velocityPerSec[1], input.velocityPerSec[2])
  const iVelIn = input.inertialVelocity
  const iVel = _iVel.set(iVelIn[0], iVelIn[1], iVelIn[2])

  let hasReflected = false
  const DEPENETRATION_STEP = 3
  const MAX_DEPENETRATION_ITERS = 10
  for (let dep = 0; dep < MAX_DEPENETRATION_ITERS; dep++) {
    const depOrigin = shapeCastOrigin([px, py, pz], rot, hullColliderOffset, R)
    const overlapping = w.intersectionWithShape(depOrigin, rot, shape)
    if (!overlapping) break

    const colTr = overlapping.translation()
    const escX = depOrigin.x - colTr.x
    const escY = depOrigin.y - colTr.y
    const escZ = depOrigin.z - colTr.z
    const escLen = Math.hypot(escX, escY, escZ)
    if (escLen < 1e-8) {
      py += DEPENETRATION_STEP
    } else {
      const inv = DEPENETRATION_STEP / escLen
      px += escX * inv
      py += escY * inv
      pz += escZ * inv
    }

    if (!hasReflected) {
      if (escLen < 1e-8) {
        _escDir.set(0, 1, 0)
      } else {
        _escDir.set(escX, escY, escZ).divideScalar(escLen)
      }
      reflectAlongNormal(v, _escDir)
      if (input.inertialDriftActive) {
        reflectAlongNormal(iVel, _escDir)
      }
      hasReflected = true
    }
  }

  const dispLen = Math.hypot(
    input.displacement[0],
    input.displacement[1],
    input.displacement[2]
  )
  const substeps = Math.max(
    1,
    Math.ceil(dispLen / Math.max(1, COLLISION_MAX_DISPLACEMENT_PER_SUBSTEP))
  )

  for (let s = 0; s < substeps; s += 1) {
    const sdx = input.displacement[0] / substeps
    const sdy = input.displacement[1] / substeps
    const sdz = input.displacement[2] / substeps

    let rdx = sdx
    let rdy = sdy
    let rdz = sdz

    for (let iter = 0; iter < COLLISION_MAX_CAST_ITERATIONS; iter += 1) {
      const rdLen = Math.hypot(rdx, rdy, rdz)
      if (rdLen < 1e-8) break

      const origin = shapeCastOrigin([px, py, pz], rot, hullColliderOffset, R)
      const vel = new R.Vector3(rdx, rdy, rdz)

      const hit = w.castShape(origin, rot, vel, shape, 0.0, 1.0, true)

      if (!hit) {
        px += rdx
        py += rdy
        pz += rdz
        break
      }

      const toi = hit.time_of_impact
      px += rdx * toi
      py += rdy * toi
      pz += rdz * toi

      _motion.set(rdx, rdy, rdz)
      const n = normalWorldFromHit(hit)
      orientNormalAgainstMotion(n, _motion)

      if (!hasReflected) {
        reflectAlongNormal(v, n)
        if (input.inertialDriftActive) {
          reflectAlongNormal(iVel, n)
        }
        hasReflected = true
      }

      px += n.x * COLLISION_CONTACT_SKIN
      py += n.y * COLLISION_CONTACT_SKIN
      pz += n.z * COLLISION_CONTACT_SKIN

      const remain = 1 - toi
      const slideVel = input.inertialDriftActive ? iVel : v
      _slide.copy(slideVel).multiplyScalar(input.dt * remain)
      const normalProj = _slide.dot(n)
      if (normalProj < 0) {
        _slide.addScaledVector(n, -normalProj)
      }
      rdx = _slide.x
      rdy = _slide.y
      rdz = _slide.z
    }
  }

  const speed = input.inertialDriftActive ? iVel.length() : v.length()
  return {
    position: [px, py, pz],
    velocityPerSec: input.inertialDriftActive ? [iVel.x, iVel.y, iVel.z] : [v.x, v.y, v.z],
    speed,
    inertialVelocity: input.inertialDriftActive
      ? [iVel.x, iVel.y, iVel.z]
      : [...iVelIn] as [number, number, number],
    collided: hasReflected,
  }
}
