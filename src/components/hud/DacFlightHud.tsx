import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'

const HEADING_TICK_SPACING_PX = 34
const HEADING_TICK_RANGE = 14
const HORIZON_PX_PER_DEG = 2
const HORIZON_STEP_DEG = 30
const HORIZON_WINDOW_HEIGHT_PX = 420
const HORIZON_EDGE_BUFFER_DEG = 60
const SPEED_STEP = 10
const SPEED_TICK_SPACING_PX = 11
const SPEED_WINDOW_HEIGHT_PX = 220
const SPEED_TICK_RANGE = 12
const FLIGHT_PATH_MIN_SPEED_MPS = 2
const FLIGHT_PATH_EDGE_PADDING_PX = 16
const MARKER_VISIBLE_CONE_DEG = 55

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360
}

function isInvertedFromInclination(value: number) {
  const wrapped = ((value % 360) + 360) % 360
  return wrapped > 90 && wrapped < 270
}

function formatHeading(value: number) {
  return Math.round(normalizeHeading(value)).toString().padStart(3, '0')
}

function formatSigned(value: number) {
  const rounded = Math.round(value)
  return `${rounded >= 0 ? '+' : ''}${rounded}`
}

function formatSpeed(value: number) {
  return Math.max(0, Math.round(value)).toString()
}

function normalizeSigned180(value: number) {
  const wrapped = ((value % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function projectHudOffsetsFromLocalVelocity(
  localVelocity: THREE.Vector3,
  maxOffsetPx: number
) {
  const speed = localVelocity.length()
  if (speed < 0.000001) {
    return { visible: false, x: 0, y: 0 }
  }

  const cosLimit = Math.cos((MARKER_VISIBLE_CONE_DEG * Math.PI) / 180)
  const forwardCos = localVelocity.z / speed
  if (forwardCos < cosLimit) {
    return { visible: false, x: 0, y: 0 }
  }

  const horizontalMag = Math.hypot(localVelocity.x, localVelocity.z)
  const yawOffsetDeg = (Math.atan2(-localVelocity.x, Math.max(0.000001, localVelocity.z)) * 180) / Math.PI
  const pitchOffsetDeg = (Math.atan2(localVelocity.y, Math.max(0.000001, horizontalMag)) * 180) / Math.PI
  return {
    visible: true,
    x: clamp((yawOffsetDeg / 10) * HEADING_TICK_SPACING_PX, -maxOffsetPx, maxOffsetPx),
    y: clamp(-pitchOffsetDeg * HORIZON_PX_PER_DEG, -maxOffsetPx, maxOffsetPx),
  }
}

function halfLineWidthPx(pitchDeg: number) {
  if (pitchDeg >= 120) return 54
  if (pitchDeg >= 90) return 72
  if (pitchDeg >= 60) return 90
  if (pitchDeg >= 30) return 108
  return 132
}

export function DacFlightHud() {
  const navAttitudeMode = useGameStore((s) => s.navAttitudeMode)
  const warpState = useGameStore((s) => s.warpState)
  const dampenersActive = useGameStore((s) => s.ship.dampenersActive)
  const actualHeading = useGameStore((s) => s.ship.actualHeading)
  const actualInclination = useGameStore((s) => s.ship.actualInclination)
  const actualSpeed = useGameStore((s) => s.ship.actualSpeed)
  const rollAngle = useGameStore((s) => s.ship.rollAngle)
  const position = useGameStore((s) => s.ship.position)
  const prevPositionRef = useRef<[number, number, number] | null>(null)
  const prevSampleTimeRef = useRef<number | null>(null)
  const [flightPathVelocity, setFlightPathVelocity] = useState<{
    x: number
    y: number
    z: number
  } | null>(null)

  useEffect(() => {
    if (navAttitudeMode !== 'DAC' || dampenersActive) {
      prevPositionRef.current = null
      prevSampleTimeRef.current = null
      setFlightPathVelocity(null)
      return
    }

    const now = performance.now()
    const prevPosition = prevPositionRef.current
    const prevTime = prevSampleTimeRef.current
    prevPositionRef.current = [position[0], position[1], position[2]]
    prevSampleTimeRef.current = now
    if (!prevPosition || prevTime === null) return

    const dt = (now - prevTime) / 1000
    if (dt <= 0.0001) return

    const dx = position[0] - prevPosition[0]
    const dy = position[1] - prevPosition[1]
    const dz = position[2] - prevPosition[2]
    const sampledSpeed = Math.hypot(dx, dy, dz) / dt
    if (sampledSpeed < FLIGHT_PATH_MIN_SPEED_MPS || actualSpeed < FLIGHT_PATH_MIN_SPEED_MPS) {
      setFlightPathVelocity(null)
      return
    }

    setFlightPathVelocity({
      x: dx / dt,
      y: dy / dt,
      z: dz / dt,
    })
  }, [navAttitudeMode, dampenersActive, position, actualSpeed])

  if (navAttitudeMode !== 'DAC') return null

  const heading = normalizeHeading(actualHeading)
  const headingBase = Math.floor(heading / 10) * 10
  const headingFrac = (heading - headingBase) / 10
  const headingDirection = isInvertedFromInclination(actualInclination) ? -1 : 1
  const headingOffsetPx = headingFrac * HEADING_TICK_SPACING_PX
  const headingTapeHalfWidth = ((HEADING_TICK_RANGE * 2 + 1) * HEADING_TICK_SPACING_PX) / 2
  const warpTransitActive = warpState === 'warping' || warpState === 'landing'
  const speed = Math.max(0, actualSpeed)
  const speedBase = Math.floor(speed / SPEED_STEP) * SPEED_STEP
  const speedMinTick = Math.max(0, speedBase - SPEED_TICK_RANGE * SPEED_STEP)
  const speedMaxTick = speedBase + SPEED_TICK_RANGE * SPEED_STEP
  const speedTicks: number[] = []
  for (let tick = speedMinTick; tick <= speedMaxTick; tick += SPEED_STEP) {
    speedTicks.push(tick)
  }

  // XZ plane depth is represented by signed distance along Y from y=0.
  const depthFromSystemPlane = position[1]
  const inclinationReadout = formatSigned(normalizeSigned180(actualInclination))
  const horizonVisibleHalfDeg =
    HORIZON_WINDOW_HEIGHT_PX / 2 / HORIZON_PX_PER_DEG + HORIZON_EDGE_BUFFER_DEG
  const horizonMinTick = Math.floor((actualInclination - horizonVisibleHalfDeg) / HORIZON_STEP_DEG) * HORIZON_STEP_DEG
  const horizonMaxTick = Math.ceil((actualInclination + horizonVisibleHalfDeg) / HORIZON_STEP_DEG) * HORIZON_STEP_DEG
  const horizonTicks: number[] = []
  for (let tick = horizonMinTick; tick <= horizonMaxTick; tick += HORIZON_STEP_DEG) {
    horizonTicks.push(tick)
  }
  const horizonTransform = `rotate(${-rollAngle}deg)`
  const maxFlightPathOffsetPx = HORIZON_WINDOW_HEIGHT_PX / 2 - FLIGHT_PATH_EDGE_PADDING_PX
  let flightPathOffsetX = 0
  let flightPathOffsetY = 0
  let antiFlightPathOffsetX = 0
  let antiFlightPathOffsetY = 0
  let showFlightPathMarker = false
  let showAntiFlightPathMarker = false
  if (flightPathVelocity && !dampenersActive) {
    const shipEuler = new THREE.Euler(
      THREE.MathUtils.degToRad(-actualInclination),
      THREE.MathUtils.degToRad(-actualHeading),
      THREE.MathUtils.degToRad(rollAngle),
      'YXZ'
    )
    const shipQuat = new THREE.Quaternion().setFromEuler(shipEuler)
    const localVelocity = new THREE.Vector3(
      flightPathVelocity.x,
      flightPathVelocity.y,
      flightPathVelocity.z
    ).applyQuaternion(shipQuat.clone().invert())
    const flightProjection = projectHudOffsetsFromLocalVelocity(localVelocity, maxFlightPathOffsetPx)
    flightPathOffsetX = flightProjection.x
    flightPathOffsetY = flightProjection.y
    showFlightPathMarker = flightProjection.visible

    const antiVelocity = localVelocity.clone().multiplyScalar(-1)
    const antiProjection = projectHudOffsetsFromLocalVelocity(antiVelocity, maxFlightPathOffsetPx)
    antiFlightPathOffsetX = antiProjection.x
    antiFlightPathOffsetY = antiProjection.y
    showAntiFlightPathMarker = antiProjection.visible
  }

  return (
    <div className="dac-flight-hud" aria-label="Direct attitude control HUD">
      <div className="dac-flight-hud-heading">
        <div className="dac-flight-hud-bearing-readout">
          <div className="dac-flight-hud-bearing-unit">BEARING</div>
          <div className="dac-flight-hud-bearing-value">{formatHeading(actualHeading)}</div>
        </div>
        <div className="dac-flight-hud-heading-window">
          <div
            className="dac-flight-hud-heading-tape"
            style={{ transform: `translateX(${-headingTapeHalfWidth - headingOffsetPx * headingDirection}px)` }}
          >
            {Array.from({ length: HEADING_TICK_RANGE * 2 + 1 }).map((_, idx) => {
              const i = idx - HEADING_TICK_RANGE
              const value = normalizeHeading(headingBase + i * 10 * headingDirection)
              return (
                <div key={`hdg-${i}`} className="dac-flight-hud-heading-tick">
                  <div className="dac-flight-hud-heading-mark" />
                  <div className="dac-flight-hud-heading-label">{formatHeading(value)}</div>
                </div>
              )
            })}
          </div>
          <div className="dac-flight-hud-heading-caret" />
        </div>
      </div>

      <div className="dac-flight-hud-center-marker" aria-hidden="true">
        <span className="dac-flight-hud-center-wing left" />
        <span className="dac-flight-hud-center-dot" />
        <span className="dac-flight-hud-center-wing right" />
      </div>
      <div
        className={`dac-flight-hud-flight-path-marker ${showFlightPathMarker ? '' : 'is-hidden'}`.trim()}
        style={{
          transform: `translate(calc(-50% + ${flightPathOffsetX}px), calc(-50% + ${flightPathOffsetY}px))`,
        }}
        aria-hidden="true"
      >
        <span className="dac-flight-hud-flight-path-wing left" />
        <span className="dac-flight-hud-flight-path-ring" />
        <span className="dac-flight-hud-flight-path-wing right" />
      </div>
      <div
        className={`dac-flight-hud-anti-flight-path-marker ${showAntiFlightPathMarker ? '' : 'is-hidden'}`.trim()}
        style={{
          transform: `translate(calc(-50% + ${antiFlightPathOffsetX}px), calc(-50% + ${antiFlightPathOffsetY}px))`,
        }}
        aria-hidden="true"
      >
        <span className="dac-flight-hud-anti-flight-path-wing left" />
        <span className="dac-flight-hud-anti-flight-path-ring" />
        <span className="dac-flight-hud-anti-flight-path-wing right" />
      </div>

      <div className="dac-flight-hud-horizon-window" aria-hidden="true">
        <div className="dac-flight-hud-horizon" style={{ transform: horizonTransform }}>
          {horizonTicks.map((tick) => {
            const offsetPx = (actualInclination - tick) * HORIZON_PX_PER_DEG
            const isHorizon = tick === 0
            const absTick = Math.abs(tick)
            const label = isHorizon ? '' : `${tick > 0 ? '+' : ''}${tick}`
            return (
              <div
                key={`horizon-rung-${tick}`}
                className={`dac-flight-hud-horizon-rung ${isHorizon ? 'is-horizon' : 'is-reference'}`}
                style={{ top: `calc(50% + ${offsetPx}px)` }}
              >
                <span className="dac-flight-hud-horizon-line" style={{ width: `${halfLineWidthPx(absTick)}px` }} />
                <span className="dac-flight-hud-horizon-gap">{label}</span>
                <span className="dac-flight-hud-horizon-line" style={{ width: `${halfLineWidthPx(absTick)}px` }} />
              </div>
            )
          })}
        </div>
      </div>

      <div className="dac-flight-hud-inclination-readout">
        <div className="dac-flight-hud-inclination-unit">INC</div>
        <span className="dac-flight-hud-inclination-caret-small" aria-hidden="true" />
        <div className="dac-flight-hud-inclination-value">{inclinationReadout}</div>
      </div>

      <div className="dac-flight-hud-speed">
        <div className="dac-flight-hud-speed-readout">
          <span className="dac-flight-hud-speed-readout-value">
            {warpTransitActive ? 'WARP' : formatSpeed(speed)}
          </span>
          {!warpTransitActive && <span className="dac-flight-hud-speed-readout-unit">m/s</span>}
          <span className="dac-flight-hud-speed-link" aria-hidden="true" />
        </div>
        {!warpTransitActive && (
          <div className="dac-flight-hud-speed-window" aria-hidden="true">
            <div className="dac-flight-hud-speed-tape">
              {speedTicks.map((tickValue) => {
                const topPx =
                  SPEED_WINDOW_HEIGHT_PX / 2 - (tickValue - speed) * (SPEED_TICK_SPACING_PX / SPEED_STEP)
                const showLabel = tickValue % 50 === 0
                return (
                  <div
                    key={`spd-${tickValue}`}
                    className="dac-flight-hud-speed-tick"
                    style={{ top: `${topPx}px` }}
                  >
                    {showLabel ? <div className="dac-flight-hud-speed-label">{formatSpeed(tickValue)}</div> : null}
                    <div className={`dac-flight-hud-speed-mark ${showLabel ? 'major' : 'minor'}`} />
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="dac-flight-hud-depth">
        {warpTransitActive ? (
          <div className="dac-flight-hud-depth-value">WARP</div>
        ) : (
          <>
            <div className="dac-flight-hud-depth-value">{formatSigned(depthFromSystemPlane)}</div>
            <div className="dac-flight-hud-depth-metric">m</div>
            <div className="dac-flight-hud-depth-unit">DEPTH</div>
          </>
        )}
      </div>
    </div>
  )
}
