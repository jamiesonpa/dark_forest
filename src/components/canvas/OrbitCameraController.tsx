import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import type { WarpState } from '@/types/game'

const MIN_DISTANCE = 200
const MAX_DISTANCE = 2343.75
const SHIP_CENTER_PIVOT: [number, number, number] = [0, 0, 0]
const DAC_CAMERA_DISTANCE = MAX_DISTANCE * 0.75
const DAC_CAMERA_LOOK_AHEAD = 140
const DAC_CAMERA_LERP_SPEED = 4.5
const WARP_CAMERA_LERP_SPEED = 6
const WARP_CAMERA_LOOK_AHEAD = 140
const AA_RESTORE_LERP_SPEED = 5.5

type WarpCameraPhase = 'idle' | 'entry' | 'transit' | 'landing'

function getWarpCameraPhase(
  warpState: WarpState,
  inWarpTransit: boolean
): WarpCameraPhase {
  if (warpState === 'aligning') return 'entry'
  if (warpState === 'warping') {
    return inWarpTransit ? 'transit' : 'entry'
  }
  if (warpState === 'landing') return 'landing'
  return 'idle'
}

export function OrbitCameraController() {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const shipAnchorWorldQuaternionRef = useRef(new THREE.Quaternion())
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
  const warpStoredOffsetRef = useRef(new THREE.Vector3(0, 0, MAX_DISTANCE * 0.45))
  const warpCurrentOffsetRef = useRef(new THREE.Vector3(0, 0, MAX_DISTANCE * 0.45))
  const warpFollowDistanceRef = useRef(MAX_DISTANCE * 0.45)
  const warpBlendProgressRef = useRef(1)
  const restoreToAaOffsetRef = useRef(false)
  const restoreStartDistanceRef = useRef(0)
  const prevNavModeRef = useRef(useGameStore.getState().navAttitudeMode)
  const prevWarpStateRef = useRef(useGameStore.getState().warpState)
  const prevWarpCameraPhaseRef = useRef<WarpCameraPhase>(
    getWarpCameraPhase(
      useGameStore.getState().warpState,
      useGameStore.getState().ship.inWarpTransit
    )
  )

  useFrame(({ camera }, delta) => {
    const controls = controlsRef.current
    if (!controls) return
    const cameraObj = camera as THREE.PerspectiveCamera

    const state = useGameStore.getState()
    const liveShip = state.ship
    const warpState = state.warpState
    const navAttitudeMode = state.navAttitudeMode
    const debugPivotEnabled = state.debugPivotEnabled
    const debugPivotPosition = state.debugPivotPosition
    const debugPivotDragging = state.debugPivotDragging
    const dacActive = navAttitudeMode === 'DAC'

    if (debugPivotEnabled) {
      const [px, py, pz] = liveShip.position
      const [tx, ty, tz] = debugPivotPosition
      targetVecRef.current.set(px + tx, py + ty, pz + tz)
    } else {
      targetVecRef.current.set(liveShip.position[0], liveShip.position[1], liveShip.position[2])
    }

    // Rigid follow applied early so every code path starts from a camera
    // that already tracks the ship's position delta.  Path-specific logic
    // (warp lock-behind, DAC, restore) can override afterwards.
    if (prevTargetRef.current) {
      targetDeltaRef.current.copy(targetVecRef.current).sub(prevTargetRef.current)
    } else {
      targetDeltaRef.current.set(0, 0, 0)
      prevTargetRef.current = new THREE.Vector3()
    }
    prevTargetRef.current.copy(targetVecRef.current)
    cameraObj.position.add(targetDeltaRef.current)

    const headingRad = THREE.MathUtils.degToRad(liveShip.actualHeading)
    const inclinationRad = THREE.MathUtils.degToRad(liveShip.actualInclination)
    const rollRad = THREE.MathUtils.degToRad(liveShip.rollAngle)
    dacEulerRef.current.set(-inclinationRad, -headingRad, rollRad, 'YXZ')
    shipAnchorWorldQuaternionRef.current.setFromEuler(dacEulerRef.current)

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

    const warpCameraPhase = getWarpCameraPhase(
      warpState,
      liveShip.inWarpTransit
    )
    const warpStateChanged = prevWarpStateRef.current !== warpState
    const warpPhaseChanged = prevWarpCameraPhaseRef.current !== warpCameraPhase
    const warpActive = warpCameraPhase !== 'idle'
    const enteringWarp = warpStateChanged && warpActive && prevWarpStateRef.current === 'idle'
    const exitingWarp = warpStateChanged && !warpActive && prevWarpStateRef.current !== 'idle'
    const warpLockBehindActive =
      !dacActive &&
      (warpCameraPhase === 'entry' || warpCameraPhase === 'landing')
    if (warpStateChanged && !dacActive) {
      if (enteringWarp) {
        warpStoredOffsetRef.current.copy(cameraObj.position).sub(targetVecRef.current)
        if (warpStoredOffsetRef.current.lengthSq() < 0.000001) {
          warpStoredOffsetRef.current.set(0, 0, MAX_DISTANCE * 0.45)
        }
        warpFollowDistanceRef.current = THREE.MathUtils.clamp(
          warpStoredOffsetRef.current.length(),
          MIN_DISTANCE,
          MAX_DISTANCE
        )
        warpBlendProgressRef.current = 0
        restoreToAaOffsetRef.current = false
      } else if (exitingWarp) {
        aaStoredOffsetRef.current.copy(cameraObj.position).sub(targetVecRef.current)
        if (aaStoredOffsetRef.current.lengthSq() < 0.000001) {
          aaStoredOffsetRef.current.set(0, 0, MAX_DISTANCE * 0.45)
        }
        warpBlendProgressRef.current = 1
        restoreToAaOffsetRef.current = false
      }
    }
    if (
      warpPhaseChanged &&
      !dacActive &&
      (warpCameraPhase === 'entry' || warpCameraPhase === 'landing')
    ) {
      warpStoredOffsetRef.current.copy(cameraObj.position).sub(targetVecRef.current)
      if (warpStoredOffsetRef.current.lengthSq() < 0.000001) {
        warpStoredOffsetRef.current.set(0, 0, MAX_DISTANCE * 0.45)
      }
      warpFollowDistanceRef.current = THREE.MathUtils.clamp(
        warpStoredOffsetRef.current.length(),
        MIN_DISTANCE,
        MAX_DISTANCE
      )
      warpBlendProgressRef.current = 0
      restoreToAaOffsetRef.current = false
    }

    prevWarpStateRef.current = warpState
    prevWarpCameraPhaseRef.current = warpCameraPhase
    dacForwardRef.current
      .set(0, 0, 1)
      .applyQuaternion(shipAnchorWorldQuaternionRef.current)
      .normalize()
    dacUpRef.current
      .set(0, 1, 0)
      .applyQuaternion(shipAnchorWorldQuaternionRef.current)
      .normalize()

    if (dacActive) {
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

    if (warpLockBehindActive) {
      dacLookTargetRef.current
        .copy(targetVecRef.current)
        .addScaledVector(dacForwardRef.current, WARP_CAMERA_LOOK_AHEAD)

      warpCurrentOffsetRef.current
        .copy(dacForwardRef.current)
        .multiplyScalar(-warpFollowDistanceRef.current)

      if (warpBlendProgressRef.current < 0.999) {
        const warpFollowAlpha = 1 - Math.exp(-WARP_CAMERA_LERP_SPEED * Math.max(delta, 0))
        warpBlendProgressRef.current +=
          (1 - warpBlendProgressRef.current) * warpFollowAlpha
        warpCurrentOffsetRef.current.lerp(
          warpStoredOffsetRef.current,
          1 - warpBlendProgressRef.current
        )
        cameraObj.position.copy(targetVecRef.current).add(warpCurrentOffsetRef.current)
        cameraObj.up.lerp(dacUpRef.current, warpFollowAlpha).normalize()
      } else {
        cameraObj.position
          .copy(targetVecRef.current)
          .addScaledVector(dacForwardRef.current, -warpFollowDistanceRef.current)
        cameraObj.up.copy(dacUpRef.current)
      }

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
    controls.enableDamping = warpState === 'idle'
    controls.dampingFactor = 0.05
  }, -1.5)

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
      dampingFactor={0.05}
    />
  )
}
