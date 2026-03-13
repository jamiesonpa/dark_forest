import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
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
import { multiplayerClient } from '@/network/colyseusClient'

type SimControlKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Shift' | 'Control'
type HoldKey = Exclude<SimControlKey, 'Shift' | 'Control'>

const CONTROL_KEYS: readonly SimControlKey[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift', 'Control']
const MAX_SELECTED_SPEED = 215
const CAPACITOR_DRAIN_TIME_AT_MAX_SPEED_SEC = 120
const CAPACITOR_RECHARGE_FRACTION_OF_MAX_DRAIN = 0.6
const CAPACITOR_DAMPENERS_DRAIN_FRACTION_OF_MAX_DRAIN = 0.15
const MWD_ACCEL_MULTIPLIER = 70
const POST_MWD_SUBWARP_BRAKE_MULTIPLIER = 20
const MWD_COOLDOWN_SEC = 60
const DAMPENERS_OFFLINE_ACCEL_MULTIPLIER = 2

const EMPTY_KEY_STATE: Record<SimControlKey, boolean> = {
  ArrowLeft: false,
  ArrowRight: false,
  ArrowUp: false,
  ArrowDown: false,
  Shift: false,
  Control: false,
}

const EMPTY_HOLD_STATE: Record<HoldKey, number> = {
  ArrowLeft: 0,
  ArrowRight: 0,
  ArrowUp: 0,
  ArrowDown: 0,
}

export function SimulationLoop() {
  const prevTime = useRef(performance.now())
  const turnRateRef = useRef(0)
  const pitchRateRef = useRef(0)
  const rollRef = useRef(0)
  const bearingCommandTimeRef = useRef<number | null>(null)
  const inclCommandTimeRef = useRef<number | null>(null)
  const prevBearingRef = useRef(0)
  const prevInclRef = useRef(0)
  const elapsedRef = useRef(0)
  const keyStateRef = useRef({ ...EMPTY_KEY_STATE })
  const keyHoldStartRef = useRef({ ...EMPTY_HOLD_STATE })
  const lastMoveSendMsRef = useRef(0)

  useEffect(() => {
    const thrustEuler = new THREE.Euler(0, 0, 0, 'YXZ')
    const thrustForward = new THREE.Vector3(0, 0, 1)

    const isEditableElement = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      return (
        target.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT'
      )
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!CONTROL_KEYS.includes(e.key as SimControlKey)) return
      if (isEditableElement(e.target)) return
      e.preventDefault()
      const key = e.key as SimControlKey
      if ((key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') && !keyStateRef.current[key]) {
        keyHoldStartRef.current[key] = performance.now() / 1000
      }
      keyStateRef.current[key] = true
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (!CONTROL_KEYS.includes(e.key as SimControlKey)) return
      const key = e.key as SimControlKey
      keyStateRef.current[key] = false
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        keyHoldStartRef.current[key] = 0
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
      const ship = state.ship
      const nowSec = now / 1000
      const dampenersOnline = ship.dampenersActive

      let commandedBearing = ship.bearing
      let commandedInclination = ship.inclination

      let horizontalInput = 0
      if (dampenersOnline) {
        horizontalInput =
          (keyStateRef.current.ArrowRight ? 1 : 0) - (keyStateRef.current.ArrowLeft ? 1 : 0)
        if (horizontalInput !== 0) {
          const holdStart = horizontalInput > 0 ? keyHoldStartRef.current.ArrowRight : keyHoldStartRef.current.ArrowLeft
          const holdSeconds = Math.max(0, nowSec - holdStart)
          const rate = clamp(
            KEY_BEAR_BASE_RATE + holdSeconds * KEY_BEAR_ACCEL_RATE,
            KEY_BEAR_BASE_RATE,
            KEY_BEAR_MAX_RATE
          )
          commandedBearing = ((commandedBearing + horizontalInput * rate * dt) % 360 + 360) % 360
        }
      }

      let verticalInput = 0
      if (dampenersOnline) {
        verticalInput =
          (keyStateRef.current.ArrowUp ? 1 : 0) - (keyStateRef.current.ArrowDown ? 1 : 0)
        if (verticalInput !== 0) {
          const holdStart = verticalInput > 0 ? keyHoldStartRef.current.ArrowUp : keyHoldStartRef.current.ArrowDown
          const holdSeconds = Math.max(0, nowSec - holdStart)
          const rate = clamp(
            KEY_INCL_BASE_RATE + holdSeconds * KEY_INCL_ACCEL_RATE,
            KEY_INCL_BASE_RATE,
            KEY_INCL_MAX_RATE
          )
          commandedInclination = clamp(commandedInclination + verticalInput * rate * dt, -90, 90)
        }
      }

      // Aggregate ship mutations into one store write per frame.
      const shipPatch: Partial<typeof ship> = {}
      if (dampenersOnline && (horizontalInput !== 0 || verticalInput !== 0)) {
        shipPatch.bearing = commandedBearing
        shipPatch.inclination = commandedInclination
      } else if (!dampenersOnline) {
        shipPatch.bearing = ship.actualHeading
        shipPatch.inclination = ship.actualInclination
      }

      if (!ship.mwdActive) {
        const speedInput = (keyStateRef.current.Shift ? 1 : 0) - (keyStateRef.current.Control ? 1 : 0)
        if (speedInput !== 0) {
          shipPatch.targetSpeed = clamp(ship.targetSpeed + speedInput * KEY_SPEED_RATE * dt, 0, 215)
        }
      }

      if (ship.bearing !== prevBearingRef.current) {
        bearingCommandTimeRef.current = simTime
        prevBearingRef.current = ship.bearing
      }
      if (ship.inclination !== prevInclRef.current) {
        inclCommandTimeRef.current = simTime
        prevInclRef.current = ship.inclination
      }

      const desiredSpeed = ship.mwdActive ? MWD_SPEED : ship.targetSpeed
      let newSpeed = ship.actualSpeed
      const dampenersOnlineAccelRate = ACCELERATION * DAMPENERS_ACCEL_MULT
      const subwarpAccelRate = ship.dampenersActive
        ? dampenersOnlineAccelRate
        : dampenersOnlineAccelRate * DAMPENERS_OFFLINE_ACCEL_MULTIPLIER
      const baseAccelRate = ship.mwdActive ? ACCELERATION : subwarpAccelRate
      const accelRate = ship.mwdActive ? baseAccelRate * MWD_ACCEL_MULTIPLIER : baseAccelRate
      const decelRate = ship.dampenersActive ? DECELERATION * DAMPENERS_DECEL_MULT : DECELERATION
      const isPostMwdSubwarpBrake =
        !ship.mwdActive && ship.dampenersActive && newSpeed > MAX_SELECTED_SPEED
      const effectiveDecelRate = isPostMwdSubwarpBrake
        ? decelRate * POST_MWD_SUBWARP_BRAKE_MULTIPLIER
        : decelRate
      const decelTargetSpeed = isPostMwdSubwarpBrake
        ? Math.max(desiredSpeed, MAX_SELECTED_SPEED)
        : desiredSpeed
      if (newSpeed < desiredSpeed) {
        newSpeed = Math.min(desiredSpeed, newSpeed + accelRate * dt)
      } else if (newSpeed > desiredSpeed && ship.dampenersActive) {
        newSpeed = Math.max(decelTargetSpeed, newSpeed - effectiveDecelRate * dt)
      }

      let newHeading = ship.actualHeading
      const headingDelta = shortestAngleDelta(newHeading, ship.bearing)
      const bearingReady =
        bearingCommandTimeRef.current === null ||
        simTime - bearingCommandTimeRef.current >= REACTION_DELAY ||
        Math.abs(turnRateRef.current) > 0.01

      if (dampenersOnline && Math.abs(headingDelta) > 0.05 && bearingReady) {
        const desiredTurnRate = clamp(
          headingDelta * TURN_RATE_GAIN,
          -MAX_TURN_RATE,
          MAX_TURN_RATE
        )
        const maxTurnStep = TURN_ACCEL * dt
        turnRateRef.current += clamp(
          desiredTurnRate - turnRateRef.current,
          -maxTurnStep,
          maxTurnStep
        )
        newHeading = ((newHeading + turnRateRef.current * dt) % 360 + 360) % 360
      } else if (dampenersOnline && Math.abs(headingDelta) <= 0.05) {
        newHeading = ship.bearing
        turnRateRef.current *= 0.65
      } else if (!dampenersOnline) {
        turnRateRef.current = 0
      }

      let newIncl = ship.actualInclination
      const inclDelta = ship.inclination - newIncl
      const inclReady =
        inclCommandTimeRef.current === null ||
        simTime - inclCommandTimeRef.current >= REACTION_DELAY ||
        Math.abs(pitchRateRef.current) > 0.01

      if (dampenersOnline && Math.abs(inclDelta) > 0.05 && inclReady) {
        const desiredPitchRate = clamp(
          inclDelta * PITCH_RATE_GAIN,
          -MAX_PITCH_RATE,
          MAX_PITCH_RATE
        )
        const maxPitchStep = PITCH_ACCEL * dt
        pitchRateRef.current += clamp(
          desiredPitchRate - pitchRateRef.current,
          -maxPitchStep,
          maxPitchStep
        )
        newIncl = clamp(newIncl + pitchRateRef.current * dt, -90, 90)
      } else if (dampenersOnline && Math.abs(inclDelta) <= 0.05) {
        newIncl = ship.inclination
        pitchRateRef.current *= 0.65
      } else if (!dampenersOnline) {
        pitchRateRef.current = 0
      }

      const headingRad = (newHeading * Math.PI) / 180
      const inclRad = (newIncl * Math.PI) / 180
      // Keep thrust translation aligned with the exact render orientation used by PlayerShip.
      thrustEuler.set(-inclRad, -headingRad, 0, 'YXZ')
      thrustForward.set(0, 0, 1).applyEuler(thrustEuler)
      const pdx = thrustForward.x * newSpeed * dt
      const pdy = thrustForward.y * newSpeed * dt
      const pdz = thrustForward.z * newSpeed * dt

      const nextX = ship.position[0] + pdx
      const nextY = ship.position[1] + pdy
      const nextZ = ship.position[2] + pdz
      const newPos: [number, number, number] = [nextX, nextY, nextZ]

      const remainingHeading = Math.abs(shortestAngleDelta(newHeading, ship.bearing))
      const rollFade = remainingHeading < 15 ? remainingHeading / 15 : 1
      const targetRoll = (turnRateRef.current / MAX_TURN_RATE) * MAX_ROLL_DEG * rollFade
      rollRef.current = lerp(rollRef.current, targetRoll, ROLL_SMOOTH * dt)

      shipPatch.actualSpeed = newSpeed
      shipPatch.actualHeading = newHeading
      shipPatch.actualInclination = newIncl
      shipPatch.position = newPos
      shipPatch.rollAngle = rollRef.current

      const selectedSpeedRatio = clamp(ship.targetSpeed / MAX_SELECTED_SPEED, 0, 1)
      const capacitorDrainPerSecondAtMaxSpeed = ship.capacitorMax / CAPACITOR_DRAIN_TIME_AT_MAX_SPEED_SEC
      const capacitorRechargePerSecond =
        capacitorDrainPerSecondAtMaxSpeed * CAPACITOR_RECHARGE_FRACTION_OF_MAX_DRAIN
      const capacitorDrain = capacitorDrainPerSecondAtMaxSpeed * selectedSpeedRatio
      const dampenersDrainPerSecond = ship.dampenersActive
        ? capacitorDrainPerSecondAtMaxSpeed * CAPACITOR_DAMPENERS_DRAIN_FRACTION_OF_MAX_DRAIN
        : 0
      const capacitorDelta = (capacitorRechargePerSecond - capacitorDrain - dampenersDrainPerSecond) * dt
      shipPatch.capacitor = clamp(ship.capacitor + capacitorDelta, 0, ship.capacitorMax)

      if (ship.mwdCooldownRemaining > 0) {
        shipPatch.mwdCooldownRemaining = Math.max(0, ship.mwdCooldownRemaining - dt)
      }

      if (ship.mwdActive && ship.mwdRemaining > 0) {
        const remaining = ship.mwdRemaining - dt
        if (remaining <= 0) {
          shipPatch.mwdRemaining = 0
          shipPatch.mwdActive = false
          shipPatch.mwdCooldownRemaining = MWD_COOLDOWN_SEC
        } else {
          shipPatch.mwdRemaining = remaining
        }
      }

      state.setShipState(shipPatch)
      if (multiplayerClient.isConnected()) {
        const nowMs = performance.now()
        if (nowMs - lastMoveSendMsRef.current >= 66) {
          multiplayerClient.sendMove(newPos)
          lastMoveSendMsRef.current = nowMs
        }
      }

      const enemy = state.enemy
      let enemyX = enemy.position[0]
      const enemyY = enemy.position[1]
      let enemyZ = enemy.position[2]
      if (enemy.speed > 0) {
        const hRad = (enemy.heading * Math.PI) / 180
        enemyX = enemy.position[0] + (-Math.sin(hRad) * enemy.speed * dt)
        enemyZ = enemy.position[2] + (-Math.cos(hRad) * enemy.speed * dt)
        state.setEnemyState({ position: [enemyX, enemyY, enemyZ] })
      }

      const rwrContacts = state.rwrContacts
      if (rwrContacts.length > 0) {
        const rdx = -(enemyX - nextX)
        const rdz = enemyZ - nextZ
        const enemyBearing = ((Math.atan2(rdx, rdz) * 180 / Math.PI) + 360) % 360
        let changed = false
        const updated = rwrContacts.map((c) => {
          if (c.id === 'concord' || c.id === 'missile') {
            if (Math.abs((c.bearing ?? 0) - enemyBearing) > 0.5) {
              changed = true
              return { ...c, bearing: enemyBearing }
            }
          }
          return c
        })
        if (changed) state.setRwrContacts(updated)
      }

      const ewJammers = state.ewJammers
      if (enemy.radarMode === 'stt' || enemy.radarMode === 'scan') {
        const enemyFreq = enemy.radarMode === 'stt' ? 0.48 : 0.42
        const rangeKm = Math.sqrt(
          Math.pow(enemyX - nextX, 2) +
          Math.pow(enemyZ - nextZ, 2)
        ) / 1000

        const playerRCS = 22
        const rangeFactor = clamp(1 - rangeKm / 150, 0.05, 1)
        const rcsFactor = Math.pow(playerRCS, 0.25) / 2.2
        const modeFactor = enemy.radarMode === 'stt' ? 1.0 : 0.6
        const lockStrength = rangeFactor * rcsFactor * modeFactor

        let totalJamPower = 0
        ewJammers.forEach((j) => {
          if (!j.active || !j.mode) return
          const freqDist = Math.abs(j.freq - enemyFreq)
          if (freqDist > 0.06) return
          const overlap = clamp(1 - freqDist / 0.04, 0, 1)

          let effectiveness = 0
          if (j.mode === 'NJ') effectiveness = overlap * 0.5
          else if (j.mode === 'SJ') effectiveness = overlap * overlap * 0.8
          else if (j.mode === 'DRFM') effectiveness = overlap * 0.7
          else if (j.mode === 'RGPO') effectiveness = overlap * 0.4
          totalJamPower += effectiveness
        })

        if (totalJamPower > lockStrength && enemy.radarMode === 'stt') {
          state.setEnemyState({ radarMode: 'scan' })
          const currentRwr = state.rwrContacts
          if (currentRwr.length > 0) {
            state.setRwrContacts(currentRwr.map((c) =>
              c.id === 'concord' ? { ...c, sttLock: false, symbol: '2' as const, newContact: false } : c
            ))
          }
        }
      }

      const lockState = state.ewLockState
      if (Object.keys(lockState).length > 0) {
        const rdx2 = -(enemyX - nextX)
        const rdz2 = enemyZ - nextZ
        const enemyBrg = ((Math.atan2(rdx2, rdz2) * 180 / Math.PI) + 360) % 360
        const relBrg = ((enemyBrg - newHeading + 540) % 360) - 180
        if (Math.abs(relBrg) > 90) {
          const cleaned: Record<string, 'soft' | 'hard'> = {}
          let anyRemoved = false
          for (const [id, lock] of Object.entries(lockState)) {
            if (id === 'Σ') {
              anyRemoved = true
            } else {
              cleaned[id] = lock
            }
          }
          if (anyRemoved) {
            state.setEwLockState(() => cleaned)
          }
        }
      }

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
