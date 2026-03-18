import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import { B_SCOPE_AZ_LIMIT_DEG, B_SCOPE_RANGE_OPTIONS_KM } from '@/systems/ew/bScopeConstants'

const B_SCOPE_MAX_RANGE_M = Math.max(...B_SCOPE_RANGE_OPTIONS_KM) * 1000
const B_SCOPE_AZ_HALF_DEG = B_SCOPE_AZ_LIMIT_DEG
const CONE_LENGTH = B_SCOPE_MAX_RANGE_M
const CONE_RADIUS = Math.tan(THREE.MathUtils.degToRad(B_SCOPE_AZ_HALF_DEG)) * CONE_LENGTH

const OUT_DIR = new THREE.Vector3()
const NEG_OUT_DIR = new THREE.Vector3()
const CONE_POS = new THREE.Vector3()
const CONE_QUAT = new THREE.Quaternion()
const Y_AXIS = new THREE.Vector3(0, 1, 0)

export function BScopeRadarDebugCone() {
  const coneRef = useRef<THREE.Mesh>(null)
  const showBScopeRadarCone = useGameStore((s) => s.showBScopeRadarCone)

  useFrame(() => {
    const cone = coneRef.current
    if (!cone) return

    const ship = useGameStore.getState().ship
    const headingRad = THREE.MathUtils.degToRad(ship.actualHeading)
    const inclinationRad = THREE.MathUtils.degToRad(ship.actualInclination)
    const cosInclination = Math.cos(inclinationRad)

    OUT_DIR.set(
      -Math.sin(headingRad) * cosInclination,
      Math.sin(inclinationRad),
      Math.cos(headingRad) * cosInclination
    ).normalize()

    // ConeGeometry points toward +Y by default. Using -OUT aligns the cone tip at the ship nose.
    NEG_OUT_DIR.copy(OUT_DIR).multiplyScalar(-1)
    CONE_POS.set(ship.position[0], ship.position[1], ship.position[2]).addScaledVector(OUT_DIR, CONE_LENGTH * 0.5)
    CONE_QUAT.setFromUnitVectors(Y_AXIS, NEG_OUT_DIR)

    cone.position.copy(CONE_POS)
    cone.quaternion.copy(CONE_QUAT)
  })

  if (!showBScopeRadarCone) return null

  return (
    <mesh ref={coneRef} renderOrder={997} frustumCulled={false}>
      <coneGeometry args={[CONE_RADIUS, CONE_LENGTH, 32, 1, true]} />
      <meshBasicMaterial
        color={0x44ff66}
        transparent
        opacity={0.09}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  )
}
