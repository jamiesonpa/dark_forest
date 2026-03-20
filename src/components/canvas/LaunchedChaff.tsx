import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'

const MAX_INSTANCES = 2048
const BASE_SCALE = 13

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i += 1) {
    h = Math.imul(31, h) + id.charCodeAt(i) | 0
  }
  return h
}

function fract01(n: number) {
  return n - Math.floor(n)
}

function seed01(h: number, salt: number) {
  return fract01(Math.sin(h * 12.9898 + salt * 78.233) * 43758.5453)
}

export function LaunchedChaff() {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const advanceLaunchedChaff = useGameStore((s) => s.advanceLaunchedChaff)

  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xd4dae6,
        metalness: 0.93,
        roughness: 0.12,
        side: THREE.DoubleSide,
        transparent: false,
        depthWrite: true,
      }),
    []
  )

  useEffect(() => {
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material])

  useFrame((_state, deltaSeconds) => {
    advanceLaunchedChaff(deltaSeconds)
    const mesh = meshRef.current
    if (!mesh) return

    const latest = useGameStore.getState()
    const pieces = [...latest.launchedChaff, ...latest.remoteLaunchedChaff].filter(
      (p) => p.currentCelestialId === latest.currentCelestialId
    )
    const n = Math.min(pieces.length, MAX_INSTANCES)

    for (let i = 0; i < n; i += 1) {
      const piece = pieces[i]!
      const h = hashId(piece.id)
      const scale = BASE_SCALE * (0.5 + seed01(h, 1) * 1.05)
      const rx = piece.flightTimeSeconds * (2.0 + seed01(h, 2) * 5.5)
      const ry = piece.flightTimeSeconds * (2.5 + seed01(h, 3) * 5.5)
      const rz = piece.flightTimeSeconds * (2.2 + seed01(h, 4) * 5.5)
      dummy.position.set(piece.position[0], piece.position[1], piece.position[2])
      dummy.rotation.set(rx, ry, rz)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.count = n
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, MAX_INSTANCES]}
      frustumCulled={false}
    />
  )
}
