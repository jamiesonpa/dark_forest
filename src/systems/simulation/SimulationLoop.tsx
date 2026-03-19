import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import { useIRSTStore } from '@/state/irstStore'
import {
  ACCELERATION,
  DAMPENERS_ACCEL_MULT,
  DAMPENERS_DECEL_MULT,
  DECELERATION,
  KEY_BEAR_ACCEL_RATE,
  KEY_BEAR_BASE_RATE,
  KEY_BEAR_MAX_RATE,
  KEY_INCL_ACCEL_RATE,
  KEY_INCL_BASE_RATE,
  KEY_INCL_MAX_RATE,
  KEY_SPEED_RATE,
  MAX_PITCH_RATE,
  MAX_ROLL_DEG,
  MAX_TURN_RATE,
  MWD_SPEED,
  PITCH_ACCEL,
  PITCH_RATE_GAIN,
  REACTION_DELAY,
  ROLL_SMOOTH,
  TURN_ACCEL,
  TURN_RATE_GAIN,
} from '@/systems/simulation/constants'
import { clamp, lerp, shortestAngleDelta } from '@/systems/simulation/lib/math'
import { getCelestialById } from '@/utils/systemData'
import {
  getWarpCapacitorRequiredAmount,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'
import {
  getNextCapacitor,
  getShieldRechargeFrame,
  getThrustAuthority,
  normalizeSigned180,
} from '@/systems/simulation/shipMath'
import { sendMoveIfDue } from '@/systems/simulation/networkSync'
import { updateNpcElectronicWarfare } from '@/systems/simulation/npcSystems'
import { isEditableTarget } from '@/utils/dom'

type SimControlKey =
  | 'KeyA'
  | 'KeyD'
  | 'KeyW'
  | 'KeyS'
  | 'KeyQ'
  | 'KeyE'
  | 'ShiftLeft'
  | 'ShiftRight'
  | 'ControlLeft'
  | 'ControlRight'
type HoldKey = 'KeyA' | 'KeyD' | 'KeyW' | 'KeyS' | 'KeyQ' | 'KeyE'

const CONTROL_KEYS: readonly SimControlKey[] = [
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
  'KeyQ',
  'KeyE',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
]
const MAX_SELECTED_SPEED = 215
const WARP_MIN_POST_CAPACITOR = 1
const CAPACITOR_DRAIN_TIME_AT_MAX_SPEED_SEC = 120
const CAPACITOR_RECHARGE_FRACTION_OF_MAX_DRAIN = 0.6
const CAPACITOR_RECHARGE_COUNTERMEASURES_OFF_MULTIPLIER = 1.1
const CAPACITOR_RECHARGE_DEW_OFF_MULTIPLIER = 1.1
const CAPACITOR_DAMPENERS_DRAIN_FRACTION_OF_MAX_DRAIN = 0.15
const DEW_CAPACITOR_DRAIN_FRACTION_PER_CHARGE = 0.1
const DEW_CHARGE_DURATION_SECONDS = 10
const SHIELD_RECHARGE_PER_SECOND_AT_100_PCT = 100
const SHIELD_RECHARGE_CAP_DRAIN_FRACTION_PER_SECOND_AT_100_PCT = 0.01
const SHIELD_ONLINE_RAMP_SECONDS_AT_MAX = 2
const MWD_ACCEL_MULTIPLIER = 70
const POST_MWD_SUBWARP_BRAKE_MULTIPLIER = 20
const THRUST_CAPACITOR_EPSILON = 0.0001
const THRUST_FULL_AUTHORITY_CAP_FRACTION = 0.1
const LOW_CAP_THRUST_ACCEL_EXPONENT = 2
const DAMPENERS_OFFLINE_ACCEL_MULTIPLIER = 2
const DAMPENERS_REENGAGE_CAP_DRAIN_PER_MPS = 0.0005
const DAMPENERS_REENGAGE_BRAKE_MIN_MULT = 1.2
const DAMPENERS_REENGAGE_BRAKE_PER_MPS_MULT = 0.01
const ORIENT_DEBUG_TURN_RATE_MULTIPLIER = 4
const ORIENT_DEBUG_TURN_ACCEL_MULTIPLIER = 6
const ORIENT_DEBUG_COMMAND_RATE_MULTIPLIER = 5
const DAC_DIRECT_BEARING_RATE_MULTIPLIER = 0.38
const DAC_DIRECT_INCLINATION_RATE_MULTIPLIER = 0.55
const DAC_ROLL_RATE_MULTIPLIER = 0.9
const SHIP_DESTRUCTION_EXPLOSION_SIZE_MULTIPLIER = 5
const SHIP_DESTRUCTION_EXPLOSION_LIFETIME_SECONDS = 36
const SHIP_DESTRUCTION_EXPLOSION_GLOW_MULTIPLIER = 2.5
const OFFLINE_LOCAL_PLAYER_ID = 'local-player'
const TORPEDO_DAMAGE = 7000
const PT_TRACK_MAX_RANGE_M = 100_000

function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360
}

function clampInclination(deg: number): number {
  return Math.max(-85, Math.min(85, deg))
}

function getBearingInclinationAndRange(
  from: [number, number, number],
  to: [number, number, number]
) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const horizontal = Math.sqrt(dx * dx + dz * dz)
  const range = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (!Number.isFinite(range) || range <= 0) return null
  const bearing = normalizeBearing((Math.atan2(dx, dz) * 180) / Math.PI)
  const inclination = clampInclination((Math.atan2(dy, Math.max(horizontal, 0.000001)) * 180) / Math.PI)
  return { bearing, inclination, range }
}

const EMPTY_KEY_STATE: Record<SimControlKey, boolean> = {
  KeyA: false,
  KeyD: false,
  KeyW: false,
  KeyS: false,
  KeyQ: false,
  KeyE: false,
  ShiftLeft: false,
  ShiftRight: false,
  ControlLeft: false,
  ControlRight: false,
}

const EMPTY_HOLD_STATE: Record<HoldKey, number> = {
  KeyA: 0,
  KeyD: 0,
  KeyW: 0,
  KeyS: 0,
  KeyQ: 0,
  KeyE: 0,
}

export function SimulationLoop() {
  const prevTime = useRef(performance.now())
  const turnRateRef = useRef(0)
  const pitchRateRef = useRef(0)
  const rollRateRef = useRef(0)
  const rollRef = useRef(0)
  const bearingCommandTimeRef = useRef<number | null>(null)
  const inclCommandTimeRef = useRef<number | null>(null)
  const prevBearingRef = useRef(0)
  const prevInclRef = useRef(0)
  const elapsedRef = useRef(0)
  const keyStateRef = useRef({ ...EMPTY_KEY_STATE })
  const keyHoldStartRef = useRef({ ...EMPTY_HOLD_STATE })
  const lastMoveSendMsRef = useRef(0)
  const dacOrientationRef = useRef(new THREE.Quaternion())
  const dacOrientationInitializedRef = useRef(false)
  const dacPitchRef = useRef(0)
  const prevDampenersActiveRef = useRef(useGameStore.getState().ship.dampenersActive)
  const dampenersRecoveryActiveRef = useRef(false)
  const dampenersRecoveryCapDebtRef = useRef(0)
  const remoteExplosionDamageIdsRef = useRef(new Set<string>())
  const knownShipHullRef = useRef<Record<string, number>>({})

  useEffect(() => {
    const thrustEuler = new THREE.Euler(0, 0, 0, 'YXZ')
    const thrustForward = new THREE.Vector3(0, 0, 1)
    const dacEuler = new THREE.Euler(0, 0, 0, 'YXZ')
    const yawDeltaQuat = new THREE.Quaternion()
    const pitchDeltaQuat = new THREE.Quaternion()
    const rollDeltaQuat = new THREE.Quaternion()
    const UNIT_Y = new THREE.Vector3(0, 1, 0)
    const UNIT_X = new THREE.Vector3(1, 0, 0)
    const UNIT_Z = new THREE.Vector3(0, 0, 1)
    const inertialVelocity = new THREE.Vector3(0, 0, 0)
    const desiredVelocity = new THREE.Vector3(0, 0, 0)
    const velocityDelta = new THREE.Vector3(0, 0, 0)
    let inertialDriftInitialized = false

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyG') {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        if (e.repeat) return
        const state = useGameStore.getState()
        const sourceCelestial = getCelestialById(state.currentCelestialId, state.starSystem)
        const destinationCelestial = state.selectedWarpDestinationId
          ? getCelestialById(state.selectedWarpDestinationId, state.starSystem)
          : undefined
        let hasWarpCapacitor = false
        if (sourceCelestial && destinationCelestial && sourceCelestial.id !== destinationCelestial.id) {
          const sourceWorld = worldPositionForCelestial(sourceCelestial)
          const destinationWorld = worldPositionForCelestial(destinationCelestial)
          const distanceWorldUnits = vectorMagnitude(
            vectorBetweenWorldPoints(sourceWorld, destinationWorld)
          )
          const requiredCapacitor = getWarpCapacitorRequiredAmount(
            distanceWorldUnits,
            state.ship.capacitorMax
          )
          hasWarpCapacitor = state.ship.capacitor - requiredCapacitor >= WARP_MIN_POST_CAPACITOR
        }
        const canWarp =
          state.warpState === 'idle' &&
          Boolean(state.selectedWarpDestinationId) &&
          state.warpAligned &&
          hasWarpCapacitor
        if (!canWarp || !state.selectedWarpDestinationId) return
        state.startWarp(state.selectedWarpDestinationId)
        return
      }
      if (e.code === 'Space') {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        if (e.repeat) return
        const { ship, setDampenersActive } = useGameStore.getState()
        const nextDampenersActive = !ship.dampenersActive
        setDampenersActive(nextDampenersActive)
        return
      }
      if (!CONTROL_KEYS.includes(e.code as SimControlKey)) return
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      const key = e.code as SimControlKey
      if (
        (key === 'KeyA' || key === 'KeyD' || key === 'KeyW' || key === 'KeyS' || key === 'KeyQ' || key === 'KeyE') &&
        !keyStateRef.current[key]
      ) {
        keyHoldStartRef.current[key as HoldKey] = performance.now() / 1000
      }
      keyStateRef.current[key] = true
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (!CONTROL_KEYS.includes(e.code as SimControlKey)) return
      const key = e.code as SimControlKey
      keyStateRef.current[key] = false
      if (key === 'KeyA' || key === 'KeyD' || key === 'KeyW' || key === 'KeyS' || key === 'KeyQ' || key === 'KeyE') {
        keyHoldStartRef.current[key as HoldKey] = 0
      }
    }

    const onWindowBlur = () => {
      keyStateRef.current = { ...EMPTY_KEY_STATE }
      keyHoldStartRef.current = { ...EMPTY_HOLD_STATE }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)

    let raf = 0
    const tick = () => {
      const now = performance.now()
      const dt = Math.min((now - prevTime.current) / 1000, 0.1)
      prevTime.current = now
      elapsedRef.current += dt
      const simTime = elapsedRef.current
      const state = useGameStore.getState()
      state.advanceNpcShips(dt)
      const ship = state.ship
      const nowSec = now / 1000
      const dampenersOnline = ship.dampenersActive
      const dampenersJustReengaged = dampenersOnline && !prevDampenersActiveRef.current
      const dacActive = state.navAttitudeMode === 'DAC'
      const dacDirectActive = dacActive
      if (!dampenersOnline) {
        dampenersRecoveryActiveRef.current = false
        dampenersRecoveryCapDebtRef.current = 0
      } else if (dampenersJustReengaged && ship.actualSpeed > MAX_SELECTED_SPEED) {
        dampenersRecoveryActiveRef.current = true
        dampenersRecoveryCapDebtRef.current = clamp(
          Math.max(0, ship.actualSpeed - MAX_SELECTED_SPEED) *
            DAMPENERS_REENGAGE_CAP_DRAIN_PER_MPS *
            ship.capacitorMax,
          0,
          ship.capacitorMax
        )
      } else if (dampenersJustReengaged) {
        dampenersRecoveryCapDebtRef.current = 0
      }

      if (state.warpState === 'warping' || state.warpState === 'landing') {
        raf = requestAnimationFrame(tick)
        return
      }

      let commandedBearing = ship.bearing
      let commandedInclination = ship.inclination
      const orientDebugActive = state.orientDebugEnabled
      const commandRateMultiplier = orientDebugActive ? ORIENT_DEBUG_COMMAND_RATE_MULTIPLIER : 1

      let horizontalInput = 0
      if (dampenersOnline || dacActive) {
        horizontalInput =
          (keyStateRef.current.KeyD ? 1 : 0) - (keyStateRef.current.KeyA ? 1 : 0)
        if (horizontalInput !== 0) {
          const holdStart = horizontalInput > 0
            ? keyHoldStartRef.current.KeyD
            : keyHoldStartRef.current.KeyA
          const holdSeconds = Math.max(0, nowSec - holdStart)
          const rate = clamp(
            KEY_BEAR_BASE_RATE + holdSeconds * KEY_BEAR_ACCEL_RATE,
            KEY_BEAR_BASE_RATE,
            KEY_BEAR_MAX_RATE
          )
          commandedBearing = ((commandedBearing + horizontalInput * rate * commandRateMultiplier * dt) % 360 + 360) % 360
        }
      }

      let verticalInput = 0
      if (dampenersOnline || dacActive) {
        verticalInput =
          (keyStateRef.current.KeyW ? 1 : 0) - (keyStateRef.current.KeyS ? 1 : 0)
        if (verticalInput !== 0) {
          const holdStart = verticalInput > 0
            ? keyHoldStartRef.current.KeyW
            : keyHoldStartRef.current.KeyS
          const holdSeconds = Math.max(0, nowSec - holdStart)
          const rate = clamp(
            KEY_INCL_BASE_RATE + holdSeconds * KEY_INCL_ACCEL_RATE,
            KEY_INCL_BASE_RATE,
            KEY_INCL_MAX_RATE
          )
          commandedInclination = clamp(
            commandedInclination + verticalInput * rate * commandRateMultiplier * dt,
            -90,
            90
          )
        }
      }

      // Aggregate ship mutations into one store write per frame.
      const shipPatch: Partial<typeof ship> = {}
      if (dacActive && dampenersOnline) {
        // In DAC, commanded attitude follows the live attitude so arrow keys apply direct rates.
        shipPatch.bearing = ship.actualHeading
        shipPatch.inclination = ship.actualInclination
      } else if (dampenersOnline && (horizontalInput !== 0 || verticalInput !== 0)) {
        shipPatch.bearing = commandedBearing
        shipPatch.inclination = commandedInclination
      } else if (!dampenersOnline) {
        shipPatch.bearing = ship.actualHeading
        shipPatch.inclination = ship.actualInclination
      }

      const hasCapacitorForThrust = ship.capacitor > THRUST_CAPACITOR_EPSILON
      const { thrustAuthority } = getThrustAuthority(
        ship.capacitor,
        ship.capacitorMax,
        THRUST_FULL_AUTHORITY_CAP_FRACTION
      )
      const speedInput =
        ((keyStateRef.current.ShiftLeft || keyStateRef.current.ShiftRight) ? 1 : 0) -
        ((keyStateRef.current.ControlLeft || keyStateRef.current.ControlRight) ? 1 : 0)
      const maxTargetSpeedByCap = MAX_SELECTED_SPEED * thrustAuthority
      if (speedInput !== 0) {
        const nextTargetSpeed = clamp(
          ship.targetSpeed + speedInput * KEY_SPEED_RATE * dt,
          0,
          maxTargetSpeedByCap
        )
        if (speedInput < 0 || !(ship.mwdActive && hasCapacitorForThrust)) {
          shipPatch.targetSpeed = nextTargetSpeed
        }
      }
      const requestedTargetSpeed = shipPatch.targetSpeed ?? ship.targetSpeed
      if (requestedTargetSpeed > maxTargetSpeedByCap) {
        shipPatch.targetSpeed = maxTargetSpeedByCap
      }
      if (!hasCapacitorForThrust && ship.targetSpeed !== 0) {
        shipPatch.targetSpeed = 0
      }
      const effectiveTargetSpeed = shipPatch.targetSpeed ?? ship.targetSpeed
      if (!hasCapacitorForThrust && ship.mwdActive) {
        shipPatch.mwdActive = false
        shipPatch.mwdRemaining = 0
      }
      const effectiveMwdActive = (shipPatch.mwdActive ?? ship.mwdActive) && hasCapacitorForThrust

      if (ship.bearing !== prevBearingRef.current) {
        bearingCommandTimeRef.current = simTime
        prevBearingRef.current = ship.bearing
      }
      if (ship.inclination !== prevInclRef.current) {
        inclCommandTimeRef.current = simTime
        prevInclRef.current = ship.inclination
      }

      const desiredSpeed = effectiveMwdActive
        ? MWD_SPEED
        : hasCapacitorForThrust
          ? effectiveTargetSpeed
          : 0
      let newSpeed = ship.actualSpeed
      const dampenersOnlineAccelRate = ACCELERATION * DAMPENERS_ACCEL_MULT
      const subwarpAccelRate = ship.dampenersActive
        ? dampenersOnlineAccelRate
        : dampenersOnlineAccelRate * DAMPENERS_OFFLINE_ACCEL_MULTIPLIER
      const baseAccelRate = effectiveMwdActive ? ACCELERATION : subwarpAccelRate
      const accelRate = effectiveMwdActive ? baseAccelRate * MWD_ACCEL_MULTIPLIER : baseAccelRate
      const decelRate = ship.dampenersActive ? DECELERATION * DAMPENERS_DECEL_MULT : DECELERATION
      const isPostMwdSubwarpBrake =
        !effectiveMwdActive &&
        ship.dampenersActive &&
        newSpeed > MAX_SELECTED_SPEED &&
        !dampenersRecoveryActiveRef.current
      const baseEffectiveDecelRate = isPostMwdSubwarpBrake
        ? decelRate * POST_MWD_SUBWARP_BRAKE_MULTIPLIER
        : dampenersRecoveryActiveRef.current
          ? decelRate * (
              DAMPENERS_REENGAGE_BRAKE_MIN_MULT +
              Math.max(0, newSpeed - MAX_SELECTED_SPEED) * DAMPENERS_REENGAGE_BRAKE_PER_MPS_MULT
            )
          : decelRate
      const decelTargetSpeed = isPostMwdSubwarpBrake
        ? Math.max(desiredSpeed, MAX_SELECTED_SPEED)
        : desiredSpeed
      const overspeedAtFrameStart = Math.max(0, ship.actualSpeed - MAX_SELECTED_SPEED)
      let recoveryBrakeEnergyRatio = 1
      if (
        dampenersRecoveryActiveRef.current &&
        dampenersRecoveryCapDebtRef.current > 0 &&
        overspeedAtFrameStart > 0 &&
        ship.capacitor > 0
      ) {
        const predictedRecoverySpeed = Math.max(decelTargetSpeed, newSpeed - baseEffectiveDecelRate * dt)
        const predictedOverspeedAtFrameEnd = Math.max(0, predictedRecoverySpeed - MAX_SELECTED_SPEED)
        const predictedOverspeedBleed = Math.max(
          0,
          overspeedAtFrameStart - predictedOverspeedAtFrameEnd
        )
        if (predictedOverspeedBleed > 0) {
          const predictedBrakeProgress = clamp(predictedOverspeedBleed / overspeedAtFrameStart, 0, 1)
          const predictedRecoveryDrain = Math.min(
            dampenersRecoveryCapDebtRef.current,
            dampenersRecoveryCapDebtRef.current * predictedBrakeProgress
          )
          if (predictedRecoveryDrain > 0) {
            recoveryBrakeEnergyRatio = clamp(ship.capacitor / predictedRecoveryDrain, 0, 1)
          }
        }
      }
      const effectiveDecelRate = dampenersRecoveryActiveRef.current
        ? baseEffectiveDecelRate * recoveryBrakeEnergyRatio
        : baseEffectiveDecelRate
      if (!ship.dampenersActive) {
        if (effectiveMwdActive && ship.mwdRemaining > 0) {
          // Dampeners offline: no MWD top speed cap; accelerate for full burn duration.
          newSpeed = Math.max(0, newSpeed + accelRate * dt)
        } else {
          // Dampeners offline subwarp: throttle behaves like continuous thrust.
          const thrustFraction = hasCapacitorForThrust
            ? clamp(effectiveTargetSpeed / MAX_SELECTED_SPEED, 0, 1)
            : 0
          const nonlinearThrust = Math.pow(thrustFraction, LOW_CAP_THRUST_ACCEL_EXPONENT)
          if (thrustFraction > 0) {
            newSpeed = Math.max(0, newSpeed + nonlinearThrust * subwarpAccelRate * dt)
          }
        }
      } else if (newSpeed < desiredSpeed) {
        newSpeed = Math.min(desiredSpeed, newSpeed + accelRate * dt)
      } else if (newSpeed > desiredSpeed && ship.dampenersActive) {
        newSpeed = Math.max(decelTargetSpeed, newSpeed - effectiveDecelRate * dt)
      }
      const dampenersRecoveryCompletedThisFrame =
        dampenersRecoveryActiveRef.current && newSpeed <= MAX_SELECTED_SPEED
      const overspeedAtFrameEnd = Math.max(0, newSpeed - MAX_SELECTED_SPEED)
      let dampenersRecoveryDrainThisFrame = 0
      if (
        dampenersRecoveryActiveRef.current &&
        dampenersRecoveryCapDebtRef.current > 0 &&
        overspeedAtFrameStart > 0
      ) {
        const overspeedBleedThisFrame = Math.max(0, overspeedAtFrameStart - overspeedAtFrameEnd)
        if (overspeedBleedThisFrame > 0) {
          const brakeProgressThisFrame = clamp(overspeedBleedThisFrame / overspeedAtFrameStart, 0, 1)
          const requestedRecoveryDrainThisFrame = Math.min(
            dampenersRecoveryCapDebtRef.current,
            dampenersRecoveryCapDebtRef.current * brakeProgressThisFrame
          )
          dampenersRecoveryDrainThisFrame = Math.min(requestedRecoveryDrainThisFrame, ship.capacitor)
          dampenersRecoveryCapDebtRef.current = Math.max(
            0,
            dampenersRecoveryCapDebtRef.current - dampenersRecoveryDrainThisFrame
          )
        }
      }
      if (dampenersRecoveryCompletedThisFrame) {
        dampenersRecoveryActiveRef.current = false
        dampenersRecoveryCapDebtRef.current = 0
      }

      let newHeading = ship.actualHeading
      const maxTurnRate = orientDebugActive
        ? MAX_TURN_RATE * ORIENT_DEBUG_TURN_RATE_MULTIPLIER
        : MAX_TURN_RATE
      const turnAccel = orientDebugActive
        ? TURN_ACCEL * ORIENT_DEBUG_TURN_ACCEL_MULTIPLIER
        : TURN_ACCEL
      if (dacDirectActive) {
        let desiredTurnRate = 0
        if (horizontalInput !== 0) {
          const holdStart =
            horizontalInput > 0
              ? keyHoldStartRef.current.KeyD
              : keyHoldStartRef.current.KeyA
          const holdSeconds = Math.max(0, nowSec - holdStart)
          const inputRate = clamp(
            KEY_BEAR_BASE_RATE + holdSeconds * KEY_BEAR_ACCEL_RATE,
            KEY_BEAR_BASE_RATE,
            KEY_BEAR_MAX_RATE
          )
          desiredTurnRate =
            horizontalInput *
            inputRate *
            commandRateMultiplier *
            DAC_DIRECT_BEARING_RATE_MULTIPLIER
        }
        const maxTurnStep = turnAccel * dt
        turnRateRef.current += clamp(
          desiredTurnRate - turnRateRef.current,
          -maxTurnStep,
          maxTurnStep
        )
        newHeading = ((newHeading + turnRateRef.current * dt) % 360 + 360) % 360
      } else {
        const headingDelta = shortestAngleDelta(newHeading, ship.bearing)
        const bearingReady =
          orientDebugActive ||
          bearingCommandTimeRef.current === null ||
          simTime - bearingCommandTimeRef.current >= REACTION_DELAY ||
          Math.abs(turnRateRef.current) > 0.01

        if ((dampenersOnline || orientDebugActive) && Math.abs(headingDelta) > 0.05 && bearingReady) {
          const desiredTurnRate = clamp(
            headingDelta * TURN_RATE_GAIN,
            -maxTurnRate,
            maxTurnRate
          )
          const maxTurnStep = turnAccel * dt
          turnRateRef.current += clamp(
            desiredTurnRate - turnRateRef.current,
            -maxTurnStep,
            maxTurnStep
          )
          newHeading = ((newHeading + turnRateRef.current * dt) % 360 + 360) % 360
        } else if ((dampenersOnline || orientDebugActive) && Math.abs(headingDelta) <= 0.05) {
          newHeading = ship.bearing
          turnRateRef.current *= 0.65
        } else if (!dampenersOnline) {
          // AA inertial attitude drift: preserve yaw rate while DMP is offline.
          newHeading = ((newHeading + turnRateRef.current * dt) % 360 + 360) % 360
        }
      }

      let newIncl = ship.actualInclination
      const maxPitchRate = orientDebugActive
        ? MAX_PITCH_RATE * ORIENT_DEBUG_TURN_RATE_MULTIPLIER
        : MAX_PITCH_RATE
      const pitchAccel = orientDebugActive
        ? PITCH_ACCEL * ORIENT_DEBUG_TURN_ACCEL_MULTIPLIER
        : PITCH_ACCEL
      if (dacDirectActive) {
        let desiredPitchRate = 0
        if (verticalInput !== 0) {
          const holdStart =
            verticalInput > 0
              ? keyHoldStartRef.current.KeyW
              : keyHoldStartRef.current.KeyS
          const holdSeconds = Math.max(0, nowSec - holdStart)
          const inputRate = clamp(
            KEY_INCL_BASE_RATE + holdSeconds * KEY_INCL_ACCEL_RATE,
            KEY_INCL_BASE_RATE,
            KEY_INCL_MAX_RATE
          )
          desiredPitchRate =
            verticalInput *
            inputRate *
            commandRateMultiplier *
            DAC_DIRECT_INCLINATION_RATE_MULTIPLIER
        }
        const maxPitchStep = pitchAccel * dt
        pitchRateRef.current += clamp(
          desiredPitchRate - pitchRateRef.current,
          -maxPitchStep,
          maxPitchStep
        )
        newIncl = newIncl + pitchRateRef.current * dt
      } else {
        const inclDelta = ship.inclination - newIncl
        const inclReady =
          orientDebugActive ||
          inclCommandTimeRef.current === null ||
          simTime - inclCommandTimeRef.current >= REACTION_DELAY ||
          Math.abs(pitchRateRef.current) > 0.01

        if ((dampenersOnline || orientDebugActive) && Math.abs(inclDelta) > 0.05 && inclReady) {
          const desiredPitchRate = clamp(
            inclDelta * PITCH_RATE_GAIN,
            -maxPitchRate,
            maxPitchRate
          )
          const maxPitchStep = pitchAccel * dt
          pitchRateRef.current += clamp(
            desiredPitchRate - pitchRateRef.current,
            -maxPitchStep,
            maxPitchStep
          )
          newIncl = clamp(newIncl + pitchRateRef.current * dt, -90, 90)
        } else if ((dampenersOnline || orientDebugActive) && Math.abs(inclDelta) <= 0.05) {
          newIncl = ship.inclination
          pitchRateRef.current *= 0.65
        } else if (!dampenersOnline) {
          // AA inertial attitude drift: preserve pitch rate while DMP is offline.
          newIncl = clamp(newIncl + pitchRateRef.current * dt, -90, 90)
        }
      }

      if (dacDirectActive) {
        if (!dacOrientationInitializedRef.current) {
          dacEuler.set(
            THREE.MathUtils.degToRad(-ship.actualInclination),
            THREE.MathUtils.degToRad(-ship.actualHeading),
            THREE.MathUtils.degToRad(ship.rollAngle),
            'YXZ'
          )
          dacOrientationRef.current.setFromEuler(dacEuler)
          dacPitchRef.current = normalizeSigned180(
            Number.isFinite(ship.dacPitch) ? ship.dacPitch : ship.actualInclination
          )
          dacOrientationInitializedRef.current = true
        }

        const rollInput = (keyStateRef.current.KeyE ? 1 : 0) - (keyStateRef.current.KeyQ ? 1 : 0)
        let desiredRollRate = 0
        if (rollInput !== 0) {
          const holdStart = rollInput > 0
            ? keyHoldStartRef.current.KeyE
            : keyHoldStartRef.current.KeyQ
          const holdSeconds = Math.max(0, nowSec - holdStart)
          const inputRate = clamp(
            KEY_BEAR_BASE_RATE + holdSeconds * KEY_BEAR_ACCEL_RATE,
            KEY_BEAR_BASE_RATE,
            KEY_BEAR_MAX_RATE
          )
          desiredRollRate = rollInput * inputRate * commandRateMultiplier * DAC_ROLL_RATE_MULTIPLIER
        }
        const maxRollStep = turnAccel * dt
        rollRateRef.current += clamp(
          desiredRollRate - rollRateRef.current,
          -maxRollStep,
          maxRollStep
        )

        // Direct attitude control: apply yaw/pitch/roll in ship-local axes.
        yawDeltaQuat.setFromAxisAngle(UNIT_Y, THREE.MathUtils.degToRad(-turnRateRef.current * dt))
        pitchDeltaQuat.setFromAxisAngle(UNIT_X, THREE.MathUtils.degToRad(-pitchRateRef.current * dt))
        rollDeltaQuat.setFromAxisAngle(UNIT_Z, THREE.MathUtils.degToRad(rollRateRef.current * dt))
        dacOrientationRef.current.multiply(yawDeltaQuat)
        dacOrientationRef.current.multiply(pitchDeltaQuat)
        dacOrientationRef.current.multiply(rollDeltaQuat)
        dacOrientationRef.current.normalize()
        dacPitchRef.current = normalizeSigned180(dacPitchRef.current + pitchRateRef.current * dt)

        thrustForward.set(0, 0, 1).applyQuaternion(dacOrientationRef.current)
        const horizontalMag = Math.hypot(thrustForward.x, thrustForward.z)
        if (horizontalMag > 0.000001) {
          newHeading = ((Math.atan2(-thrustForward.x, thrustForward.z) * 180) / Math.PI + 360) % 360
        } else {
          newHeading = ship.actualHeading
        }
        newIncl = (Math.atan2(thrustForward.y, Math.max(0.000001, horizontalMag)) * 180) / Math.PI

        shipPatch.bearing = newHeading
        shipPatch.inclination = newIncl
        shipPatch.dacPitch = dacPitchRef.current

        dacEuler.setFromQuaternion(dacOrientationRef.current, 'YXZ')
        rollRef.current = normalizeSigned180(THREE.MathUtils.radToDeg(dacEuler.z))
      } else {
        dacOrientationInitializedRef.current = false
        dacPitchRef.current = normalizeSigned180(ship.actualInclination)
        shipPatch.dacPitch = ship.actualInclination
        rollRateRef.current = 0
      }

      if (!dacDirectActive) {
        const headingRad = (newHeading * Math.PI) / 180
        const inclRad = (newIncl * Math.PI) / 180
        // Keep thrust translation aligned with the exact render orientation used by PlayerShip.
        thrustEuler.set(-inclRad, -headingRad, 0, 'YXZ')
        thrustForward.set(0, 0, 1).applyEuler(thrustEuler)
      }
      const dacInertialDriftActive = dacActive && !dampenersOnline
      let pdx = 0
      let pdy = 0
      let pdz = 0
      if (dacInertialDriftActive) {
        if (!inertialDriftInitialized) {
          inertialVelocity.copy(thrustForward).multiplyScalar(newSpeed)
          if (inertialVelocity.lengthSq() < 0.0000001) {
            inertialVelocity.set(0, 0, newSpeed)
          } else {
            inertialVelocity.normalize().multiplyScalar(newSpeed)
          }
          inertialDriftInitialized = true
        }
        // In DAC with dampeners offline, thrust applies delta-v along current nose.
        // This allows side-burn vectoring even when already at the scalar speed cap.
        if (!effectiveMwdActive && hasCapacitorForThrust && speedInput > 0) {
          const manualThrustFraction = clamp(speedInput * thrustAuthority, 0, 1)
          const nonlinearManualThrust = Math.pow(manualThrustFraction, LOW_CAP_THRUST_ACCEL_EXPONENT)
          inertialVelocity.addScaledVector(thrustForward, nonlinearManualThrust * accelRate * dt)
        } else if (effectiveMwdActive && ship.mwdRemaining > 0) {
          inertialVelocity.addScaledVector(thrustForward, accelRate * dt)
        } else if (!effectiveMwdActive && hasCapacitorForThrust && effectiveTargetSpeed > 0) {
          // Treat non-zero target speed as active forward thrust in inertial DAC mode.
          const thrustFraction = clamp(effectiveTargetSpeed / MAX_SELECTED_SPEED, 0, 1)
          const nonlinearThrust = Math.pow(thrustFraction, LOW_CAP_THRUST_ACCEL_EXPONENT)
          inertialVelocity.addScaledVector(thrustForward, nonlinearThrust * accelRate * dt)
        }
        newSpeed = inertialVelocity.length()
        pdx = inertialVelocity.x * dt
        pdy = inertialVelocity.y * dt
        pdz = inertialVelocity.z * dt
      } else if (inertialDriftInitialized && dampenersOnline) {
        // On dampener re-engage, keep current inertial velocity and let dampeners
        // gradually steer/brake toward the commanded forward velocity.
        desiredVelocity.copy(thrustForward).multiplyScalar(newSpeed)
        velocityDelta.copy(desiredVelocity).sub(inertialVelocity)
        const deltaLen = velocityDelta.length()
        const maxDelta = effectiveDecelRate * dt
        if (deltaLen > maxDelta && deltaLen > 0.000001) {
          velocityDelta.multiplyScalar(maxDelta / deltaLen)
        }
        inertialVelocity.add(velocityDelta)
        newSpeed = inertialVelocity.length()
        pdx = inertialVelocity.x * dt
        pdy = inertialVelocity.y * dt
        pdz = inertialVelocity.z * dt
        if (desiredVelocity.distanceTo(inertialVelocity) < 0.05) {
          inertialDriftInitialized = false
          inertialVelocity.set(0, 0, 0)
        }
      } else {
        inertialDriftInitialized = false
        inertialVelocity.set(0, 0, 0)
        pdx = thrustForward.x * newSpeed * dt
        pdy = thrustForward.y * newSpeed * dt
        pdz = thrustForward.z * newSpeed * dt
      }

      const nextX = ship.position[0] + pdx
      const nextY = ship.position[1] + pdy
      const nextZ = ship.position[2] + pdz
      const newPos: [number, number, number] = [nextX, nextY, nextZ]

      const remainingHeading = Math.abs(shortestAngleDelta(newHeading, ship.bearing))
      const rollFade = remainingHeading < 15 ? remainingHeading / 15 : 1
      const targetRoll = (turnRateRef.current / maxTurnRate) * MAX_ROLL_DEG * rollFade
      if (!dacActive && (dampenersOnline || orientDebugActive)) {
        rollRef.current = lerp(rollRef.current, targetRoll, ROLL_SMOOTH * dt)
      }

      shipPatch.actualSpeed = newSpeed
      shipPatch.actualHeading = newHeading
      shipPatch.actualInclination = newIncl
      shipPatch.actualVelocity = dt > 0
        ? [pdx / dt, pdy / dt, pdz / dt]
        : [0, 0, 0]
      shipPatch.position = newPos
      shipPatch.rollAngle = rollRef.current

      const irstState = useIRSTStore.getState()
      if (state.irstCameraOn && irstState.pointTrackEnabled && irstState.pointTrackTargetId) {
        const targetId = irstState.pointTrackTargetId
        const targetShip = state.shipsById[targetId]
        const iff = String(state.ewIffState[targetId] ?? '').toUpperCase()
        const isEnemy = Boolean(state.npcShips[targetId]) || iff === 'HOSTILE'
        if (
          !targetShip ||
          !isEnemy ||
          targetShip.currentCelestialId !== ship.currentCelestialId
        ) {
          irstState.setPointTrackEnabled(false)
          irstState.setPointTrackTargetId(null)
        } else {
          const targetSighting = getBearingInclinationAndRange(newPos, targetShip.position)
          if (!targetSighting || targetSighting.range > PT_TRACK_MAX_RANGE_M) {
            irstState.setPointTrackEnabled(false)
            irstState.setPointTrackTargetId(null)
          } else if (irstState.stabilized) {
            shipPatch.irstBearing = targetSighting.bearing
            shipPatch.irstInclination = targetSighting.inclination
          } else {
            shipPatch.irstBearing = normalizeBearing(targetSighting.bearing + newHeading)
            shipPatch.irstInclination = clampInclination(targetSighting.inclination - newIncl)
          }
        }
      }

      const requestedThrustRatio = effectiveMwdActive
        ? 1
        : clamp(effectiveTargetSpeed / MAX_SELECTED_SPEED, 0, 1)
      const selectedSpeedRatio = hasCapacitorForThrust ? requestedThrustRatio : 0
      const sensorSystemsOfflineCount =
        (state.ewUpperScannerOn ? 0 : 1) +
        (state.ewLowerScannerOn ? 0 : 1) +
        (state.irstCameraOn ? 0 : 1)
      let capacitorRechargeFraction = state.countermeasuresPowered
        ? CAPACITOR_RECHARGE_FRACTION_OF_MAX_DRAIN
        : CAPACITOR_RECHARGE_FRACTION_OF_MAX_DRAIN * CAPACITOR_RECHARGE_COUNTERMEASURES_OFF_MULTIPLIER
      if (!state.dewPowered) {
        capacitorRechargeFraction *= CAPACITOR_RECHARGE_DEW_OFF_MULTIPLIER
      }
      let nextCapacitor = getNextCapacitor({
        capacitor: ship.capacitor,
        capacitorMax: ship.capacitorMax,
        selectedSpeedRatio,
        sensorSystemsOfflineCount,
        radarPowerPct: state.ewRadarPower,
        dampenersActive: ship.dampenersActive,
        drainTimeAtMaxSpeedSec: CAPACITOR_DRAIN_TIME_AT_MAX_SPEED_SEC,
        rechargeFractionOfMaxDrain: capacitorRechargeFraction,
        dampenersDrainFractionOfMaxDrain: CAPACITOR_DAMPENERS_DRAIN_FRACTION_OF_MAX_DRAIN,
        dampenersRecoveryDrain: dampenersRecoveryDrainThisFrame,
        dt,
      })
      if (state.dewCharging && ship.capacitorMax > 0) {
        const dewCapDrainPerSecond =
          (ship.capacitorMax * DEW_CAPACITOR_DRAIN_FRACTION_PER_CHARGE) / DEW_CHARGE_DURATION_SECONDS
        nextCapacitor = clamp(nextCapacitor - dewCapDrainPerSecond * dt, 0, ship.capacitorMax)
      }
      const shieldRecharge = getShieldRechargeFrame({
        shieldsUp: ship.shieldsUp,
        shield: ship.shield,
        shieldMax: ship.shieldMax,
        shieldRechargeRatePct: ship.shieldRechargeRatePct ?? 100,
        capacitor: nextCapacitor,
        capacitorMax: ship.capacitorMax,
        maxShieldRechargePerSecondAt100Pct: SHIELD_RECHARGE_PER_SECOND_AT_100_PCT,
        maxCapDrainFractionPerSecondAt100Pct: SHIELD_RECHARGE_CAP_DRAIN_FRACTION_PER_SECOND_AT_100_PCT,
        dt,
      })
      nextCapacitor = shieldRecharge.capacitor
      if (shieldRecharge.shield !== ship.shield) {
        shipPatch.shield = shieldRecharge.shield
      }
      const shieldTargetLevel = clamp(
        ship.shieldsUp ? shieldRecharge.shield : 0,
        0,
        ship.shieldMax
      )
      const currentShieldOnlineLevel = clamp(ship.shieldOnlineLevel ?? shieldTargetLevel, 0, ship.shieldMax)
      const shieldOnlineRampPerSecond = ship.shieldMax > 0
        ? ship.shieldMax / SHIELD_ONLINE_RAMP_SECONDS_AT_MAX
        : 0
      const nextShieldOnlineLevel = shieldTargetLevel > currentShieldOnlineLevel
        ? Math.min(shieldTargetLevel, currentShieldOnlineLevel + shieldOnlineRampPerSecond * dt)
        : shieldTargetLevel
      if (nextShieldOnlineLevel !== ship.shieldOnlineLevel) {
        shipPatch.shieldOnlineLevel = nextShieldOnlineLevel
      }
      shipPatch.capacitor = nextCapacitor

      if (!ship.mwdActive && ship.mwdCooldownRemaining > 0) {
        shipPatch.mwdCooldownRemaining = Math.max(0, ship.mwdCooldownRemaining - dt)
      }

      if (effectiveMwdActive && ship.mwdRemaining > 0) {
        const remaining = ship.mwdRemaining - dt
        if (remaining <= 0) {
          shipPatch.mwdRemaining = 0
          shipPatch.mwdActive = false
        } else {
          shipPatch.mwdRemaining = remaining
        }
      }

      // Guard target inclination channel from hidden accumulation.
      if (!dacActive && shipPatch.inclination !== undefined) {
        shipPatch.inclination = clamp(shipPatch.inclination, -90, 90)
      }

      state.setShipState(shipPatch)
      const latestState = useGameStore.getState()
      const localShipId = latestState.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
      for (const explosion of latestState.remoteTorpedoExplosions) {
        if (explosion.targetShipId !== localShipId) continue
        if (explosion.currentCelestialId !== latestState.currentCelestialId) continue
        if (remoteExplosionDamageIdsRef.current.has(explosion.id)) continue
        remoteExplosionDamageIdsRef.current.add(explosion.id)
        const localShip = latestState.shipsById[localShipId] ?? latestState.ship
        let remaining = TORPEDO_DAMAGE
        let shield = localShip.shield
        let armor = localShip.armor
        let hull = localShip.hull
        if (localShip.shieldsUp && shield > 0) {
          const absorbed = Math.min(shield, remaining)
          shield -= absorbed
          remaining -= absorbed
        }
        if (remaining > 0 && armor > 0) {
          const absorbed = Math.min(armor, remaining)
          armor -= absorbed
          remaining -= absorbed
        }
        if (remaining > 0) {
          hull = Math.max(0, hull - remaining)
        }
        latestState.setShipState({ shield, armor, hull })
      }
      const activeExplosionIds = new Set(latestState.remoteTorpedoExplosions.map((e) => e.id))
      for (const processedId of remoteExplosionDamageIdsRef.current) {
        if (!activeExplosionIds.has(processedId)) {
          remoteExplosionDamageIdsRef.current.delete(processedId)
        }
      }
      const nextKnownShipHull: Record<string, number> = {}
      const npcIdsToRemove: string[] = []
      for (const [shipId, knownShip] of Object.entries(latestState.shipsById)) {
        const currentHull = Math.max(0, knownShip.hull)
        const previousHull = knownShipHullRef.current[shipId] ?? currentHull
        nextKnownShipHull[shipId] = currentHull
        if (!(previousHull > 0 && currentHull <= 0)) {
          continue
        }
        latestState.addTorpedoExplosion({
          id: `ship-destruction-${shipId}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          currentCelestialId: knownShip.currentCelestialId,
          position: [...knownShip.position],
          flightTimeSeconds: 0,
          targetShipId: shipId,
          kind: 'ship-destruction',
          sizeMultiplier: SHIP_DESTRUCTION_EXPLOSION_SIZE_MULTIPLIER,
          lifetimeSeconds: SHIP_DESTRUCTION_EXPLOSION_LIFETIME_SECONDS,
          glowMultiplier: SHIP_DESTRUCTION_EXPLOSION_GLOW_MULTIPLIER,
        })
        if (latestState.npcShips[shipId]) {
          npcIdsToRemove.push(shipId)
        }
      }
      knownShipHullRef.current = nextKnownShipHull
      for (const npcId of npcIdsToRemove) {
        latestState.removeNpcShip(npcId)
      }
      sendMoveIfDue(lastMoveSendMsRef, {
        position: newPos,
        revealedCelestialIds: latestState.ewRevealedCelestialIds,
        launchedCylinders: latestState.launchedCylinders,
        launchedFlares: latestState.launchedFlares,
        torpedoExplosions: latestState.torpedoExplosions,
        inWarpTransit: shipPatch.inWarpTransit ?? ship.inWarpTransit,
        targetSpeed: shipPatch.targetSpeed ?? ship.targetSpeed,
        mwdActive: shipPatch.mwdActive ?? ship.mwdActive,
        mwdRemaining: shipPatch.mwdRemaining ?? ship.mwdRemaining,
        mwdCooldownRemaining: shipPatch.mwdCooldownRemaining ?? ship.mwdCooldownRemaining,
        dampenersActive: shipPatch.dampenersActive ?? ship.dampenersActive,
        shieldsUp: shipPatch.shieldsUp ?? ship.shieldsUp,
        shieldOnlineLevel: shipPatch.shieldOnlineLevel ?? ship.shieldOnlineLevel,
        shieldRechargeRatePct: shipPatch.shieldRechargeRatePct ?? ship.shieldRechargeRatePct,
        shield: shipPatch.shield ?? ship.shield,
        armor: shipPatch.armor ?? ship.armor,
        hull: shipPatch.hull ?? ship.hull,
        bearing: shipPatch.bearing ?? ship.bearing,
        inclination: shipPatch.inclination ?? ship.inclination,
        actualVelocity: shipPatch.actualVelocity ?? ship.actualVelocity,
        actualHeading: newHeading,
        actualSpeed: newSpeed,
        actualInclination: newIncl,
        rollAngle: rollRef.current,
      })

      updateNpcElectronicWarfare(state, newPos, newHeading, dt)

      prevDampenersActiveRef.current = dampenersOnline

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [])

  return null
}
