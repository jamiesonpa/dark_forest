import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGameStore } from '@/state/gameStore'
import { multiplayerClient } from '@/network/colyseusClient'
import { sendMoveIfDue } from '@/systems/simulation/networkSync'
import { getCelestialById } from '@/utils/systemData'
import {
  bearingInclinationFromVector,
  getDistanceScaledWarpDurationMs,
  isWarpAligned,
  WARP_ALIGNMENT_TOLERANCE_DEG,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'

const ALIGN_STABLE_MS = 250
const SOURCE_GRID_EXIT_DURATION_MS = 1500
const SOURCE_GRID_EXIT_DISTANCE = 120_000
const SOURCE_GRID_PROGRESS_END = 0.12
const OFF_GRID_CRUISE_MIN_MS = 5000
const LANDING_DURATION_MS = 4200
const ARRIVAL_PROGRESS_START = 0.88
const ARRIVAL_START_DISTANCE = 260_000
const WARP_ARRIVAL_MIN_DISTANCE_M = 15_000
const WARP_ARRIVAL_MAX_DISTANCE_M = 50_000

function clampWarpArrivalDistanceMeters(distanceKm: number) {
  const rawMeters = distanceKm * 1000
  if (!Number.isFinite(rawMeters)) return WARP_ARRIVAL_MIN_DISTANCE_M
  return Math.max(
    WARP_ARRIVAL_MIN_DISTANCE_M,
    Math.min(WARP_ARRIVAL_MAX_DISTANCE_M, rawMeters)
  )
}

type WarpSession = {
  startMs: number
  cruiseStartMs: number | null
  cruiseDurationMs: number
  startSpeed: number
  peakSpeed: number
  sourceCelestialId: string
  destinationCelestialId: string
  departureDirection: [number, number, number]
  sourceStartLocalPosition: [number, number, number]
  arrivalStartOffsetAtDestination: [number, number, number]
  arrivalRestOffsetAtDestination: [number, number, number]
}

type LandingSession = {
  startMs: number
  startSpeed: number
  fromPosition: [number, number, number]
  restPosition: [number, number, number]
  approachBearing: number
  approachInclination: number
}

function easeInCubic(t: number) {
  const x = Math.max(0, Math.min(1, t))
  return x * x * x * x * x
}

function easeOutCubic(t: number) {
  const x = Math.max(0, Math.min(1, t))
  return 1 - (1 - x) ** 3
}

function scaleVector(
  vector: readonly [number, number, number],
  scalar: number
): [number, number, number] {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar]
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
    const currentCelestial = getCelestialById(state.currentCelestialId, state.starSystem)
    const selectedDestinationId = state.selectedWarpDestinationId
    const revealedDestinationIds = new Set(
      state.ewRevealedCelestialIds.filter((id) => id !== state.currentCelestialId)
    )
    const selectedDestination = selectedDestinationId
      ? getCelestialById(selectedDestinationId, state.starSystem)
      : undefined

    if (currentCelestial) {
      const currentCelestialWorldPosition = worldPositionForCelestial(currentCelestial)
      const candidateAlignments = state.starSystem.celestials
        .filter((c) => revealedDestinationIds.has(c.id) && c.id !== currentCelestial.id && c.type !== 'star')
        .map((destinationCelestial) => {
          const destinationWorldPosition = worldPositionForCelestial(destinationCelestial)
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
          return {
            id: destinationCelestial.id,
            bearing,
            inclination,
            alignment,
          }
        })

      const bestCandidate = candidateAlignments.reduce<(typeof candidateAlignments)[number] | null>(
        (best, current) => {
          if (!best) return current
          return current.alignment.totalErrorDeg < best.alignment.totalErrorDeg ? current : best
        },
        null
      )

      // If the pilot lines up a different visible pip, follow that alignment target
      // so G/WARP corresponds to what the pilot is currently aiming at.
      if (
        state.warpState === 'idle' &&
        bestCandidate &&
        bestCandidate.alignment.totalErrorDeg <= WARP_ALIGNMENT_TOLERANCE_DEG &&
        bestCandidate.id !== selectedDestinationId
      ) {
        state.setSelectedWarpDestination(bestCandidate.id)
      }

      const activeTargetId =
        (state.warpState === 'idle' &&
          bestCandidate &&
          bestCandidate.alignment.totalErrorDeg <= WARP_ALIGNMENT_TOLERANCE_DEG)
          ? bestCandidate.id
          : selectedDestination?.id
      const activeAlignment = activeTargetId
        ? candidateAlignments.find((c) => c.id === activeTargetId)
        : undefined

      if (activeAlignment) {
        state.setWarpAlignmentStatus({
          requiredBearing: activeAlignment.bearing,
          requiredInclination: activeAlignment.inclination,
          totalErrorDeg: activeAlignment.alignment.totalErrorDeg,
          aligned: activeAlignment.alignment.aligned,
        })
      } else {
        state.setWarpAlignmentStatus({
          requiredBearing: state.ship.actualHeading,
          requiredInclination: state.ship.actualInclination,
          totalErrorDeg: Number.POSITIVE_INFINITY,
          aligned: false,
        })
      }
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
          const sourceCelestial = getCelestialById(state.currentCelestialId, state.starSystem)
          const destinationCelestial = getCelestialById(state.warpTargetId, state.starSystem)
          if (sourceCelestial && destinationCelestial && destinationCelestial.id !== sourceCelestial.id) {
            const sourceWorld = worldPositionForCelestial(sourceCelestial)
            const destinationWorld = worldPositionForCelestial(destinationCelestial)
            const travelVector = vectorBetweenWorldPoints(sourceWorld, destinationWorld)
            const travelDistance = vectorMagnitude(travelVector)
            const cruiseDurationMs = Math.max(
              OFF_GRID_CRUISE_MIN_MS,
              getDistanceScaledWarpDurationMs(travelDistance)
            )
            const averageSpeed =
              travelDistance / Math.max(0.001, cruiseDurationMs / 1000)
            const travelMagnitude = Math.max(0.0001, vectorMagnitude(travelVector))
            const departureDirection: [number, number, number] = [
              travelVector[0] / travelMagnitude,
              travelVector[1] / travelMagnitude,
              travelVector[2] / travelMagnitude,
            ]
            const arrivalApproachDirection = scaleVector(departureDirection, -1)
            const arrivalRestDistance = clampWarpArrivalDistanceMeters(state.warpArrivalDistanceKm)
            const peakSpeed = Math.max(
              averageSpeed * 1.5,
              SOURCE_GRID_EXIT_DISTANCE / Math.max(0.001, SOURCE_GRID_EXIT_DURATION_MS / 1000)
            )
            warpSessionRef.current = {
              startMs: nowMs,
              cruiseStartMs: null,
              cruiseDurationMs,
              startSpeed: Math.max(state.ship.actualSpeed, state.ship.targetSpeed, 0),
              peakSpeed,
              sourceCelestialId: sourceCelestial.id,
              destinationCelestialId: destinationCelestial.id,
              departureDirection,
              sourceStartLocalPosition: [...state.ship.position],
              arrivalStartOffsetAtDestination: scaleVector(
                arrivalApproachDirection,
                ARRIVAL_START_DISTANCE
              ),
              arrivalRestOffsetAtDestination: scaleVector(
                arrivalApproachDirection,
                arrivalRestDistance
              ),
            }
            state.setWarpTravelProgress(0)
            state.setWarpReferenceSpeed(peakSpeed)
            state.setWarpState('warping', destinationCelestial.id)
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
      if (!session) {
        state.setWarpState('idle', null)
        warpSessionRef.current = null
        state.setWarpTravelProgress(0)
      } else {
        if (session.cruiseStartMs === null) {
          if (!currentCelestial || currentCelestial.id !== session.sourceCelestialId) {
            state.setWarpState('idle', null)
            warpSessionRef.current = null
            state.setWarpTravelProgress(0)
            state.setShipState({ inWarpTransit: false })
          } else {
            const phaseProgress = Math.min(
              1,
              Math.max(0, (nowMs - session.startMs) / SOURCE_GRID_EXIT_DURATION_MS)
            )
            const departureEase = easeInCubic(phaseProgress)
            const departureOffset = scaleVector(
              session.departureDirection,
              SOURCE_GRID_EXIT_DISTANCE * departureEase
            )
            const nextLocal: [number, number, number] = [
              session.sourceStartLocalPosition[0] + departureOffset[0],
              session.sourceStartLocalPosition[1] + departureOffset[1],
              session.sourceStartLocalPosition[2] + departureOffset[2],
            ]
            const warpSpeed =
              session.startSpeed + (session.peakSpeed - session.startSpeed) * departureEase
            state.setShipState({
              position: nextLocal,
              actualSpeed: warpSpeed,
              targetSpeed: 0,
              mwdActive: false,
              mwdRemaining: 0,
              inWarpTransit: false,
            })
            state.setWarpTravelProgress(SOURCE_GRID_PROGRESS_END * phaseProgress)

            sendMoveIfDue(lastMoveSendMsRef, {
              position: nextLocal,
              revealedCelestialIds: state.ewRevealedCelestialIds,
              launchedCylinders: state.launchedCylinders,
              launchedFlares: state.launchedFlares,
              launchedChaff: state.launchedChaff,
              torpedoExplosions: state.torpedoExplosions,
              inWarpTransit: false,
              targetSpeed: 0,
              mwdActive: false,
              mwdRemaining: 0,
              mwdCooldownRemaining: state.ship.mwdCooldownRemaining,
              dampenersActive: state.ship.dampenersActive,
              shieldsUp: state.ship.shieldsUp,
              shieldOnlineLevel: state.ship.shieldOnlineLevel,
              shieldRechargeRatePct: state.ship.shieldRechargeRatePct,
              shield: state.ship.shield,
              armor: state.ship.armor,
              hull: state.ship.hull,
              bearing: state.ship.bearing,
              inclination: state.ship.inclination,
              actualVelocity: state.ship.actualVelocity,
              actualHeading: state.ship.actualHeading,
              actualSpeed: warpSpeed,
              actualInclination: state.ship.actualInclination,
              rollAngle: state.ship.rollAngle,
            })

            if (phaseProgress >= 1) {
              session.cruiseStartMs = nowMs
              state.setCurrentCelestial(session.destinationCelestialId)
              state.setShipState({
                position: [0, 0, 0],
                actualSpeed: session.peakSpeed,
                targetSpeed: 0,
                mwdActive: false,
                mwdRemaining: 0,
                inWarpTransit: true,
              })
              state.setWarpTravelProgress(SOURCE_GRID_PROGRESS_END)
              multiplayerClient.sendWarpIntent({
                celestialId: session.destinationCelestialId,
                requiredBearing: state.warpRequiredBearing,
                requiredInclination: state.warpRequiredInclination,
                alignmentErrorDeg: state.warpAlignmentErrorDeg,
                clientStartedAt: Date.now(),
              })
              multiplayerClient.sendMove({
                position: [0, 0, 0],
                revealedCelestialIds: state.ewRevealedCelestialIds,
                launchedCylinders: state.launchedCylinders,
                launchedFlares: state.launchedFlares,
                launchedChaff: state.launchedChaff,
                torpedoExplosions: state.torpedoExplosions,
                inWarpTransit: true,
                targetSpeed: 0,
                mwdActive: false,
                mwdRemaining: 0,
                mwdCooldownRemaining: state.ship.mwdCooldownRemaining,
                dampenersActive: state.ship.dampenersActive,
                shieldsUp: state.ship.shieldsUp,
                shieldOnlineLevel: state.ship.shieldOnlineLevel,
                shieldRechargeRatePct: state.ship.shieldRechargeRatePct,
                shield: state.ship.shield,
                armor: state.ship.armor,
                hull: state.ship.hull,
                bearing: state.ship.bearing,
                inclination: state.ship.inclination,
                actualVelocity: state.ship.actualVelocity,
                actualHeading: state.ship.actualHeading,
                actualSpeed: session.peakSpeed,
                actualInclination: state.ship.actualInclination,
                rollAngle: state.ship.rollAngle,
              })
            }
          }
        } else {
          const cruiseProgress = Math.min(
            1,
            Math.max(0, (nowMs - session.cruiseStartMs) / session.cruiseDurationMs)
          )
          state.setShipState({
            position: [0, 0, 0],
            actualSpeed: session.peakSpeed,
            targetSpeed: 0,
            mwdActive: false,
            mwdRemaining: 0,
            inWarpTransit: true,
          })
          state.setWarpTravelProgress(
            SOURCE_GRID_PROGRESS_END +
              (ARRIVAL_PROGRESS_START - SOURCE_GRID_PROGRESS_END) * cruiseProgress
          )

          sendMoveIfDue(lastMoveSendMsRef, {
            position: [0, 0, 0],
            revealedCelestialIds: state.ewRevealedCelestialIds,
            launchedCylinders: state.launchedCylinders,
            launchedFlares: state.launchedFlares,
            launchedChaff: state.launchedChaff,
            torpedoExplosions: state.torpedoExplosions,
            inWarpTransit: true,
            targetSpeed: 0,
            mwdActive: false,
            mwdRemaining: 0,
            mwdCooldownRemaining: state.ship.mwdCooldownRemaining,
            dampenersActive: state.ship.dampenersActive,
            shieldsUp: state.ship.shieldsUp,
            shieldOnlineLevel: state.ship.shieldOnlineLevel,
            shieldRechargeRatePct: state.ship.shieldRechargeRatePct,
            shield: state.ship.shield,
            armor: state.ship.armor,
            hull: state.ship.hull,
            bearing: state.ship.bearing,
            inclination: state.ship.inclination,
            actualVelocity: state.ship.actualVelocity,
            actualHeading: state.ship.actualHeading,
            actualSpeed: session.peakSpeed,
            actualInclination: state.ship.actualInclination,
            rollAngle: state.ship.rollAngle,
          })

          if (cruiseProgress >= 1) {
            const arrivalSpeed = Math.max(session.peakSpeed * 0.72, session.startSpeed)
            const arrivalVector = vectorBetweenWorldPoints(
              session.arrivalStartOffsetAtDestination,
              session.arrivalRestOffsetAtDestination
            )
            const { bearing: arrivalBearing, inclination: arrivalInclination } =
              bearingInclinationFromVector(arrivalVector)
            landingSessionRef.current = {
              startMs: nowMs,
              startSpeed: arrivalSpeed,
              fromPosition: session.arrivalStartOffsetAtDestination,
              restPosition: session.arrivalRestOffsetAtDestination,
              approachBearing: arrivalBearing,
              approachInclination: arrivalInclination,
            }
            state.setShipState({
              position: session.arrivalStartOffsetAtDestination,
              actualSpeed: arrivalSpeed,
              targetSpeed: 0,
              mwdActive: false,
              mwdRemaining: 0,
              inWarpTransit: false,
              bearing: arrivalBearing,
              inclination: arrivalInclination,
              actualHeading: arrivalBearing,
              actualInclination: arrivalInclination,
            })
            state.setWarpTravelProgress(ARRIVAL_PROGRESS_START)
            state.setWarpState('landing', session.destinationCelestialId)
            multiplayerClient.sendMove({
              position: session.arrivalStartOffsetAtDestination,
              revealedCelestialIds: state.ewRevealedCelestialIds,
              launchedCylinders: state.launchedCylinders,
              launchedFlares: state.launchedFlares,
              launchedChaff: state.launchedChaff,
              torpedoExplosions: state.torpedoExplosions,
              inWarpTransit: false,
              targetSpeed: 0,
              mwdActive: false,
              mwdRemaining: 0,
              mwdCooldownRemaining: state.ship.mwdCooldownRemaining,
              dampenersActive: state.ship.dampenersActive,
              shieldsUp: state.ship.shieldsUp,
              shieldOnlineLevel: state.ship.shieldOnlineLevel,
              shieldRechargeRatePct: state.ship.shieldRechargeRatePct,
              shield: state.ship.shield,
              armor: state.ship.armor,
              hull: state.ship.hull,
              bearing: arrivalBearing,
              inclination: arrivalInclination,
              actualVelocity: state.ship.actualVelocity,
              actualHeading: arrivalBearing,
              actualSpeed: arrivalSpeed,
              actualInclination: arrivalInclination,
              rollAngle: state.ship.rollAngle,
            })
            warpSessionRef.current = null
          }
        }
      }
    }

    const liveWarpState = useGameStore.getState().warpState

    if (liveWarpState === 'landing') {
      const landing = landingSessionRef.current
      if (!landing) {
        state.finishWarp()
        state.setShipState({
          position: [0, 0, WARP_ARRIVAL_MIN_DISTANCE_M],
          inWarpTransit: false,
          actualSpeed: 0,
          targetSpeed: 0,
          mwdActive: false,
          mwdRemaining: 0,
        })
        state.setWarpReferenceSpeed(0)
      } else {
        const p = Math.min(1, Math.max(0, (nowMs - landing.startMs) / LANDING_DURATION_MS))
        const eased = easeOutCubic(p)
        const nextLocal: [number, number, number] = [
          landing.fromPosition[0] + (landing.restPosition[0] - landing.fromPosition[0]) * eased,
          landing.fromPosition[1] + (landing.restPosition[1] - landing.fromPosition[1]) * eased,
          landing.fromPosition[2] + (landing.restPosition[2] - landing.fromPosition[2]) * eased,
        ]
        state.setShipState({
          position: nextLocal,
          inWarpTransit: false,
          actualSpeed: Math.max(0, landing.startSpeed * (1 - eased)),
          targetSpeed: 0,
          mwdActive: false,
          mwdRemaining: 0,
          bearing: landing.approachBearing,
          inclination: landing.approachInclination,
          actualHeading: landing.approachBearing,
          actualInclination: landing.approachInclination,
        })
        state.setWarpTravelProgress(
          ARRIVAL_PROGRESS_START + (1 - ARRIVAL_PROGRESS_START) * p
        )
        sendMoveIfDue(lastMoveSendMsRef, {
          position: nextLocal,
          revealedCelestialIds: state.ewRevealedCelestialIds,
          launchedCylinders: state.launchedCylinders,
          launchedFlares: state.launchedFlares,
          launchedChaff: state.launchedChaff,
          torpedoExplosions: state.torpedoExplosions,
          inWarpTransit: false,
          targetSpeed: 0,
          mwdActive: false,
          mwdRemaining: 0,
          mwdCooldownRemaining: state.ship.mwdCooldownRemaining,
          dampenersActive: state.ship.dampenersActive,
          shieldsUp: state.ship.shieldsUp,
          shieldOnlineLevel: state.ship.shieldOnlineLevel,
          shieldRechargeRatePct: state.ship.shieldRechargeRatePct,
          shield: state.ship.shield,
          armor: state.ship.armor,
          hull: state.ship.hull,
          bearing: landing.approachBearing,
          inclination: landing.approachInclination,
          actualVelocity: state.ship.actualVelocity,
          actualHeading: landing.approachBearing,
          actualSpeed: Math.max(0, landing.startSpeed * (1 - eased)),
          actualInclination: landing.approachInclination,
          rollAngle: state.ship.rollAngle,
        })
        if (p >= 1) {
          state.finishWarp()
          state.setShipState({
            position: landing.restPosition,
            inWarpTransit: false,
            actualSpeed: 0,
            targetSpeed: 0,
            mwdActive: false,
            mwdRemaining: 0,
            bearing: landing.approachBearing,
            inclination: landing.approachInclination,
            actualHeading: landing.approachBearing,
            actualInclination: landing.approachInclination,
          })
          state.setWarpReferenceSpeed(0)
          landingSessionRef.current = null
        }
      }
    } else if (liveWarpState !== 'warping') {
      landingSessionRef.current = null
    }
  }, -2)

  return null
}
