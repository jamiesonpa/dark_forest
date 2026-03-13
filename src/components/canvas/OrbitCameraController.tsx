import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import { getPlayerPivotAnchorName } from './PlayerShip'

const MIN_DISTANCE = 200
const MAX_DISTANCE = 2343.75
const SHIP_CENTER_PIVOT: [number, number, number] = [0, 0, 0]

export function OrbitCameraController() {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const shipPivotAnchorRef = useRef<THREE.Object3D | null>(null)
  const targetVecRef = useRef(new THREE.Vector3())
  const debugPivotEnabled = useGameStore((s) => s.debugPivotEnabled)
  const debugPivotPosition = useGameStore((s) => s.debugPivotPosition)
  const setDebugPivotPosition = useGameStore((s) => s.setDebugPivotPosition)
  const debugPivotDragging = useGameStore((s) => s.debugPivotDragging)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const localShipPosition = useGameStore((s) => s.ship.position)

  useFrame(({ scene }) => {
    const controls = controlsRef.current
    if (!controls) return

    if (debugPivotEnabled) {
      // debugPivotPosition is local-space relative to the local ship.
      const [px, py, pz] = localShipPosition
      const [tx, ty, tz] = debugPivotPosition
      targetVecRef.current.set(px + tx, py + ty, pz + tz)
    } else {
      if (!shipPivotAnchorRef.current || !shipPivotAnchorRef.current.parent) {
        shipPivotAnchorRef.current = scene.getObjectByName(getPlayerPivotAnchorName(localPlayerId)) ?? null
      }
      const shipPivotAnchor = shipPivotAnchorRef.current
      if (shipPivotAnchor) {
        shipPivotAnchor.getWorldPosition(targetVecRef.current)
      } else {
        targetVecRef.current.set(...SHIP_CENTER_PIVOT)
      }

      const localAnchor = shipPivotAnchor
        ? [
            shipPivotAnchor.position.x,
            shipPivotAnchor.position.y,
            shipPivotAnchor.position.z,
          ] as [number, number, number]
        : SHIP_CENTER_PIVOT
      const prevPivot = useGameStore.getState().debugPivotPosition
      if (
        Math.abs(localAnchor[0] - prevPivot[0]) > 0.001 ||
        Math.abs(localAnchor[1] - prevPivot[1]) > 0.001 ||
        Math.abs(localAnchor[2] - prevPivot[2]) > 0.001
      ) {
        setDebugPivotPosition(localAnchor)
      }
    }

    controls.enabled = !debugPivotDragging
    controls.target.copy(targetVecRef.current)
  }, 1)

  return (
    <OrbitControls
      ref={controlsRef}
      target={SHIP_CENTER_PIVOT}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      enablePan={false}
      enableZoom={true}
      zoomSpeed={1.2}
      rotateSpeed={0.4}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      }}
      enableDamping
      dampingFactor={0.05}
    />
  )
}
