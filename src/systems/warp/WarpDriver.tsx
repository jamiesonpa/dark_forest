import { useEffect, useRef } from 'react'
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
const LANDING_DURATION_MS = 700

type WarpSession = {
  startMs: number
  durationMs: number
  sourceCelestialId: string
  destinationCelestialId: string
  sourceWorldPosition: [number, number, number]
  sourceCelestialWorldPosition: [number, number, number]
  travelVector: [number, number, number]
}

type LandingSession = {
  startMs: number
  fromPosition: [number, number, number]
}

function smooth01(t: number) {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

export function WarpDriver() {
  const rafRef = useRef<number | null>(null)
  const lastTickMsRef = useRef<number>(performance.now())
  const aligningSinceMsRef = useRef<number | null>(null)
  const warpSessionRef = useRef<WarpSession | null>(null)
  const landingSessionRef = useRef<LandingSession | null>(null)
  const lastMoveSendMsRef = useRef(0)

  useEffect(() => {
    const tick = () => {
      const nowMs = performance.now()
      const dt = Math.min(0.1, Math.max(0.0001, (nowMs - lastTickMsRef.current) / 1000))
      lastTickMsRef.current = nowMs

      const state = useGameStore.getState()
      const currentCelestial = getCelestialById(state.currentCelestialId)
      const selectedDestinationId = state.selectedWarpDestinationId
      const selectedDestination = selectedDestinationId ? getCelestialById(selectedDestinationId) : undefined

      if (currentCelestial && selectedDestination && selectedDestination.id !== currentCelestial.id) {
        const currentCelestialWorldPosition = worldPositionForCelestial(currentCelestial)
        const destinationWorldPosition = worldPositionForCelestial(selectedDestination)
        // Keep required alignment fixed to grid-to-grid vector.
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
              warpSessionRef.current = {
                startMs: nowMs,
                durationMs,
                sourceCelestialId: sourceCelestial.id,
                destinationCelestialId: destinationCelestial.id,
                sourceWorldPosition: sourceWorld,
                sourceCelestialWorldPosition: sourceCelestialWorld,
                travelVector,
              }
              state.setWarpTravelProgress(0)
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
          const worldX = session.sourceWorldPosition[0] + session.travelVector[0] * easedProgress
          const worldY = session.sourceWorldPosition[1] + session.travelVector[1] * easedProgress
          const worldZ = session.sourceWorldPosition[2] + session.travelVector[2] * easedProgress
          const localX = worldX - session.sourceCelestialWorldPosition[0]
          const localY = worldY - session.sourceCelestialWorldPosition[1]
          const localZ = worldZ - session.sourceCelestialWorldPosition[2]
          const nextLocal: [number, number, number] = [localX, localY, localZ]

          const warpSpeed = vectorMagnitude(session.travelVector) / Math.max(0.001, session.durationMs / 1000)
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
              multiplayerClient.sendMove(nextLocal)
              lastMoveSendMsRef.current = nowMoveMs
            }
          }

          if (linearProgress >= 1) {
            landingSessionRef.current = {
              startMs: nowMs,
              fromPosition: nextLocal,
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
          state.setShipState({ position: [0, 0, 0], actualSpeed: 0, targetSpeed: 0 })
          state.setWarpTravelProgress(1)
        } else {
          const p = Math.min(1, Math.max(0, (nowMs - landing.startMs) / LANDING_DURATION_MS))
          const eased = smooth01(p)
          const from = landing.fromPosition
          const nextLocal: [number, number, number] = [
            from[0] * (1 - eased),
            from[1] * (1 - eased),
            from[2] * (1 - eased),
          ]
          state.setShipState({
            position: nextLocal,
            actualSpeed: Math.max(0, state.ship.actualSpeed * (1 - dt * 3)),
            targetSpeed: 0,
            mwdActive: false,
            mwdRemaining: 0,
          })
          if (p >= 1) {
            state.setShipState({ position: [0, 0, 0], actualSpeed: 0, targetSpeed: 0 })
            state.setWarpTravelProgress(1)
            state.finishWarp()
            landingSessionRef.current = null
          }
        }
      } else {
        landingSessionRef.current = null
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  return null
}
