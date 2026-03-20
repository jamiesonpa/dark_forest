import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import * as THREE from 'three'
import type { Celestial } from '@/types/game'
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
import { ASTEROID_COLLIDER_SIZE_TOP_FRACTION } from '@/systems/collision/constants'
import { ensureRapierLoaded } from '@/systems/collision/ensureRapier'

interface CelestialGridContentsProps {
  celestial: Celestial
}

interface AsteroidInstance {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  modelIndex: number
  radius: number
  spacingBias: number
}

const ASTEROID_MODEL_URLS = [
  '/models/asteroids/asteroid1.fbx',
  '/models/asteroids/asteroid2.fbx',
  '/models/asteroids/asteroid3.fbx',
  '/models/asteroids/asteroid4.fbx',
  '/models/asteroids/asteroid5.fbx',
] as const

const ASTEROID_TEXTURE_URLS = [
  '/models/asteroids/asteroids_Mat1_Base_Color.jpg',
  '/models/asteroids/asteroids_Mat1_Mixed_AO.jpg',
  '/models/asteroids/asteroids_Mat1_Normal_DirectX.jpg',
  '/models/asteroids/asteroids_Mat1_Roughness.jpg',
] as const

// Centralized tuning values for belt-site asteroid distribution.
const BELT_SITE_TUNING = {
  countPerRadiusUnit: 0.08,
  minCount: 700,
  maxCount: 11000,
  fieldScaleMultiplier: 20,
  radiusFactor: 0.74,
  minRadius: 650,
  heightFactor: 0.2,
  minHeight: 220,
  arcDegrees: 185,
  arcThicknessFactor: 0.22,
  arcThicknessFloor: 260,
  arcEndHeightFactor: 0.08,
  arcEndHeightFloor: 24,
  arcCenterHeightCurve: 1.6,
  arcCenterSizeCurve: 1.35,
  edgeMinScaleMultiplier: 0.3,
  edgeMaxScaleMultiplier: 0.22,
  minScaleFactor: 0.014,
  minScaleFloor: 10,
  maxScaleFactor: 0.2,
  maxScaleExtra: 90,
  commonScaleBiasPower: 2.6,
  tinyScaleChance: 0.1,
  tinyScaleMinMultiplier: 0.2,
  tinyScaleMaxMultiplier: 0.6,
  rareLargeChance: 0.05,
  rareLargeMinMultiplier: 2.2,
  rareLargeMaxMultiplier: 8,
  rareHugeChance: 0.012,
  rareHugeMinMultiplier: 4.5,
  rareHugeMaxMultiplier: 32,
  minSurfaceGapFactor: 0.008,
  minSurfaceGapFloor: 28,
  minSpacingBias: 0.7,
  maxSpacingBias: 2.1,
  radialBiasPower: 0.8,
} as const

const asteroidColliderDebugMaterial = new THREE.MeshBasicMaterial({
  color: 0xff7722,
  wireframe: true,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
})

function firstMeshGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  let found: THREE.BufferGeometry | null = null
  root.traverse((child) => {
    if (found || !(child instanceof THREE.Mesh) || !child.geometry) return
    found = child.geometry as THREE.BufferGeometry
  })
  return found
}

function createSeededRandom(seedText: string) {
  let seed = 0
  for (let index = 0; index < seedText.length; index += 1) {
    seed = (seed * 31 + seedText.charCodeAt(index)) >>> 0
  }

  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let next = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function AsteroidFieldContents({ celestial }: CelestialGridContentsProps) {
  const starSystem = useGameStore((s) => s.starSystem)
  const showColliderDebug = useGameStore((s) => s.showColliderDebug)
  const loadedObjects = useLoader(FBXLoader, [...ASTEROID_MODEL_URLS]) as THREE.Group[]
  const [baseColorMap, aoMap, normalMap, roughnessMap] = useLoader(
    THREE.TextureLoader,
    [...ASTEROID_TEXTURE_URLS]
  ) as [THREE.Texture, THREE.Texture, THREE.Texture, THREE.Texture]
  const meshRefs = useRef<Array<THREE.InstancedMesh | null>>([])
  const irstMeshRefs = useRef<Array<THREE.InstancedMesh | null>>([])
  const [hullDebugGeometries, setHullDebugGeometries] = useState<
    (THREE.BufferGeometry | null)[]
  >([])

  const geometries = useMemo(
    () =>
      loadedObjects
        .map((obj) => firstMeshGeometry(obj))
        .filter((geometry): geometry is THREE.BufferGeometry => geometry !== null),
    [loadedObjects]
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

  const irstOverlayMaterial = useMemo(() => createAsteroidIrstOverlayMaterial(), [])

  const material = useMemo(() => {
    baseColorMap.colorSpace = THREE.SRGBColorSpace
    aoMap.colorSpace = THREE.NoColorSpace
    normalMap.colorSpace = THREE.NoColorSpace
    roughnessMap.colorSpace = THREE.NoColorSpace
    const nextMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: baseColorMap,
      aoMap,
      normalMap,
      roughnessMap,
      roughness: 1,
      metalness: 0.04,
      side: THREE.DoubleSide,
    })
    // The supplied normal texture is authored in DirectX format.
    nextMaterial.normalScale = new THREE.Vector2(1, -1)
    return nextMaterial
  }, [aoMap, baseColorMap, normalMap, roughnessMap])

  useEffect(() => {
    return () => material.dispose()
  }, [material])

  useEffect(() => {
    return () => irstOverlayMaterial.dispose()
  }, [irstOverlayMaterial])

  const asteroids = useMemo(() => {
    const random = createSeededRandom(
      `${celestial.id}:${celestial.gridRadius}:${celestial.position.join(':')}`
    )
    const baseClusterRadius = Math.max(
      BELT_SITE_TUNING.minRadius,
      celestial.gridRadius * BELT_SITE_TUNING.radiusFactor
    )
    const clusterRadius = baseClusterRadius * BELT_SITE_TUNING.fieldScaleMultiplier
    const baseClusterHeight = Math.max(
      BELT_SITE_TUNING.minHeight,
      celestial.gridRadius * BELT_SITE_TUNING.heightFactor
    )
    const clusterHeight = baseClusterHeight * BELT_SITE_TUNING.fieldScaleMultiplier
    const arcRadians = THREE.MathUtils.degToRad(BELT_SITE_TUNING.arcDegrees)
    const arcThickness = Math.max(
      BELT_SITE_TUNING.arcThicknessFloor,
      clusterRadius * BELT_SITE_TUNING.arcThicknessFactor
    )
    const star = starSystem.celestials.find((entry) => entry.type === 'star')
    const toStarX = (star?.position[0] ?? 0) - celestial.position[0]
    const toStarZ = (star?.position[2] ?? 0) - celestial.position[2]
    const arcCenterAngle =
      Math.abs(toStarX) + Math.abs(toStarZ) < 0.001 ? 0 : Math.atan2(toStarZ, toStarX) + Math.PI
    const minScale = Math.max(
      BELT_SITE_TUNING.minScaleFloor,
      celestial.gridRadius * BELT_SITE_TUNING.minScaleFactor
    )
    const maxScale = Math.max(
      minScale + BELT_SITE_TUNING.maxScaleExtra,
      celestial.gridRadius * BELT_SITE_TUNING.maxScaleFactor
    )
    const targetCount = Math.max(
      BELT_SITE_TUNING.minCount,
      Math.min(
        BELT_SITE_TUNING.maxCount,
        Math.round(celestial.gridRadius * BELT_SITE_TUNING.countPerRadiusUnit)
      )
    )
    const minSurfaceGap = Math.max(
      BELT_SITE_TUNING.minSurfaceGapFloor,
      celestial.gridRadius * BELT_SITE_TUNING.minSurfaceGapFactor
    )
    const maxAttempts = targetCount * 40

    const placed: AsteroidInstance[] = []
    let attempts = 0

    while (placed.length < targetCount && attempts < maxAttempts) {
      attempts += 1
      const angle =
        arcCenterAngle + (random() - 0.5) * arcRadians
      const radialDistance =
        clusterRadius
        + (Math.pow(random(), BELT_SITE_TUNING.radialBiasPower) * 2 - 1) * arcThickness
      const halfArcRadians = Math.max(arcRadians * 0.5, 0.0001)
      const normalizedArcOffset = Math.min(
        1,
        Math.abs(angle - arcCenterAngle) / halfArcRadians
      )
      const centerWeight = 1 - normalizedArcOffset
      const centerShapedWeight = Math.pow(centerWeight, BELT_SITE_TUNING.arcCenterHeightCurve)
      const centerSizeWeight = Math.pow(centerWeight, BELT_SITE_TUNING.arcCenterSizeCurve)
      const endHalfHeight = Math.max(
        BELT_SITE_TUNING.arcEndHeightFloor,
        clusterHeight * BELT_SITE_TUNING.arcEndHeightFactor
      )
      const localHalfHeight = THREE.MathUtils.lerp(endHalfHeight, clusterHeight, centerShapedWeight)
      const modelIndex = Math.floor(random() * Math.max(1, geometries.length))
      const localMinScale = THREE.MathUtils.lerp(
        minScale * BELT_SITE_TUNING.edgeMinScaleMultiplier,
        minScale,
        centerSizeWeight
      )
      const localMaxScale = THREE.MathUtils.lerp(
        maxScale * BELT_SITE_TUNING.edgeMaxScaleMultiplier,
        maxScale,
        centerSizeWeight
      )
      let scale = THREE.MathUtils.lerp(
        Math.min(localMinScale, localMaxScale),
        Math.max(localMinScale, localMaxScale),
        Math.pow(random(), BELT_SITE_TUNING.commonScaleBiasPower)
      )
      const scaleRoll = random()
      const weightedRareHugeChance =
        BELT_SITE_TUNING.rareHugeChance * Math.pow(centerSizeWeight, 5)
      const weightedRareLargeChance =
        BELT_SITE_TUNING.rareLargeChance * Math.pow(centerSizeWeight, 2.7)
      if (scaleRoll < weightedRareHugeChance) {
        scale *= THREE.MathUtils.lerp(
          BELT_SITE_TUNING.rareHugeMinMultiplier,
          BELT_SITE_TUNING.rareHugeMaxMultiplier,
          random()
        )
      } else if (scaleRoll < weightedRareHugeChance + weightedRareLargeChance) {
        scale *= THREE.MathUtils.lerp(
          BELT_SITE_TUNING.rareLargeMinMultiplier,
          BELT_SITE_TUNING.rareLargeMaxMultiplier,
          random()
        )
      } else if (scaleRoll > 1 - BELT_SITE_TUNING.tinyScaleChance) {
        scale *= THREE.MathUtils.lerp(
          BELT_SITE_TUNING.tinyScaleMinMultiplier,
          BELT_SITE_TUNING.tinyScaleMaxMultiplier,
          random()
        )
      }
      const candidateRadius = scale * (geometryBaseRadii[modelIndex] ?? 1)
      const candidate: AsteroidInstance = {
        position: [
          Math.cos(angle) * radialDistance,
          (random() * 2 - 1) * localHalfHeight,
          Math.sin(angle) * radialDistance,
        ],
        rotation: [
          random() * Math.PI * 2,
          random() * Math.PI * 2,
          random() * Math.PI * 2,
        ],
        scale,
        modelIndex,
        radius: candidateRadius,
        spacingBias: THREE.MathUtils.lerp(
          BELT_SITE_TUNING.minSpacingBias,
          BELT_SITE_TUNING.maxSpacingBias,
          random()
        ),
      }

      const tooClose = placed.some((existing) => {
        const dx = candidate.position[0] - existing.position[0]
        const dy = candidate.position[1] - existing.position[1]
        const dz = candidate.position[2] - existing.position[2]
        const pairSpacingBias = (existing.spacingBias + candidate.spacingBias) * 0.5
        const minCenterDistance =
          existing.radius + candidate.radius + minSurfaceGap * pairSpacingBias
        return dx * dx + dy * dy + dz * dz < minCenterDistance * minCenterDistance
      })
      if (tooClose) continue
      placed.push(candidate)
    }

    return placed
  }, [celestial, geometries.length, geometryBaseRadii, starSystem])

  const instancesByGeometry = useMemo(() => {
    if (geometries.length === 0) return [] as AsteroidInstance[][]
    const grouped: AsteroidInstance[][] = Array.from({ length: geometries.length }, () => [])
    asteroids.forEach((asteroid) => {
      grouped[asteroid.modelIndex]?.push(asteroid)
    })
    return grouped
  }, [asteroids, geometries.length])

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

  useEffect(() => {
    const dummy = new THREE.Object3D()
    instancesByGeometry.forEach((instances, geometryIndex) => {
      const instancedMesh = meshRefs.current[geometryIndex]
      const irstMesh = irstMeshRefs.current[geometryIndex]
      if (!instancedMesh) return
      instances.forEach((asteroid, asteroidIndex) => {
        dummy.position.set(...asteroid.position)
        dummy.rotation.set(...asteroid.rotation)
        dummy.scale.setScalar(asteroid.scale)
        dummy.updateMatrix()
        instancedMesh.setMatrixAt(asteroidIndex, dummy.matrix)
        if (irstMesh) {
          const key = `${geometryIndex}:${asteroidIndex}`
          if (irstOverlayEligible.has(key)) {
            dummy.scale.setScalar(asteroid.scale * ASTEROID_IRST_OVERLAY_SCALE)
          } else {
            dummy.scale.setScalar(0)
          }
          dummy.updateMatrix()
          irstMesh.setMatrixAt(asteroidIndex, dummy.matrix)
        }
      })
      instancedMesh.instanceMatrix.needsUpdate = true
      instancedMesh.computeBoundingSphere()
      instancedMesh.computeBoundingBox()
      if (irstMesh) {
        irstMesh.instanceMatrix.needsUpdate = true
        irstMesh.computeBoundingSphere()
        irstMesh.computeBoundingBox()
      }
    })
  }, [instancesByGeometry, irstOverlayEligible])

  const partGeometriesByModel = useMemo(
    () => geometries.map((g) => [g]),
    [geometries]
  )

  const collisionInstances = useMemo((): AsteroidColliderInstance[] => {
    const all: AsteroidColliderInstance[] = asteroids.map((a) => ({
      position: a.position,
      rotation: a.rotation,
      scale: a.scale,
      modelIndex: a.modelIndex,
    }))
    return takeTopFractionBySize(
      all,
      (inst) => inst.scale * (geometryBaseRadii[inst.modelIndex] ?? 1),
      ASTEROID_COLLIDER_SIZE_TOP_FRACTION
    )
  }, [asteroids, geometryBaseRadii])

  useEffect(() => {
    if (geometries.length === 0 || collisionInstances.length === 0) {
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
  }, [partGeometriesByModel, collisionInstances, geometries.length])

  useFrame(() => {
    const gs = useGameStore.getState()
    const showIrstOverlay = gs.irstCameraOn && gs.ship.irstSpectrumMode === 'IR'
    irstMeshRefs.current.forEach((m) => {
      if (m) m.visible = showIrstOverlay
    })
  })

  return (
    <group>
      {geometries.map((geometry, geometryIndex) => {
        const instances = instancesByGeometry[geometryIndex] ?? []
        if (instances.length === 0) return null
        return (
          <group key={`${celestial.id}-asteroid-pair-${geometryIndex}`}>
            <instancedMesh
              ref={(node) => {
                meshRefs.current[geometryIndex] = node
              }}
              args={[geometry, material, instances.length]}
              frustumCulled={false}
              castShadow
              receiveShadow
            />
            <instancedMesh
              ref={(node) => {
                irstMeshRefs.current[geometryIndex] = node
                if (node) node.layers.set(ASTEROID_IRST_OVERLAY_LAYER)
              }}
              args={[geometry, irstOverlayMaterial, instances.length]}
              frustumCulled={false}
              castShadow={false}
              receiveShadow={false}
            />
          </group>
        )
      })}
      {showColliderDebug &&
        collisionInstances.map((inst, idx) => {
          const geom = hullDebugGeometries[inst.modelIndex]
          if (!geom) return null
          return (
            <mesh
              key={`cel-collider-dbg-${celestial.id}-${idx}`}
              geometry={geom}
              material={asteroidColliderDebugMaterial}
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

export function CelestialGridContents({ celestial }: CelestialGridContentsProps) {
  switch (celestial.type) {
    case 'asteroid_belt':
      return <AsteroidFieldContents celestial={celestial} />
    default:
      return null
  }
}
