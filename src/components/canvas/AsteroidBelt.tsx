import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'

type AsteroidInstance = {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
  modelIndex: number
}

type SpawnConfig = {
  thickness: number
  jitter: number
  density: number
  arcLength: number
  radius: number
  minSize: number
  maxSize: number
  nonce: number
}

const ASTEROID_MODEL_URLS = [
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-1-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-2-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-3-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-4-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-5-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-7-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-8-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-9-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-10-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-11-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-12-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-13-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-14-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-15-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-20-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-21-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-23-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-24-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-25-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-27-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-28-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-30-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-32-1.obj',
  '/models/asteroids/uploads_files_2353346_Assem1+-+astro-33-1.obj',
] as const

function firstMeshGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  let found: THREE.BufferGeometry | null = null
  root.traverse((child) => {
    if (found || !(child instanceof THREE.Mesh) || !child.geometry) return
    found = child.geometry as THREE.BufferGeometry
  })
  return found
}

export function AsteroidBelt() {
  const spawnNonce = useGameStore((s) => s.asteroidBeltSpawnNonce)
  const thickness = useGameStore((s) => s.asteroidBeltThickness)
  const jitter = useGameStore((s) => s.asteroidBeltJitter)
  const density = useGameStore((s) => s.asteroidBeltDensity)
  const arcLength = useGameStore((s) => s.asteroidBeltArcLength)
  const radius = useGameStore((s) => s.asteroidBeltRadius)
  const minSize = useGameStore((s) => s.asteroidBeltMinSize)
  const maxSize = useGameStore((s) => s.asteroidBeltMaxSize)

  const loadedObjects = useLoader(OBJLoader, [...ASTEROID_MODEL_URLS]) as THREE.Group[]
  const beltGroupRef = useRef<THREE.Group>(null)
  const meshRefs = useRef<Array<THREE.InstancedMesh | null>>([])
  const [spawnConfig, setSpawnConfig] = useState<SpawnConfig | null>(null)

  useEffect(() => {
    if (spawnNonce <= 0) return
    setSpawnConfig({
      thickness,
      jitter,
      density,
      arcLength,
      radius,
      minSize,
      maxSize,
      nonce: spawnNonce,
    })
  }, [arcLength, density, jitter, maxSize, minSize, radius, spawnNonce, thickness])

  const geometries = useMemo(
    () =>
      loadedObjects
        .map((obj) => firstMeshGeometry(obj))
        .filter((geometry): geometry is THREE.BufferGeometry => geometry !== null),
    [loadedObjects]
  )

  const instancesByGeometry = useMemo(() => {
    if (!spawnConfig || geometries.length === 0) return [] as AsteroidInstance[][]

    const asteroidCount = Math.max(
      80,
      Math.round(spawnConfig.arcLength * spawnConfig.density)
    )

    const arcRadians = THREE.MathUtils.degToRad(spawnConfig.arcLength)
    const grouped: AsteroidInstance[][] = Array.from({ length: geometries.length }, () => [])

    for (let i = 0; i < asteroidCount; i += 1) {
      const angle = (Math.random() - 0.5) * arcRadians
      const verticalOffset = (Math.random() * 2 - 1) * spawnConfig.thickness
      const radiusWithJitter = spawnConfig.radius + (Math.random() * 2 - 1) * spawnConfig.jitter

      const posX = Math.sin(angle) * radiusWithJitter + (Math.random() * 2 - 1) * spawnConfig.jitter
      const posY = verticalOffset
      const posZ = Math.cos(angle) * radiusWithJitter + (Math.random() * 2 - 1) * spawnConfig.jitter

      const entry: AsteroidInstance = {
        position: [posX, posY, posZ],
        rotation: [
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
        ],
        scale: THREE.MathUtils.lerp(spawnConfig.minSize, spawnConfig.maxSize, Math.random()),
        modelIndex: Math.floor(Math.random() * geometries.length),
      }
      grouped[entry.modelIndex]?.push(entry)
    }

    return grouped
  }, [geometries, spawnConfig])

  const asteroidMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x77614a,
        roughness: 0.92,
        metalness: 0.06,
        side: THREE.DoubleSide,
      }),
    []
  )

  useEffect(() => {
    return () => asteroidMaterial.dispose()
  }, [asteroidMaterial])

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
      // Keep frustum culling bounds in sync with moved/scaled instances.
      instancedMesh.computeBoundingSphere()
      instancedMesh.computeBoundingBox()
    })
  }, [instancesByGeometry])

  useFrame(() => {
    const beltGroup = beltGroupRef.current
    if (!beltGroup) return
    const shipPosition = useGameStore.getState().ship.position
    beltGroup.position.set(-shipPosition[0], -shipPosition[1], -shipPosition[2])
  })

  if (!spawnConfig) return null

  return (
    <group ref={beltGroupRef}>
      {geometries.map((geometry, geometryIndex) => {
        const instances = instancesByGeometry[geometryIndex] ?? []
        if (instances.length === 0) return null
        return (
          <instancedMesh
            key={`asteroid-instanced-${geometryIndex}-${spawnConfig.nonce}`}
            ref={(node) => {
              meshRefs.current[geometryIndex] = node
            }}
            args={[geometry, asteroidMaterial, instances.length]}
            frustumCulled={false}
            castShadow
            receiveShadow
          />
        )
      })}
    </group>
  )
}
