import { useEffect, useRef, useState } from 'react'
import { IRSTView } from '@/components/hud/IRSTView'
import { useGameStore } from '@/state/gameStore'
import { useIRSTStore } from '@/state/irstStore'

const SLEW_SPEED_DEG_PER_SEC = 120
const PT_TRACK_LOCK_MAX_RANGE_M = 100_000
const PT_TRACK_LOCK_MAX_OFF_BORESIGHT_DEG = 1

function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360
}

function clampInclination(deg: number): number {
  return Math.max(-85, Math.min(85, deg))
}

function shortestAngularDelta(fromDeg: number, toDeg: number): number {
  return ((toDeg - fromDeg + 540) % 360) - 180
}

function clampMagnitude(value: number, maxAbs: number): number {
  return Math.max(-maxAbs, Math.min(maxAbs, value))
}

function worldDirectionFromBearingInclination(
  bearingDeg: number,
  inclinationDeg: number
): [number, number, number] {
  const bearingRad = (bearingDeg * Math.PI) / 180
  const inclinationRad = (inclinationDeg * Math.PI) / 180
  return [
    Math.sin(bearingRad) * Math.cos(inclinationRad),
    Math.sin(inclinationRad),
    Math.cos(bearingRad) * Math.cos(inclinationRad),
  ]
}

function angleBetweenUnitVectorsDeg(
  a: [number, number, number],
  b: [number, number, number]
): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const clampedDot = Math.max(-1, Math.min(1, dot))
  return (Math.acos(clampedDot) * 180) / Math.PI
}

const wsRootStyle = {
  width: '100%',
  height: '100%',
  position: 'relative' as const,
  overflow: 'hidden' as const,
  background: '#080808',
  color: 'var(--hud-text)',
  fontFamily: 'var(--font-mono)',
}

const wsIrstPanelStyle = {
  position: 'absolute' as const,
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'auto' as const,
}

const wsSlewButtonStyle = {
  width: 'auto',
  padding: '7px 10px',
  border: '1px solid rgba(0, 255, 100, 0.35)',
  borderRadius: 4,
  background: 'rgba(0, 24, 10, 0.72)',
  color: '#88ffaa',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.05em',
  cursor: 'pointer',
  userSelect: 'none' as const,
  whiteSpace: 'nowrap' as const,
}

const wsControlsStyle = {
  marginTop: 8,
  display: 'flex',
  gap: 8,
  justifyContent: 'center',
}

export function WSStation() {
  const slewActiveRef = useRef(false)
  const slewRafRef = useRef<number | null>(null)
  const slewLastTimeRef = useRef<number | null>(null)
  const [isSlewHeld, setIsSlewHeld] = useState(false)
  const irstMode = useGameStore((state) => state.ship.irstMode)
  const irstSpectrumMode = useGameStore((state) => state.ship.irstSpectrumMode)
  const irstCameraOn = useGameStore((state) => state.irstCameraOn)
  const setShipState = useGameStore((state) => state.setShipState)
  const irstStabilized = useIRSTStore((state) => state.stabilized)
  const setIrstStabilized = useIRSTStore((state) => state.setStabilized)
  const pointTrackEnabled = useIRSTStore((state) => state.pointTrackEnabled)
  const setPointTrackEnabled = useIRSTStore((state) => state.setPointTrackEnabled)
  const setPointTrackTargetId = useIRSTStore((state) => state.setPointTrackTargetId)

  useEffect(() => {
    return () => {
      slewActiveRef.current = false
      slewLastTimeRef.current = null
      if (slewRafRef.current !== null) {
        cancelAnimationFrame(slewRafRef.current)
        slewRafRef.current = null
      }
    }
  }, [])

  const stopSlew = () => {
    slewActiveRef.current = false
    slewLastTimeRef.current = null
    if (slewRafRef.current !== null) {
      cancelAnimationFrame(slewRafRef.current)
      slewRafRef.current = null
    }
    setIsSlewHeld(false)
  }

  const stepSlew = (nowMs: number) => {
    if (!slewActiveRef.current) return
    const previousMs = slewLastTimeRef.current ?? nowMs
    slewLastTimeRef.current = nowMs
    const deltaSeconds = Math.min((nowMs - previousMs) / 1000, 0.05)
    const maxStep = SLEW_SPEED_DEG_PER_SEC * deltaSeconds

    const state = useGameStore.getState()
    const ship = state.ship

    const targetBearing = irstStabilized ? normalizeBearing(360 - ship.actualHeading) : 0
    const targetInclination = irstStabilized ? clampInclination(ship.actualInclination) : 0
    const bearingDelta = shortestAngularDelta(ship.irstBearing, targetBearing)
    const inclinationDelta = targetInclination - ship.irstInclination

    const nextBearing = normalizeBearing(ship.irstBearing + clampMagnitude(bearingDelta, maxStep))
    const nextInclination = clampInclination(
      ship.irstInclination + clampMagnitude(inclinationDelta, maxStep)
    )

    if (
      Math.abs(shortestAngularDelta(ship.irstBearing, nextBearing)) > 0.001 ||
      Math.abs(ship.irstInclination - nextInclination) > 0.001
    ) {
      state.setShipState({
        irstBearing: nextBearing,
        irstInclination: nextInclination,
      })
    }

    slewRafRef.current = requestAnimationFrame(stepSlew)
  }

  const startSlew = () => {
    if (slewActiveRef.current) return
    slewActiveRef.current = true
    slewLastTimeRef.current = null
    setIsSlewHeld(true)
    slewRafRef.current = requestAnimationFrame(stepSlew)
  }

  return (
    <section style={wsRootStyle}>
      <div style={wsIrstPanelStyle}>
        <IRSTView
          displayScale={2.25}
          showPowerToggle
          onPowerChange={(on) => {
            if (!on) {
              stopSlew()
              setPointTrackEnabled(false)
              setPointTrackTargetId(null)
            }
          }}
        />
        <div style={wsControlsStyle}>
          <button
            type="button"
            style={{
              ...wsSlewButtonStyle,
              background: isSlewHeld ? 'rgba(0, 255, 100, 0.18)' : wsSlewButtonStyle.background,
              border: isSlewHeld
                ? '1px solid rgba(0, 255, 100, 0.65)'
                : '1px solid rgba(0, 255, 100, 0.35)',
              cursor: irstCameraOn ? 'pointer' : 'not-allowed',
              opacity: irstCameraOn ? 1 : 0.6,
            }}
            disabled={!irstCameraOn}
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              startSlew()
            }}
            onPointerUp={() => stopSlew()}
            onPointerCancel={() => stopSlew()}
            onLostPointerCapture={() => stopSlew()}
          >
            FWD
          </button>
          <button
            type="button"
            style={{
              ...wsSlewButtonStyle,
              background: 'rgba(0, 24, 10, 0.72)',
              cursor: irstCameraOn && irstSpectrumMode === 'IR' ? 'pointer' : 'not-allowed',
              opacity: irstCameraOn && irstSpectrumMode === 'IR' ? 1 : 0.6,
            }}
            disabled={!irstCameraOn || irstSpectrumMode !== 'IR'}
            onClick={() => {
              setShipState({ irstMode: irstMode === 'BHOT' ? 'WHOT' : 'BHOT' })
            }}
          >
            {irstMode}
          </button>
          <button
            type="button"
            style={{
              ...wsSlewButtonStyle,
              background: 'rgba(0, 24, 10, 0.72)',
              cursor: irstCameraOn ? 'pointer' : 'not-allowed',
              opacity: irstCameraOn ? 1 : 0.6,
            }}
            disabled={!irstCameraOn}
            onClick={() => {
              setShipState({ irstSpectrumMode: irstSpectrumMode === 'IR' ? 'VIS' : 'IR' })
            }}
          >
            {irstSpectrumMode}
          </button>
          <button
            type="button"
            style={{
              ...wsSlewButtonStyle,
              background: irstStabilized ? 'rgba(0, 255, 100, 0.18)' : 'rgba(0, 24, 10, 0.72)',
              border: irstStabilized
                ? '1px solid rgba(0, 255, 100, 0.65)'
                : '1px solid rgba(0, 255, 100, 0.35)',
            }}
            onClick={() => {
              const ship = useGameStore.getState().ship
              const nextStabilized = !irstStabilized
              if (nextStabilized) {
                setShipState({
                  irstBearing: normalizeBearing(ship.irstBearing - ship.actualHeading),
                  irstInclination: clampInclination(ship.actualInclination + ship.irstInclination),
                })
              } else {
                setShipState({
                  irstBearing: normalizeBearing(ship.irstBearing + ship.actualHeading),
                  irstInclination: clampInclination(ship.irstInclination - ship.actualInclination),
                })
              }
              setIrstStabilized(nextStabilized)
            }}
          >
            STAB
          </button>
          <button
            type="button"
            style={{
              ...wsSlewButtonStyle,
              background: pointTrackEnabled ? 'rgba(0, 255, 100, 0.18)' : 'rgba(0, 24, 10, 0.72)',
              border: pointTrackEnabled
                ? '1px solid rgba(0, 255, 100, 0.65)'
                : '1px solid rgba(0, 255, 100, 0.35)',
              cursor: irstCameraOn ? 'pointer' : 'not-allowed',
              opacity: irstCameraOn ? 1 : 0.6,
            }}
            disabled={!irstCameraOn}
            onClick={() => {
              if (pointTrackEnabled) {
                setPointTrackEnabled(false)
                setPointTrackTargetId(null)
                return
              }

              const state = useGameStore.getState()
              const ship = state.ship
              const localId = state.localPlayerId || 'local-player'
              const effectiveBearing = irstStabilized
                ? ship.irstBearing
                : normalizeBearing(360 - ship.actualHeading + ship.irstBearing)
              const effectiveInclination = irstStabilized
                ? ship.irstInclination
                : clampInclination(ship.actualInclination + ship.irstInclination)
              const cameraDir = worldDirectionFromBearingInclination(
                effectiveBearing,
                effectiveInclination
              )

              let bestTargetId: string | null = null
              let bestAngleDeg = Infinity
              for (const [id, target] of Object.entries(state.shipsById)) {
                if (id === localId) continue
                if (target.currentCelestialId !== ship.currentCelestialId) continue

                const iff = String(state.ewIffState[id] ?? '').toUpperCase()
                const isEnemy = Boolean(state.npcShips[id]) || iff === 'HOSTILE'
                if (!isEnemy) continue

                const dx = target.position[0] - ship.position[0]
                const dy = target.position[1] - ship.position[1]
                const dz = target.position[2] - ship.position[2]
                const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)
                if (!Number.isFinite(distance) || distance <= 0 || distance > PT_TRACK_LOCK_MAX_RANGE_M) {
                  continue
                }

                const invDistance = 1 / distance
                const targetDir: [number, number, number] = [
                  dx * invDistance,
                  dy * invDistance,
                  dz * invDistance,
                ]
                const angleDeg = angleBetweenUnitVectorsDeg(cameraDir, targetDir)
                if (angleDeg <= PT_TRACK_LOCK_MAX_OFF_BORESIGHT_DEG && angleDeg < bestAngleDeg) {
                  bestTargetId = id
                  bestAngleDeg = angleDeg
                }
              }

              if (bestTargetId) {
                setPointTrackTargetId(bestTargetId)
                setPointTrackEnabled(true)
              } else {
                setPointTrackEnabled(false)
                setPointTrackTargetId(null)
              }
            }}
          >
            PT TRK
          </button>
        </div>
      </div>
    </section>
  )
}
