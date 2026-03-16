import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import type { NavAttitudeMode } from '@/state/types'
import { getPlayerPivotAnchorName } from './PlayerShip'

const MIN_DISTANCE = 200
const MAX_DISTANCE = 2343.75
const SHIP_CENTER_PIVOT: [number, number, number] = [0, 0, 0]
const CAMERA_REANCHOR_JUMP_DISTANCE = 5000
const DAC_CAMERA_DISTANCE = MAX_DISTANCE * 0.75
const DAC_CAMERA_LOOK_AHEAD = 140
const DAC_CAMERA_LERP_SPEED = 4.5
const AA_RESTORE_LERP_SPEED = 5.5

export function OrbitCameraController() {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const shipPivotAnchorRef = useRef<THREE.Object3D | null>(null)
  const targetVecRef = useRef(new THREE.Vector3())
  const prevTargetRef = useRef<THREE.Vector3 | null>(null)
  const targetDeltaRef = useRef(new THREE.Vector3())
  const dacForwardRef = useRef(new THREE.Vector3(0, 0, 1))
  const dacUpRef = useRef(new THREE.Vector3(0, 1, 0))
  const worldUpRef = useRef(new THREE.Vector3(0, 1, 0))
  const dacEulerRef = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const dacDesiredPositionRef = useRef(new THREE.Vector3())
  const dacLookTargetRef = useRef(new THREE.Vector3())
  const aaStoredOffsetRef = useRef(new THREE.Vector3(0, 0, MAX_DISTANCE * 0.45))
  const restoreToAaOffsetRef = useRef(false)
  const restoreStartDistanceRef = useRef(0)
  const prevNavModeRef = useRef<NavAttitudeMode>('AA')
  const debugPivotEnabled = useGameStore((s) => s.debugPivotEnabled)
  const debugPivotPosition = useGameStore((s) => s.debugPivotPosition)
  const setDebugPivotPosition = useGameStore((s) => s.setDebugPivotPosition)
  const debugPivotDragging = useGameStore((s) => s.debugPivotDragging)
  const warpState = useGameStore((s) => s.warpState)
  const navAttitudeMode = useGameStore((s) => s.navAttitudeMode)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const localShipPosition = useGameStore((s) => s.ship.position)

  useFrame(({ scene, camera }, delta) => {
    const controls = controlsRef.current
    if (!controls) return
    const dacActive = navAttitudeMode === 'DAC'
    const warpActive =
      warpState === 'aligning' ||
      warpState === 'warping' ||
      warpState === 'landing'
    const cameraObj = camera as THREE.PerspectiveCamera

    if (debugPivotEnabled) {
      // debugPivotPosition is local-space relative to the local ship.
      const [px, py, pz] = localShipPosition
      const [tx, ty, tz] = debugPivotPosition
      targetVecRef.current.set(px + tx, py + ty, pz + tz)
    } else {
      if (warpActive) {
        const liveShipPos = useGameStore.getState().ship.position
        targetVecRef.current.set(liveShipPos[0], liveShipPos[1], liveShipPos[2])
      } else if (!shipPivotAnchorRef.current || !shipPivotAnchorRef.current.parent) {
        shipPivotAnchorRef.current = scene.getObjectByName(getPlayerPivotAnchorName(localPlayerId)) ?? null
      }

      if (!shipPivotAnchorRef.current || !shipPivotAnchorRef.current.parent) {
        if (!warpActive) {
          shipPivotAnchorRef.current = scene.getObjectByName(getPlayerPivotAnchorName(localPlayerId)) ?? null
        }
      }
      const shipPivotAnchor = shipPivotAnchorRef.current
      if (!warpActive && shipPivotAnchor) {
        shipPivotAnchor.getWorldPosition(targetVecRef.current)
      } else {
        if (!warpActive) {
          targetVecRef.current.set(...SHIP_CENTER_PIVOT)
        }
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

    if (prevNavModeRef.current !== navAttitudeMode) {
      if (navAttitudeMode === 'DAC') {
        aaStoredOffsetRef.current.copy(cameraObj.position).sub(targetVecRef.current)
        if (aaStoredOffsetRef.current.lengthSq() < 0.000001) {
          aaStoredOffsetRef.current.set(0, 0, MAX_DISTANCE * 0.45)
        }
        restoreToAaOffsetRef.current = false
      } else {
        dacDesiredPositionRef.current.copy(targetVecRef.current).add(aaStoredOffsetRef.current)
        restoreStartDistanceRef.current = cameraObj.position.distanceTo(
          dacDesiredPositionRef.current
        )
        restoreToAaOffsetRef.current = true
      }
      prevNavModeRef.current = navAttitudeMode
    }

    // Prevent abrupt camera snaps when the target jumps between grid frames
    // (for example, right as warp landing re-anchors local coordinates).
    if (prevTargetRef.current) {
      targetDeltaRef.current.copy(targetVecRef.current).sub(prevTargetRef.current)
      const targetDeltaLen = targetDeltaRef.current.length()

      // During warp phases, co-translate camera with the moving target so the
      // player's chosen orbit framing remains stable.
      if (warpActive && targetDeltaLen > 0.000001) {
        cameraObj.position.add(targetDeltaRef.current)
      }

      // Only compensate large discontinuities (grid re-anchors), not normal
      // per-frame target motion, to avoid introducing micro-jitter in warp.
      if (
        warpState === 'idle' &&
        targetDeltaLen > CAMERA_REANCHOR_JUMP_DISTANCE
      ) {
        cameraObj.position.add(targetDeltaRef.current)
      }
    }
    if (!prevTargetRef.current) {
      prevTargetRef.current = new THREE.Vector3()
    }
    prevTargetRef.current.copy(targetVecRef.current)

    if (dacActive) {
      const liveShip = useGameStore.getState().ship
      const headingRad = THREE.MathUtils.degToRad(liveShip.actualHeading)
      const inclinationRad = THREE.MathUtils.degToRad(liveShip.actualInclination)
      const rollRad = THREE.MathUtils.degToRad(liveShip.rollAngle)

      // Match ship orientation convention exactly (same frame used by SimulationLoop/PlayerShip).
      dacEulerRef.current.set(-inclinationRad, -headingRad, rollRad, 'YXZ')
      dacForwardRef.current.set(0, 0, 1).applyEuler(dacEulerRef.current).normalize()
      dacUpRef.current.set(0, 1, 0).applyEuler(dacEulerRef.current).normalize()

      dacDesiredPositionRef.current
        .copy(targetVecRef.current)
        .addScaledVector(dacForwardRef.current, -DAC_CAMERA_DISTANCE)

      const followAlpha = 1 - Math.exp(-DAC_CAMERA_LERP_SPEED * Math.max(delta, 0))
      cameraObj.position.lerp(dacDesiredPositionRef.current, followAlpha)

      dacLookTargetRef.current
        .copy(targetVecRef.current)
        .addScaledVector(dacForwardRef.current, DAC_CAMERA_LOOK_AHEAD)
      cameraObj.up.lerp(dacUpRef.current, followAlpha).normalize()
      cameraObj.lookAt(dacLookTargetRef.current)
      controls.target.copy(dacLookTargetRef.current)
      controls.enabled = false
      return
    }

    if (restoreToAaOffsetRef.current) {
      const restoreAlpha = 1 - Math.exp(-AA_RESTORE_LERP_SPEED * Math.max(delta, 0))
      dacDesiredPositionRef.current.copy(targetVecRef.current).add(aaStoredOffsetRef.current)
      cameraObj.position.lerp(dacDesiredPositionRef.current, restoreAlpha)
      cameraObj.up.lerp(worldUpRef.current, restoreAlpha).normalize()
      controls.target.lerp(targetVecRef.current, restoreAlpha)
      controls.enabled = false
      controls.update()

      const startDistance = Math.max(restoreStartDistanceRef.current, 0.0001)
      const remainingDistance = cameraObj.position.distanceTo(
        dacDesiredPositionRef.current
      )
      if (remainingDistance <= startDistance * 0.05) {
        restoreToAaOffsetRef.current = false
      }
      return
    }

    controls.enabled = !debugPivotDragging
    cameraObj.up.copy(worldUpRef.current)
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
      enableDamping={warpState === 'idle'}
      dampingFactor={0.05}
    />
  )
}
