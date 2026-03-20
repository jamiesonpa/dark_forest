import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import {
  ASTEROID_IRST_OVERLAY_LAYER,
  ASTEROID_IRST_OVERLAY_SCALE,
  ASTEROID_IRST_OVERLAY_SIZE_TOP_FRACTION,
  createAsteroidIrstOverlayMaterial,
} from './asteroidIrstOverlayMaterial'
import {
  clearAsteroidColliders,
  setAsteroidColliders,
  type AsteroidColliderInstance,
} from '@/systems/collision/collisionRegistry'
import { takeTopFractionBySize } from '@/systems/collision/asteroidColliderFilter'
import { ensureRapierLoaded } from '@/systems/collision/ensureRapier'
import { registerAsteroidMergedGeometryRadii } from '@/systems/asteroid/asteroidModelMetrics'

export type AsteroidInstance = {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  modelIndex: number
}

const ASTEROID_MODEL_URLS = [
  '/models/asteroids/asteroid1.fbx',
  '/models/asteroids/asteroid2.fbx',
  '/models/asteroids/asteroid3.fbx',
  '/models/asteroids/asteroid4.fbx',
  '/models/asteroids/asteroid5.fbx',
] as const

/** Set true to log FBX node names in production builds while debugging assets. */
const LOG_ASTEROID_FBX_NAMES = import.meta.env.DEV

function fbxObjectPath(o: THREE.Object3D): string {
  const segments: string[] = []
  for (let x: THREE.Object3D | null = o; x; x = x.parent) {
    const label = x.name?.trim() ? x.name : `(${x.type})`
    segments.unshift(label)
  }
  return segments.join(' ← ')
}

/** Shared mesh wireframe material (imperative meshes; avoids R3F line + log-depth quirks). */
const asteroidColliderDebugMeshMaterial = new THREE.MeshBasicMaterial({
  color: 0xff7722,
  wireframe: true,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})

const ASTEROID_TEXTURE_URLS = [
  '/models/asteroids/asteroids_Mat1_Base_Color.jpg',
  '/models/asteroids/asteroids_Mat1_Mixed_AO.jpg',
  '/models/asteroids/asteroids_Mat1_Normal_DirectX.jpg',
  '/models/asteroids/asteroids_Mat1_Roughness.jpg',
] as const

function triangleCount(geometry: THREE.BufferGeometry): number {
  const idx = geometry.index
  const pos = geometry.getAttribute('position')
  if (idx) return idx.count / 3
  if (pos) return pos.count / 3
  return 0
}

export type AsteroidModelTemplate = {
  /** Single merged mesh for instanced rendering */
  merged: THREE.BufferGeometry
  /** Every `Mesh` / `SkinnedMesh` under the FBX, world matrix baked — physics + debug use each part */
  parts: THREE.BufferGeometry[]
}

/**
 * Collect all drawable mesh geometries under the FBX (nested transforms baked).
 * Rendering uses a merged buffer when possible; Rapier gets one collider per part on the same body.
 */
function buildAsteroidModelTemplate(
  root: THREE.Object3D,
  sourceLabel: string
): AsteroidModelTemplate | null {
  root.updateMatrixWorld(true)
  const parts: THREE.BufferGeometry[] = []

  if (LOG_ASTEROID_FBX_NAMES) {
    console.groupCollapsed(`[AsteroidFBX] ${sourceLabel}`)
    console.log('root', { name: root.name || '(empty)', type: root.constructor.name, path: fbxObjectPath(root) })
  }

  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry) {
      if (LOG_ASTEROID_FBX_NAMES) {
        const path = fbxObjectPath(child)
        const why =
          !(child instanceof THREE.Mesh)
            ? `not Mesh (${child.constructor.name})`
            : 'Mesh, missing geometry'
        console.log(`skip | ${why} | ${path}`)
      }
      return
    }

    const src = child.geometry as THREE.BufferGeometry
    const pos = src.getAttribute('position')
    if (!pos || pos.count === 0) {
      if (LOG_ASTEROID_FBX_NAMES) {
        console.log(`skip | Mesh, empty position attribute | ${fbxObjectPath(child)}`)
      }
      return
    }

    const baked = src.clone()
    baked.applyMatrix4(child.matrixWorld)
    parts.push(baked)

    if (LOG_ASTEROID_FBX_NAMES) {
      const tris = triangleCount(baked)
      console.log(
        `part #${parts.length} | ${tris} tris | ${child.constructor.name} | ${fbxObjectPath(child)}`
      )
    }
  })

  if (LOG_ASTEROID_FBX_NAMES) {
    console.log('summary', { sourceLabel, meshParts: parts.length })
    console.groupEnd()
  }

  if (parts.length === 0) return null

  if (parts.length === 1) {
    const g = parts[0]!
    return { merged: g, parts: [g] }
  }

  const merged = mergeGeometries(
    parts.map((p) => p.clone()),
    false
  )
  if (merged) {
    if (LOG_ASTEROID_FBX_NAMES) {
      console.log(`[AsteroidFBX] ${sourceLabel} mergeGeometries OK (${parts.length} parts)`)
    }
    return { merged, parts }
  }

  if (LOG_ASTEROID_FBX_NAMES) {
    console.warn(`[AsteroidFBX] ${sourceLabel} mergeGeometries failed, using largest part only`)
  }

  let bestI = 0
  let bestN = triangleCount(parts[0]!)
  for (let i = 1; i < parts.length; i += 1) {
    const n = triangleCount(parts[i]!)
    if (n > bestN) {
      bestN = n
      bestI = i
    }
  }
  return { merged: parts[bestI]!.clone(), parts }
}

/** Renders store-driven `debugAsteroids` only (no procedural belt). */
export function AsteroidBelt() {
  const showColliderDebug = useGameStore((s) => s.showColliderDebug)
  const debugAsteroids = useGameStore((s) => s.debugAsteroids)
  const debugAsteroidSpawnNonce = useGameStore((s) => s.debugAsteroidSpawnNonce)

  const loadedObjects = useLoader(FBXLoader, [...ASTEROID_MODEL_URLS]) as THREE.Group[]
  const [baseColorMap, aoMap, normalMap, roughnessMap] = useLoader(
    THREE.TextureLoader,
    [...ASTEROID_TEXTURE_URLS]
  ) as [THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture]
  const beltGroupRef = useRef<THREE.Group>(null)
  const meshRefs = useRef<Array<THREE.InstancedMesh | null>>([])
  const irstMeshRefs = useRef<Array<THREE.InstancedMesh | null>>([])
  const [hullDebugGeometries, setHullDebugGeometries] = useState<
    (THREE.BufferGeometry | null)[]
  >([])

  const asteroidTemplates = useMemo(
    () =>
      loadedObjects
        .map((obj, i) => buildAsteroidModelTemplate(obj, ASTEROID_MODEL_URLS[i] ?? `#${i}`))
        .filter((t): t is AsteroidModelTemplate => t !== null),
    [loadedObjects]
  )

  const geometries = useMemo(
    () => asteroidTemplates.map((t) => t.merged),
    [asteroidTemplates]
  )

  const partGeometriesByModel = useMemo(
    () => asteroidTemplates.map((t) => t.parts),
    [asteroidTemplates]
  )

  const geometryBaseRadii = useMemo(
    () =>
      geometries.map((geometry) => {
        if (!geometry.boundingSphere) {
          geometry.computeBoundingSphere()
        }
        return Math.max(1, geometry.boundingSphere?.radius ?? 1)
      }),
    [geometries]
  )

  useEffect(() => {
    if (geometryBaseRadii.length > 0) {
      registerAsteroidMergedGeometryRadii(geometryBaseRadii)
    }
  }, [geometryBaseRadii])

  const irstProxyGeometries = useMemo(
    () => geometryBaseRadii.map((radius) => new THREE.IcosahedronGeometry(radius, 1)),
    [geometryBaseRadii]
  )

  useEffect(() => {
    return () => irstProxyGeometries.forEach((g) => g.dispose())
  }, [irstProxyGeometries])

  const instancesByGeometry = useMemo((): AsteroidInstance[][] => {
    const n = geometries.length
    if (n === 0) return []
    const grouped: AsteroidInstance[][] = Array.from({ length: n }, () => [])
    for (const d of debugAsteroids) {
      const mi = Math.max(0, Math.min(n - 1, d.modelIndex))
      grouped[mi]!.push({
        position: [d.position[0], d.position[1], d.position[2]],
        rotation: [d.rotation[0], d.rotation[1], d.rotation[2]],
        scale: d.scale,
        modelIndex: mi,
      })
    }
    return grouped
  }, [debugAsteroids, geometries.length])

  const collisionInstances = useMemo((): AsteroidColliderInstance[] => {
    const n = geometries.length
    if (n === 0) return []
    return debugAsteroids.map((d) => {
      const mi = Math.max(0, Math.min(n - 1, d.modelIndex))
      return {
        position: [d.position[0], d.position[1], d.position[2]],
        rotation: [d.rotation[0], d.rotation[1], d.rotation[2]],
        scale: d.scale,
        modelIndex: mi,
      }
    })
  }, [debugAsteroids, geometries.length])

  /** Per-geometry instance index → IRST overlay drawn only for largest fraction (see `ASTEROID_IRST_OVERLAY_SIZE_TOP_FRACTION`). */
  const irstOverlayEligible = useMemo(() => {
    type Entry = { geometryIndex: number; instanceIndex: number; inst: AsteroidInstance }
    const flat: Entry[] = []
    instancesByGeometry.forEach((instances, geometryIndex) => {
      instances.forEach((inst, instanceIndex) => {
        flat.push({ geometryIndex, instanceIndex, inst })
      })
    })
    const top = takeTopFractionBySize(
      flat,
      (e) => e.inst.scale * (geometryBaseRadii[e.inst.modelIndex] ?? 1),
      ASTEROID_IRST_OVERLAY_SIZE_TOP_FRACTION
    )
    const keys = new Set<string>()
    for (const e of top) {
      keys.add(`${e.geometryIndex}:${e.instanceIndex}`)
    }
    return keys
  }, [instancesByGeometry, geometryBaseRadii])

  const irstInstancesByGeometry = useMemo((): AsteroidInstance[][] => {
    const n = geometries.length
    if (n === 0) return []
    const grouped: AsteroidInstance[][] = Array.from({ length: n }, () => [])
    instancesByGeometry.forEach((instances, geometryIndex) => {
      instances.forEach((inst, instanceIndex) => {
        const key = `${geometryIndex}:${instanceIndex}`
        if (irstOverlayEligible.has(key)) {
          grouped[geometryIndex]!.push(inst)
        }
      })
    })
    return grouped
  }, [instancesByGeometry, irstOverlayEligible, geometries.length])

  const irstOverlayMaterial = useMemo(() => createAsteroidIrstOverlayMaterial(), [])

  const asteroidMaterial = useMemo(
    () => {
      baseColorMap.colorSpace = THREE.SRGBColorSpace
      aoMap.colorSpace = THREE.NoColorSpace
      normalMap.colorSpace = THREE.NoColorSpace
      roughnessMap.colorSpace = THREE.NoColorSpace
      return new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: baseColorMap,
        aoMap,
        normalMap,
        roughnessMap,
        roughness: 1,
        metalness: 0.04,
        side: THREE.DoubleSide,
      })
    },
    [aoMap, baseColorMap, normalMap, roughnessMap]
  )

  useEffect(() => {
    // The supplied normal texture is authored in DirectX format.
    asteroidMaterial.normalScale = new THREE.Vector2(1, -1)
    return () => asteroidMaterial.dispose()
  }, [asteroidMaterial])

  useEffect(() => {
    return () => irstOverlayMaterial.dispose()
  }, [irstOverlayMaterial])

  useEffect(() => {
    const dummy = new THREE.Object3D()
    instancesByGeometry.forEach((instances, geometryIndex) => {
      const instancedMesh = meshRefs.current[geometryIndex]
      if (!instancedMesh) return
      instances.forEach((asteroid, asteroidIndex) => {
        dummy.position.set(...asteroid.position)
        dummy.rotation.set(...asteroid.rotation)
        dummy.scale.setScalar(asteroid.scale)
        dummy.updateMatrix()
        instancedMesh.setMatrixAt(asteroidIndex, dummy.matrix)
      })
      instancedMesh.instanceMatrix.needsUpdate = true
      instancedMesh.computeBoundingSphere()
      instancedMesh.computeBoundingBox()
    })
    irstInstancesByGeometry.forEach((irstInstances, geometryIndex) => {
      const irstMesh = irstMeshRefs.current[geometryIndex]
      if (!irstMesh || irstInstances.length === 0) return
      irstInstances.forEach((asteroid, irstIndex) => {
        dummy.position.set(...asteroid.position)
        dummy.rotation.set(...asteroid.rotation)
        dummy.scale.setScalar(asteroid.scale * ASTEROID_IRST_OVERLAY_SCALE)
        dummy.updateMatrix()
        irstMesh.setMatrixAt(irstIndex, dummy.matrix)
      })
      irstMesh.instanceMatrix.needsUpdate = true
      irstMesh.computeBoundingSphere()
      irstMesh.computeBoundingBox()
    })
  }, [instancesByGeometry, irstInstancesByGeometry])

  useEffect(() => {
    if (partGeometriesByModel.length === 0 || collisionInstances.length === 0) {
      clearAsteroidColliders()
      setHullDebugGeometries([])
      return
    }
    let cancelled = false
    void ensureRapierLoaded().then(() =>
      setAsteroidColliders(partGeometriesByModel, collisionInstances).then((hulls) => {
        if (!cancelled) setHullDebugGeometries(hulls)
      })
    )
    return () => {
      cancelled = true
      clearAsteroidColliders()
      setHullDebugGeometries([])
    }
  }, [partGeometriesByModel, collisionInstances])

  useFrame(() => {
    const beltGroup = beltGroupRef.current
    if (!beltGroup) return
    const gs = useGameStore.getState()
    const shipPosition = gs.ship.position
    beltGroup.position.set(-shipPosition[0], -shipPosition[1], -shipPosition[2])
    const showIrstOverlay = gs.irstCameraOn && gs.ship.irstSpectrumMode === 'IR'
    irstMeshRefs.current.forEach((m) => {
      if (m) m.visible = showIrstOverlay
    })
  })

  if (debugAsteroids.length === 0) return null

  const instanceRenderKey = String(debugAsteroidSpawnNonce)

  return (
    <group ref={beltGroupRef}>
      {geometries.map((geometry, geometryIndex) => {
        const instances = instancesByGeometry[geometryIndex] ?? []
        const irstInstances = irstInstancesByGeometry[geometryIndex] ?? []
        if (instances.length === 0) return null
        return (
          <group key={`asteroid-pair-${geometryIndex}-${instanceRenderKey}`}>
            <instancedMesh
              ref={(node) => {
                meshRefs.current[geometryIndex] = node
              }}
              args={[geometry, asteroidMaterial, instances.length]}
              frustumCulled={false}
              castShadow
              receiveShadow
            />
            {irstInstances.length > 0 && (
              <instancedMesh
                ref={(node) => {
                  irstMeshRefs.current[geometryIndex] = node
                  if (node) node.layers.set(ASTEROID_IRST_OVERLAY_LAYER)
                }}
                args={[irstProxyGeometries[geometryIndex]!, irstOverlayMaterial, irstInstances.length]}
                castShadow={false}
                receiveShadow={false}
              />
            )}
          </group>
        )
      })}
      {showColliderDebug &&
        collisionInstances.map((inst, idx) => {
          const geom = hullDebugGeometries[inst.modelIndex]
          if (!geom) return null
          return (
            <mesh
              key={`ast-collider-dbg-${instanceRenderKey}-${idx}`}
              geometry={geom}
              material={asteroidColliderDebugMeshMaterial}
              position={inst.position}
              rotation={inst.rotation}
              scale={inst.scale}
              frustumCulled={false}
              renderOrder={1000}
              ref={(m) => {
                if (m) {
                  m.layers.enable(0)
                  m.layers.enable(2)
                }
              }}
            />
          )
        })}
    </group>
  )
}
