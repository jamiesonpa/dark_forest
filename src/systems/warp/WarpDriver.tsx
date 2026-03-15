import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '@/state/gameStore'
import { multiplayerClient } from '@/network/colyseusClient'
import { getCelestialById } from '@/utils/systemData'
import {
  bearingInclinationFromVector,
  getDistanceScaledWarpDurationMs,
  getWorldShipPosition,
  isWarpAligned,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'

const ALIGN_STABLE_MS = 250
const LANDING_DURATION_MS = 1800
const ARRIVAL_OFFSET_DISTANCE = 100_000

type WarpSession = {
  startMs: number
  durationMs: number
  averageSpeed: number
  peakSpeed: number
  sourceCelestialId: string
  destinationCelestialId: string
  sourceWorldPosition: [number, number, number]
  sourceCelestialWorldPosition: [number, number, number]
  travelVector: [number, number, number]
}

type LandingSession = {
  startMs: number
  startSpeed: number
  fromPosition: [number, number, number]
  arrivalOffsetAtDestination: [number, number, number]
}

function smooth01(t: number) {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

export function WarpDriver() {
  const aligningSinceMsRef = useRef<number | null>(null)
  const warpSessionRef = useRef<WarpSession | null>(null)
  const landingSessionRef = useRef<LandingSession | null>(null)
  const lastMoveSendMsRef = useRef(0)
  const simNowMsRef = useRef(0)

  useFrame((_, delta) => {
    const dt = Math.min(0.1, Math.max(0.0001, delta))
    simNowMsRef.current += dt * 1000
    const nowMs = simNowMsRef.current

    const state = useGameStore.getState()
    const currentCelestial = getCelestialById(state.currentCelestialId)
    const selectedDestinationId = state.selectedWarpDestinationId
    const selectedDestination = selectedDestinationId ? getCelestialById(selectedDestinationId) : undefined

    if (currentCelestial && selectedDestination && selectedDestination.id !== currentCelestial.id) {
      const currentCelestialWorldPosition = worldPositionForCelestial(currentCelestial)
      const destinationWorldPosition = worldPositionForCelestial(selectedDestination)
      const vectorToDestination = vectorBetweenWorldPoints(
        currentCelestialWorldPosition,
        destinationWorldPosition
      )
      const { bearing, inclination } = bearingInclinationFromVector(vectorToDestination)
      const alignment = isWarpAligned(
        state.ship.actualHeading,
        state.ship.actualInclination,
        bearing,
        inclination
      )
      state.setWarpAlignmentStatus({
        requiredBearing: bearing,
        requiredInclination: inclination,
        totalErrorDeg: alignment.totalErrorDeg,
        aligned: alignment.aligned,
      })
    } else {
      state.setWarpAlignmentStatus({
        requiredBearing: state.ship.actualHeading,
        requiredInclination: state.ship.actualInclination,
        totalErrorDeg: Number.POSITIVE_INFINITY,
        aligned: false,
      })
    }

    if (state.warpState === 'aligning' && state.warpTargetId) {
      if (!state.warpAligned) {
        aligningSinceMsRef.current = null
        state.setWarpState('idle', null)
      } else {
        if (aligningSinceMsRef.current === null) {
          aligningSinceMsRef.current = nowMs
        }
        const stableMs = nowMs - aligningSinceMsRef.current
        if (stableMs >= ALIGN_STABLE_MS) {
          const sourceCelestial = getCelestialById(state.currentCelestialId)
          const destinationCelestial = getCelestialById(state.warpTargetId)
          if (sourceCelestial && destinationCelestial && destinationCelestial.id !== sourceCelestial.id) {
            const sourceCelestialWorld = worldPositionForCelestial(sourceCelestial)
            const sourceWorld = getWorldShipPosition(state.ship.position, sourceCelestialWorld)
            const destinationWorld = worldPositionForCelestial(destinationCelestial)
            const travelVector = vectorBetweenWorldPoints(sourceWorld, destinationWorld)
            const travelDistance = vectorMagnitude(travelVector)
            const durationMs = getDistanceScaledWarpDurationMs(travelDistance)
            const averageSpeed = travelDistance / Math.max(0.001, durationMs / 1000)
            const peakSpeed = averageSpeed * 1.5
            warpSessionRef.current = {
              startMs: nowMs,
              durationMs,
              averageSpeed,
              peakSpeed,
              sourceCelestialId: sourceCelestial.id,
              destinationCelestialId: destinationCelestial.id,
              sourceWorldPosition: sourceWorld,
              sourceCelestialWorldPosition: sourceCelestialWorld,
              travelVector,
            }
            state.setWarpTravelProgress(0)
            state.setWarpReferenceSpeed(peakSpeed)
            state.setWarpState('warping', destinationCelestial.id)
            multiplayerClient.sendWarpIntent({
              celestialId: destinationCelestial.id,
              requiredBearing: state.warpRequiredBearing,
              requiredInclination: state.warpRequiredInclination,
              alignmentErrorDeg: state.warpAlignmentErrorDeg,
              clientStartedAt: Date.now(),
            })
          } else {
            state.setWarpState('idle', null)
          }
        }
      }
    } else {
      aligningSinceMsRef.current = null
    }

    if (state.warpState === 'warping') {
      const session = warpSessionRef.current
      if (!session || !currentCelestial || currentCelestial.id !== session.sourceCelestialId) {
        state.setWarpState('idle', null)
        warpSessionRef.current = null
        state.setWarpTravelProgress(0)
      } else {
        const linearProgress = Math.min(1, Math.max(0, (nowMs - session.startMs) / session.durationMs))
        const easedProgress = smooth01(linearProgress)
        const speedProgress = Math.min(0.97, linearProgress)
        const bellCurve = 6 * speedProgress * (1 - speedProgress)
        const speedProfile = 0.22 + 0.78 * bellCurve
        const worldX = session.sourceWorldPosition[0] + session.travelVector[0] * easedProgress
        const worldY = session.sourceWorldPosition[1] + session.travelVector[1] * easedProgress
        const worldZ = session.sourceWorldPosition[2] + session.travelVector[2] * easedProgress
        const localX = worldX - session.sourceCelestialWorldPosition[0]
        const localY = worldY - session.sourceCelestialWorldPosition[1]
        const localZ = worldZ - session.sourceCelestialWorldPosition[2]
        const nextLocal: [number, number, number] = [localX, localY, localZ]

        const warpSpeed = session.peakSpeed * speedProfile
        state.setShipState({
          position: nextLocal,
          actualSpeed: warpSpeed,
          targetSpeed: 0,
          mwdActive: false,
          mwdRemaining: 0,
        })
        state.setWarpTravelProgress(linearProgress)

        if (multiplayerClient.isConnected()) {
          const nowMoveMs = performance.now()
          if (nowMoveMs - lastMoveSendMsRef.current >= 66) {
            multiplayerClient.sendMove({
              position: nextLocal,
              targetSpeed: 0,
              mwdActive: false,
              mwdRemaining: 0,
              mwdCooldownRemaining: state.ship.mwdCooldownRemaining,
              dampenersActive: state.ship.dampenersActive,
              bearing: state.ship.bearing,
              inclination: state.ship.inclination,
              actualHeading: state.ship.actualHeading,
              actualSpeed: warpSpeed,
              actualInclination: state.ship.actualInclination,
              rollAngle: state.ship.rollAngle,
            })
            lastMoveSendMsRef.current = nowMoveMs
          }
        }

        if (linearProgress >= 1) {
          const sourceCelestial = getCelestialById(session.sourceCelestialId)
          const destinationCelestial = getCelestialById(session.destinationCelestialId)
          let arrivalOffsetAtDestination: [number, number, number] = [0, 0, 0]
          if (sourceCelestial && destinationCelestial) {
            const sourceWorld = worldPositionForCelestial(sourceCelestial)
            const destinationWorld = worldPositionForCelestial(destinationCelestial)
            const fromDestinationToSource = vectorBetweenWorldPoints(destinationWorld, sourceWorld)
            const mag = vectorMagnitude(fromDestinationToSource)
            if (mag > 0.0001) {
              const nx = fromDestinationToSource[0] / mag
              const ny = fromDestinationToSource[1] / mag
              const nz = fromDestinationToSource[2] / mag
              arrivalOffsetAtDestination = [
                nx * ARRIVAL_OFFSET_DISTANCE,
                ny * ARRIVAL_OFFSET_DISTANCE,
                nz * ARRIVAL_OFFSET_DISTANCE,
              ]
            }
          }
          landingSessionRef.current = {
            startMs: nowMs,
            startSpeed: Math.max(warpSpeed, session.peakSpeed * 0.18),
            fromPosition: nextLocal,
            arrivalOffsetAtDestination,
          }
          state.setWarpState('landing', session.destinationCelestialId)
          warpSessionRef.current = null
        }
      }
    }

    if (state.warpState === 'landing') {
      const landing = landingSessionRef.current
      if (!landing) {
        state.finishWarp()
        state.setShipState({
          position: [0, 0, ARRIVAL_OFFSET_DISTANCE],
          actualSpeed: 0,
          targetSpeed: 0,
        })
        state.setWarpTravelProgress(1)
        state.setWarpReferenceSpeed(0)
      } else {
        const p = Math.min(1, Math.max(0, (nowMs - landing.startMs) / LANDING_DURATION_MS))
        const eased = smooth01(p)
        const nextLocal: [number, number, number] = [
          landing.fromPosition[0],
          landing.fromPosition[1],
          landing.fromPosition[2],
        ]
        state.setShipState({
          position: nextLocal,
          actualSpeed: Math.max(0, landing.startSpeed * (1 - eased)),
          targetSpeed: 0,
          mwdActive: false,
          mwdRemaining: 0,
        })
        if (p >= 1) {
          state.finishWarp()
          state.setShipState({
            position: landing.arrivalOffsetAtDestination,
            actualSpeed: 0,
            targetSpeed: 0,
          })
          state.setWarpTravelProgress(1)
          state.setWarpReferenceSpeed(0)
          landingSessionRef.current = null
        }
      }
    } else {
      landingSessionRef.current = null
    }
  })

  return null
}
