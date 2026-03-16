import { useMemo } from 'react'
import * as THREE from 'three'
import type { Celestial, CelestialType } from '@/types/game'

interface CelestialBodyProps {
  celestial: Celestial
  isDistant?: boolean
}

function getColor(type: CelestialType): number {
  switch (type) {
    case 'star':
      return 0xffdd88
    case 'planet':
      return 0x4488cc
    case 'moon':
      return 0x888888
    case 'asteroid_belt':
      return 0x8b7355
    default:
      return 0x666666
  }
}

export function CelestialBody({ celestial, isDistant }: CelestialBodyProps) {
  const isSphericalCelestial =
    celestial.type === 'star' ||
    celestial.type === 'planet' ||
    celestial.type === 'moon' ||
    celestial.type === 'asteroid_belt'
  const radius = celestial.radius ?? 100
  const color = getColor(celestial.type)

  const geometry = useMemo(() => {
    if (celestial.type === 'star') {
      return new THREE.SphereGeometry(radius, 32, 32)
    }
    return new THREE.SphereGeometry(radius, 32, 32)
  }, [celestial.type, radius])

  const material = useMemo(() => {
    if (isDistant) {
      return new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
      })
    }
    if (celestial.type === 'star') {
      return new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
      })
    }
    return new THREE.MeshStandardMaterial({
      color,
      metalness: 0.3,
      roughness: 0.7,
    })
  }, [celestial.type, color, isDistant])

  if (isSphericalCelestial) {
    return null
  }

  if (isDistant) {
    return (
      <group position={celestial.position}>
        <mesh geometry={geometry} material={material} />
      </group>
    )
  }

  return (
    <group position={[0, 0, 0]}>
      <mesh geometry={geometry} material={material} castShadow receiveShadow />
      {celestial.type === 'star' && (
        <pointLight color={color} intensity={2} distance={3000} />
      )}
    </group>
  )
}
