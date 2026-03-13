import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import { IRSTCameraSphereRadius } from './IRSTCamera'

const CONE_LENGTH = 260
const CONE_RADIUS = 70

const OUT_DIR = new THREE.Vector3()
const CONE_POS = new THREE.Vector3()
const CONE_QUAT = new THREE.Quaternion()
const Y_AXIS = new THREE.Vector3(0, 1, 0)

export function IRSTCameraDebugCone() {
  const coneRef = useRef<THREE.Mesh>(null)
  const showIRSTCone = useGameStore((s) => s.showIRSTCone)

  useFrame(() => {
    const cone = coneRef.current
    if (!cone) return

    const ship = useGameStore.getState().ship
    const bearingRad = THREE.MathUtils.degToRad(ship.irstBearing)
    const inclinationRad = THREE.MathUtils.degToRad(ship.irstInclination)

    OUT_DIR.set(
      Math.sin(bearingRad) * Math.cos(inclinationRad),
      Math.sin(inclinationRad),
      Math.cos(bearingRad) * Math.cos(inclinationRad),
    ).normalize()

    const [shipX, shipY, shipZ] = ship.position
    const camX = shipX + OUT_DIR.x * IRSTCameraSphereRadius
    const camY = shipY + OUT_DIR.y * IRSTCameraSphereRadius
    const camZ = shipZ + OUT_DIR.z * IRSTCameraSphereRadius

    CONE_POS.set(camX, camY, camZ).addScaledVector(OUT_DIR, CONE_LENGTH * 0.5)
    CONE_QUAT.setFromUnitVectors(Y_AXIS, OUT_DIR)

    cone.position.copy(CONE_POS)
    cone.quaternion.copy(CONE_QUAT)
  })

  if (!showIRSTCone) return null

  return (
    <mesh ref={coneRef} renderOrder={998}>
      <coneGeometry args={[CONE_RADIUS, CONE_LENGTH, 20, 1, true]} />
      <meshBasicMaterial
        color={0xff2222}
        transparent
        opacity={0.35}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  )
}
