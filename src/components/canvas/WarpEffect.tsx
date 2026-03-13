import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export function WarpEffect() {
  const meshRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<THREE.MeshBasicMaterial>(null)

  const geometry = useMemo(() => {
    const curve = new THREE.LineCurve3(
      new THREE.Vector3(0, 0, -5000),
      new THREE.Vector3(0, 0, 5000)
    )
    const tubeRadius = 800
    const radialSegments = 32
    const tubularSegments = 64
    return new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, radialSegments, false)
  }, [])

  useFrame((_, delta) => {
    const mat = materialRef.current
    if (!mat) return
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, 0.4, delta * 2)
  })

  return (
    <mesh ref={meshRef} geometry={geometry} renderOrder={1000}>
      <meshBasicMaterial
        ref={materialRef}
        color={0x4488ff}
        transparent
        opacity={0.3}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  )
}
