import { useMemo } from 'react'
import * as THREE from 'three'
import type { Celestial } from '@/types/game'

interface CelestialGridContentsProps {
  celestial: Celestial
}

interface AsteroidInstance {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
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
  const geometry = useMemo(() => new THREE.DodecahedronGeometry(1, 0), [])
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x75624e,
        roughness: 0.94,
        metalness: 0.04,
        flatShading: true,
      }),
    []
  )

  const asteroids = useMemo(() => {
    const random = createSeededRandom(
      `${celestial.id}:${celestial.gridRadius}:${celestial.position.join(':')}`
    )
    const clusterRadius = Math.max(650, celestial.gridRadius * 0.55)
    const clusterHeight = Math.max(220, celestial.gridRadius * 0.22)
    const minScale = Math.max(28, celestial.gridRadius * 0.015)
    const maxScale = Math.max(minScale + 20, celestial.gridRadius * 0.065)

    return Array.from({ length: 100 }, (): AsteroidInstance => {
      const angle = random() * Math.PI * 2
      const radialDistance = Math.sqrt(random()) * clusterRadius
      return {
        position: [
          Math.cos(angle) * radialDistance,
          (random() * 2 - 1) * clusterHeight,
          Math.sin(angle) * radialDistance,
        ],
        rotation: [
          random() * Math.PI * 2,
          random() * Math.PI * 2,
          random() * Math.PI * 2,
        ],
        scale: THREE.MathUtils.lerp(minScale, maxScale, random()),
      }
    })
  }, [celestial])

  return (
    <group>
      {asteroids.map((asteroid, index) => (
        <mesh
          key={`${celestial.id}-asteroid-${index}`}
          geometry={geometry}
          material={material}
          position={asteroid.position}
          rotation={asteroid.rotation}
          scale={asteroid.scale}
          castShadow
          receiveShadow
        />
      ))}
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
