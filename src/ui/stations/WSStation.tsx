import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { IRSTView } from '@/components/hud/IRSTView'
import { useGameStore } from '@/state/gameStore'
import { useIRSTStore } from '@/state/irstStore'
import { multiplayerClient } from '@/network/colyseusClient'

/* ── WS / EW mixed theme ────────────────────────────────────── */
const AMBER = '#ffb000'
const AMBER_DIM = '#7a5500'
const AMBER_GLOW = '#ffcc44'
const WS_GREEN      = '#00ff64'
const WS_GREEN_DIM  = '#007a32'
const WS_BG_DARK    = '#080808'
const WS_BG_PANEL   = '#111110'
const WS_BG_SCREEN  = '#080808'
const WS_GRID       = 'rgba(0,255,100,0.07)'
const WS_RED        = '#ff3333'
const FONT          = "'Consolas', 'Monaco', monospace"
const FLARE_SINGLE_INTERVAL_MS = 500
const WS_FLARE_COUNT_MAX = 8

/* ── math helpers ───────────────────────────────────────────── */
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

/* ── reusable Panel (mirrors EW Panel, green-themed) ────────── */
function WsPanel({ title, children, style, headerRight, dimmed = false, tone = 'amber' }: {
  title: string
  children: ReactNode
  style?: CSSProperties
  headerRight?: ReactNode
  dimmed?: boolean
  tone?: 'amber' | 'green'
}) {
  const toneMain = tone === 'green' ? WS_GREEN : AMBER
  const toneDim = tone === 'green' ? WS_GREEN_DIM : AMBER_DIM
  const toneBg = tone === 'green' ? 'rgba(0,255,100,0.04)' : 'rgba(255,176,0,0.06)'

  return (
    <div style={{
      background: WS_BG_PANEL,
      border: `1px solid ${toneDim}`,
      borderRadius: 2,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      ...style,
    }}>
      <div style={{
        background: toneBg,
        borderBottom: `1px solid ${toneDim}`,
        padding: '4px 10px',
        fontSize: 10,
        fontFamily: FONT,
        color: toneMain,
        letterSpacing: 3,
        textTransform: 'uppercase',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>{title}</span>
        {headerRight ?? <span style={{ color: toneDim, fontSize: 8 }}>■ STBY</span>}
      </div>
      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: WS_BG_SCREEN,
        opacity: dimmed ? 0.45 : 1,
        filter: dimmed ? 'grayscale(1)' : 'none',
      }}>
        {children}
      </div>
    </div>
  )
}

/* ── small status indicator ─────────────────────────────────── */
function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9 }}>
      <span style={{
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 4px ${color}`,
        display: 'inline-block',
      }} />
      <span style={{ color }}>{label}</span>
    </span>
  )
}

/* ── torpedo tube readout (scaffold) ────────────────────────── */
const TUBE_COUNT = 4
const TORPEDO_LOAD_DURATION_MS = 30_000
const TORPEDO_RESERVE_START_COUNT = 5
type TubeState = 'EMPTY' | 'LOADING' | 'READY'
type TorpedoType = 'IR SEEKER' | 'ACTIVE' | 'SEMI ACTIVE'
type TubeStatus = {
  id: number
  selectedType: TorpedoType
  state: TubeState
  progressPct: number
  loadingStartedAtMs: number | null
}
const TORPEDO_TYPES: TorpedoType[] = ['IR SEEKER', 'ACTIVE', 'SEMI ACTIVE']
type TorpedoReserves = Record<TorpedoType, number>

function torpedoTypeLaunchAllowed(
  torpedoType: TorpedoType,
  hasRadarLock: boolean,
  hasIrstPointTrackTarget: boolean,
): boolean {
  if (torpedoType === 'IR SEEKER') return hasIrstPointTrackTarget
  return hasRadarLock
}

function TorpedoTubesPanel({
  hasRadarLock,
  hasIrstPointTrackTarget,
  isPowered,
  isArmed,
  onTogglePower,
  onToggleArmed,
  onLaunchTubeTorpedo,
  tubes,
  reserves,
  onSetTubeType,
  onBeginLoadingTube,
  onLaunchTube,
}: {
  hasRadarLock: boolean
  hasIrstPointTrackTarget: boolean
  isPowered: boolean
  isArmed: boolean
  onTogglePower: () => void
  onToggleArmed: () => void
  onLaunchTubeTorpedo: (tubeId: number) => boolean
  tubes: TubeStatus[]
  reserves: TorpedoReserves
  onSetTubeType: (tubeId: number, nextType: TorpedoType) => void
  onBeginLoadingTube: (tubeId: number) => void
  onLaunchTube: (tubeId: number) => void
}) {
  const loadedCount = tubes.filter((tube) => tube.state === 'READY').length
  const tubesActive = isPowered && isArmed

  return (
    <WsPanel
      title="Torpedo Tubes"
      dimmed={!isPowered}
      headerRight={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: AMBER_DIM, fontSize: 9 }}>{loadedCount}/{TUBE_COUNT} LOADED</span>
          <button
            type="button"
            onClick={onTogglePower}
            style={{
              minWidth: 42,
              height: 20,
              border: `1px solid ${isPowered ? WS_GREEN : AMBER_DIM}`,
              background: isPowered ? 'rgba(0,255,100,0.14)' : 'rgba(80,60,20,0.2)',
              color: isPowered ? '#9dffc4' : AMBER_DIM,
              fontFamily: FONT,
              fontSize: 9,
              borderRadius: 2,
              cursor: 'pointer',
              letterSpacing: 1,
            }}
          >
            {isPowered ? 'PWR ON' : 'PWR OFF'}
          </button>
          <button
            type="button"
            onClick={onToggleArmed}
            disabled={!isPowered}
            style={{
              minWidth: 44,
              height: 20,
              border: `1px solid ${isArmed ? AMBER : AMBER_GLOW}`,
              background: isArmed ? 'rgba(255,176,0,0.15)' : 'rgba(255,176,0,0.18)',
              color: isArmed ? AMBER_GLOW : '#f2d38a',
              fontFamily: FONT,
              fontSize: 9,
              borderRadius: 2,
              cursor: isPowered ? 'pointer' : 'not-allowed',
              letterSpacing: 1,
              boxShadow: isArmed ? 'none' : '0 0 4px rgba(255,176,0,0.45)',
              opacity: isPowered ? 1 : 0.45,
            }}
          >
            {isArmed ? 'ARMED' : 'ARM'}
          </button>
        </div>
      )}
    >
      <div style={{
        padding: '6px 8px',
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
        opacity: tubesActive ? 1 : 0.4,
        filter: tubesActive ? 'none' : 'grayscale(1)',
        pointerEvents: tubesActive ? 'auto' : 'none',
      }}>
        {tubes.map((tube) => {
          const readyLaunchOk = torpedoTypeLaunchAllowed(
            tube.selectedType,
            hasRadarLock,
            hasIrstPointTrackTarget,
          )
          return (
          <div key={tube.id} style={{
            flex: '1 1 calc(50% - 4px)',
            minWidth: 90,
            border: `1px solid ${AMBER_DIM}55`,
            borderRadius: 2,
            padding: '5px 8px',
            background: 'rgba(8,8,8,0.9)',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{
                fontSize: 11,
                fontFamily: FONT,
                color: AMBER,
                letterSpacing: 2,
              }}>
                TUBE {tube.id}
              </span>
              <span style={{
                fontSize: 9,
                fontFamily: FONT,
                color: AMBER_DIM,
                letterSpacing: 1,
              }}>
                {tube.state === 'LOADING' ? 'LOADING' : tube.state}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                value={tube.selectedType}
                disabled={!tubesActive || tube.state !== 'EMPTY'}
                onChange={(event) => {
                  const nextType = event.target.value as TorpedoType
                  onSetTubeType(tube.id, nextType)
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 24,
                  border: `1px solid ${AMBER_DIM}`,
                  background: 'rgba(12,12,10,0.85)',
                  color: AMBER_GLOW,
                  fontFamily: FONT,
                  fontSize: 10,
                  borderRadius: 2,
                  padding: '0 4px',
                }}
              >
                {TORPEDO_TYPES.map((torpedoType) => (
                  <option key={torpedoType} value={torpedoType}>
                    {torpedoType}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  if (tube.state === 'READY') {
                    if (onLaunchTubeTorpedo(tube.id)) onLaunchTube(tube.id)
                    return
                  }
                  if (tube.state === 'EMPTY') {
                    onBeginLoadingTube(tube.id)
                  }
                }}
                disabled={
                  !tubesActive
                  || tube.state === 'LOADING'
                  || (tube.state === 'READY' && !readyLaunchOk)
                  || (tube.state === 'EMPTY' && (reserves[tube.selectedType] ?? 0) <= 0)
                }
                style={{
                  // Make LOAD look clearly "actionable" while keeping
                  // LOADING and LAUNCH visually distinct.
                  minWidth: 64,
                  height: 24,
                  border: `1px solid ${tube.state === 'READY' && readyLaunchOk ? AMBER : AMBER_DIM}`,
                  background: tube.state === 'READY'
                    ? (readyLaunchOk ? 'rgba(255,176,0,0.15)' : 'rgba(80,60,20,0.22)')
                    : tube.state === 'LOADING'
                      ? 'rgba(80,60,20,0.22)'
                      : (reserves[tube.selectedType] ?? 0) > 0 ? 'rgba(255,176,0,0.24)' : 'rgba(80,60,20,0.22)',
                  color:
                    tube.state === 'LOADING'
                      ? AMBER_DIM
                      : tube.state === 'READY' && readyLaunchOk
                        ? AMBER_GLOW
                        : (reserves[tube.selectedType] ?? 0) > 0 ? AMBER_GLOW : AMBER_DIM,
                  boxShadow:
                    tube.state === 'LOADING'
                      ? 'none'
                      : tube.state === 'READY' && readyLaunchOk
                        ? '0 0 10px rgba(255,176,0,0.35), inset 0 0 8px rgba(255,176,0,0.16)'
                        : (reserves[tube.selectedType] ?? 0) > 0
                          ? '0 0 8px rgba(255,176,0,0.25), inset 0 0 10px rgba(255,176,0,0.2)'
                          : 'none',
                  fontFamily: FONT,
                  fontSize: 10,
                  borderRadius: 2,
                  cursor:
                    !tubesActive
                    || tube.state === 'LOADING' || (tube.state === 'READY' && !readyLaunchOk)
                    || (tube.state === 'EMPTY' && (reserves[tube.selectedType] ?? 0) <= 0)
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {tube.state === 'READY'
                  ? (tube.selectedType === 'IR SEEKER' && !hasIrstPointTrackTarget ? 'NO LOCK' : 'LAUNCH')
                  : 'LOAD'}
              </button>
            </div>
            <div style={{
              height: 4,
              background: `${AMBER_DIM}55`,
              borderRadius: 1,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${tube.progressPct}%`,
                height: '100%',
                background: tube.state === 'READY' ? AMBER_GLOW : AMBER,
                transition: tube.state === 'LOADING' ? 'none' : 'width 0.2s ease-out',
              }} />
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{
                fontSize: 8,
                fontFamily: FONT,
                color: `${AMBER_DIM}cc`,
                letterSpacing: 1,
              }}>
                {tube.selectedType}
              </span>
              <span style={{
                fontSize: 8,
                fontFamily: FONT,
                color: `${AMBER_DIM}cc`,
                letterSpacing: 1,
              }}>
                {tube.state === 'READY' && !readyLaunchOk
                  ? 'NO LOCK'
                  : tube.state === 'LOADING'
                    ? `${Math.floor(tube.progressPct)}%`
                    : tube.state === 'READY'
                      ? '100%'
                      : '0%'}
              </span>
            </div>
          </div>
          )
        })}
      </div>
    </WsPanel>
  )
}

function TorpedoReservesPanel({ reserves }: { reserves: TorpedoReserves }) {
  return (
    <WsPanel
      title="Torpedo Reserves"
      headerRight={<span style={{ color: AMBER_DIM, fontSize: 9 }}>MAGAZINE</span>}
    >
      <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {TORPEDO_TYPES.map((torpedoType) => {
          const remaining = Math.max(0, reserves[torpedoType] ?? 0)
          return (
            <div
              key={torpedoType}
              style={{
                border: `1px solid ${AMBER_DIM}44`,
                borderRadius: 2,
                padding: '6px 8px',
                background: 'rgba(8,8,8,0.9)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 10, fontFamily: FONT, color: AMBER, letterSpacing: 1 }}>
                {torpedoType}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {Array.from({ length: TORPEDO_RESERVE_START_COUNT }, (_, index) => {
                    const lit = index < remaining
                    return (
                      <span
                        key={`${torpedoType}-${index}`}
                        style={{
                          width: 16,
                          height: 6,
                          borderRadius: 999,
                          border: `1px solid ${lit ? AMBER : `${AMBER_DIM}88`}`,
                          background: lit ? 'rgba(255,176,0,0.3)' : 'rgba(35,28,12,0.2)',
                          boxShadow: lit ? '0 0 6px rgba(255,176,0,0.28)' : 'none',
                          display: 'inline-block',
                        }}
                      />
                    )
                  })}
                </div>
                <span style={{ fontSize: 10, fontFamily: FONT, color: AMBER_GLOW, minWidth: 24 }}>
                  x{remaining}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </WsPanel>
  )
}

/* ── DEW constants ──────────────────────────────────────────── */
const DEW_CHARGE_DURATION_MS = 10_000
const DEW_DIAGRAM_W = 700
const DEW_DIAGRAM_H = 150
const DEW_SOURCE_X = 42
const DEW_BEAM_HALF_H = 25
/** ViewBox units: |ΔY| between upper/lower rays at target range ≥ this → spread score hits 0. */
const DEW_FOCUS_SPREAD_REF = DEW_DIAGRAM_H
const DEW_TARGET_MAX_RANGE_M = 20_000
const DEW_CONVERGENCE_ZONE_LEFT = DEW_DIAGRAM_W / 2
const DEW_CONVERGENCE_ZONE_RIGHT = DEW_DIAGRAM_W - 10
const DEW_BASE_DAMAGE_AT_MAX_RANGE = 2000
const DEW_BASE_DAMAGE_AT_ZERO_RANGE = 4000
const DEW_DAMAGE_FALLOFF_MAX_RANGE_M = 20_000
const DEW_DAMAGE_RANGE_CURVE_EXPONENT = 1.6

const DEW_LENS_HEIGHT = 60
const DEW_LENS_DEFS = [
  { focalLength: 256, rx: 8, label: 'L1' },
  { focalLength: 163, rx: 7, label: 'L2' },
  { focalLength: 105, rx: 6, label: 'L3' },
] as const

type LensType = 'convex' | 'concave'

function rangeToTargetX(rangeM: number): number {
  const clampedRange = Math.max(0, Math.min(DEW_TARGET_MAX_RANGE_M, rangeM))
  const t = clampedRange / DEW_TARGET_MAX_RANGE_M
  return DEW_CONVERGENCE_ZONE_LEFT + t * (DEW_CONVERGENCE_ZONE_RIGHT - DEW_CONVERGENCE_ZONE_LEFT)
}

function getDewBaseDamageByRange(rangeM: number): number {
  const clampedRange = Math.max(0, Math.min(DEW_DAMAGE_FALLOFF_MAX_RANGE_M, rangeM))
  const closeness = 1 - (clampedRange / DEW_DAMAGE_FALLOFF_MAX_RANGE_M)
  const curvedCloseness = Math.pow(closeness, DEW_DAMAGE_RANGE_CURVE_EXPONENT)
  return DEW_BASE_DAMAGE_AT_MAX_RANGE
    + (DEW_BASE_DAMAGE_AT_ZERO_RANGE - DEW_BASE_DAMAGE_AT_MAX_RANGE) * curvedCloseness
}

interface TracedRay {
  segments: [number, number][]
  finalAngle: number
}

function traceRay(
  startX: number, startY: number, angleDeg: number,
  lensXs: number[], midY: number,
  lensTypes: LensType[],
  lensFocalLengths: number[],
): TracedRay {
  const segments: [number, number][] = [[startX, startY]]
  let x = startX
  let y = startY
  let angle = (angleDeg * Math.PI) / 180

  for (let i = 0; i < lensXs.length; i++) {
    const lx = lensXs[i] ?? 0
    const dx = lx - x
    y = y + Math.tan(angle) * dx
    x = lx
    segments.push([x, y])
    const heightFromAxis = y - midY
    const f = lensFocalLengths[i] ?? 60
    const sign = (lensTypes[i] ?? 'convex') === 'concave' ? 1 : -1
    angle = angle + sign * (heightFromAxis / f)
  }

  const extendDx = DEW_CONVERGENCE_ZONE_RIGHT + 20 - x
  const endY = y + Math.tan(angle) * extendDx
  segments.push([x + extendDx, endY])

  return { segments, finalAngle: (angle * 180) / Math.PI }
}

function findConvergenceX(
  rayTop: TracedRay, rayBot: TracedRay, midY: number,
): number | null {
  const topSegs = rayTop.segments
  const botSegs = rayBot.segments
  const topLast = topSegs[topSegs.length - 2]
  const topEnd = topSegs[topSegs.length - 1]
  const botLast = botSegs[botSegs.length - 2]
  const botEnd = botSegs[botSegs.length - 1]
  if (!topLast || !topEnd || !botLast || !botEnd) return null

  const x1 = topLast[0], y1 = topLast[1], x2 = topEnd[0], y2 = topEnd[1]
  const x3 = botLast[0], y3 = botLast[1], x4 = botEnd[0], y4 = botEnd[1]
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  if (Math.abs(denom) < 1e-9) return null
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
  const cx = x1 + t * (x2 - x1)
  const cy = y1 + t * (y2 - y1)
  if (cx < topLast[0] - 2) return null
  if (Math.abs(cy - midY) > DEW_DIAGRAM_H) return null
  return cx
}

/** Y on the traced ray polyline at x (diagram space); null if x is outside the polyline span. */
function yOnRayPolylineAtX(segments: [number, number][], x: number): number | null {
  const eps = 1e-5
  for (let i = 0; i < segments.length - 1; i++) {
    const p0 = segments[i]
    const p1 = segments[i + 1]
    if (!p0 || !p1) continue
    const [x0, y0] = p0
    const [x1, y1] = p1
    const minX = Math.min(x0, x1) - eps
    const maxX = Math.max(x0, x1) + eps
    if (x < minX || x > maxX) continue
    const dx = x1 - x0
    if (Math.abs(dx) < 1e-9) return (y0 + y1) / 2
    const t = (x - x0) / dx
    return y0 + t * (y1 - y0)
  }
  return null
}

/* ── lens focus minigame ────────────────────────────────────── */
const DEW_SCALE_H = 20
const DEW_SCALE_MAJOR_KM = [0, 5, 10, 15, 20]
const DEW_SCALE_MINOR_KM = [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19]

function LensFocusDiagram({
  enabled,
  targetRangeM,
  onAlignmentChange,
}: {
  enabled: boolean
  targetRangeM: number
  onAlignmentChange?: (alignment: number) => void
}) {
  const midY = DEW_DIAGRAM_H / 2
  const totalSvgH = DEW_DIAGRAM_H + DEW_SCALE_H
  const lensZoneLeft = 56
  const lensZoneRight = DEW_DIAGRAM_W / 2 - 18
  const lensSpacing = (lensZoneRight - lensZoneLeft) / (DEW_LENS_DEFS.length + 1)
  const targetInRange = targetRangeM <= DEW_TARGET_MAX_RANGE_M

  const [lensXs, setLensXs] = useState(() =>
    DEW_LENS_DEFS.map((_, i) => lensZoneLeft + lensSpacing * (i + 1))
  )
  const [lensTypes, setLensTypes] = useState<LensType[]>(() =>
    DEW_LENS_DEFS.map(() => 'convex')
  )
  const [lensWidths, setLensWidths] = useState<number[]>(() =>
    DEW_LENS_DEFS.map((d) => d.rx)
  )
  const [dragging, setDragging] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const getMinX = (i: number) => i === 0 ? lensZoneLeft : (lensXs[i - 1] ?? lensZoneLeft) + 28
  const getMaxX = (i: number) => i === DEW_LENS_DEFS.length - 1 ? lensZoneRight : (lensXs[i + 1] ?? lensZoneRight) - 28

  const handlePointerDown = useCallback((idx: number) => (e: React.PointerEvent) => {
    if (!enabled) return
    e.preventDefault()
    if (e.ctrlKey) {
      setLensTypes((prev) => prev.map((t, i) => i === idx ? (t === 'convex' ? 'concave' : 'convex') : t))
      return
    }
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDragging(idx)
  }, [enabled])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging === null || !svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = DEW_DIAGRAM_W / rect.width
    const localX = (e.clientX - rect.left) * scaleX
    const minX = getMinX(dragging)
    const maxX = getMaxX(dragging)
    const clamped = Math.max(minX, Math.min(maxX, localX))
    setLensXs((prev) => prev.map((x, i) => i === dragging ? clamped : x))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, enabled])

  const handlePointerUp = useCallback(() => { setDragging(null) }, [])

  const handleWheel = useCallback((idx: number) => (e: React.WheelEvent) => {
    if (!enabled) return
    e.stopPropagation()
    if (e.altKey) {
      e.preventDefault()
      const wStep = 0.5 * Math.sign(e.deltaY)
      setLensWidths((prev) => prev.map((w, i) => i === idx ? Math.max(3, Math.min(18, w + wStep)) : w))
    } else {
      const step = 3 * Math.sign(e.deltaY)
      setLensXs((prev) => prev.map((x, i) => {
        if (i !== idx) return x
        const minX = i === 0 ? lensZoneLeft : (prev[i - 1] ?? lensZoneLeft) + 28
        const maxX = i === DEW_LENS_DEFS.length - 1 ? lensZoneRight : (prev[i + 1] ?? lensZoneRight) - 28
        return Math.max(minX, Math.min(maxX, x + step))
      }))
    }
  }, [enabled, lensZoneLeft, lensZoneRight])

  const effectiveFs = DEW_LENS_DEFS.map((def, i) => def.focalLength * (def.rx / (lensWidths[i] ?? def.rx)))
  const rayTop = traceRay(DEW_SOURCE_X, midY - DEW_BEAM_HALF_H, 0, lensXs, midY, lensTypes, effectiveFs)
  const rayBot = traceRay(DEW_SOURCE_X, midY + DEW_BEAM_HALF_H, 0, lensXs, midY, lensTypes, effectiveFs)

  const convergenceX = findConvergenceX(rayTop, rayBot, midY)
  const targetX = targetInRange ? rangeToTargetX(targetRangeM) : null

  const focusZoneWidth = (DEW_CONVERGENCE_ZONE_RIGHT - DEW_CONVERGENCE_ZONE_LEFT)
  const halfZone = focusZoneWidth * 0.5
  const hasAxial = convergenceX !== null && targetX !== null
  const axialScore = hasAxial
    ? Math.max(0, Math.min(1, 1 - Math.abs(convergenceX - targetX) / halfZone))
    : null

  const yTopAtTgt = targetX !== null ? yOnRayPolylineAtX(rayTop.segments, targetX) : null
  const yBotAtTgt = targetX !== null ? yOnRayPolylineAtX(rayBot.segments, targetX) : null
  const spreadAtTgt = yTopAtTgt !== null && yBotAtTgt !== null
    ? Math.abs(yTopAtTgt - yBotAtTgt)
    : null
  const spreadScore = spreadAtTgt !== null
    ? Math.max(0, Math.min(1, 1 - spreadAtTgt / DEW_FOCUS_SPREAD_REF))
    : null

  let focusCombined: number
  if (axialScore !== null && spreadScore !== null) {
    focusCombined = (axialScore + spreadScore) / 2
  } else if (axialScore !== null) {
    focusCombined = axialScore
  } else if (spreadScore !== null) {
    focusCombined = spreadScore
  } else {
    focusCombined = 0
  }

  const focusPct = targetInRange ? Math.max(0, Math.round(focusCombined * 100)) : 0
  const focusAlignment = enabled && targetInRange ? Math.max(0, Math.min(1, focusPct / 100)) : 0

  useEffect(() => {
    onAlignmentChange?.(focusAlignment)
  }, [focusAlignment, onAlignmentChange])

  const beamColor = !enabled ? `${AMBER_DIM}44`
    : focusPct > 85 ? '#ff4400'
    : focusPct > 50 ? AMBER
    : `${AMBER_DIM}aa`

  const topPath = rayTop.segments.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  const botPath = rayBot.segments.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')

  const rangeLabel = targetRangeM >= 1000
    ? `${(targetRangeM / 1000).toFixed(1)}km`
    : `${Math.round(targetRangeM)}m`

  return (
    <div style={{ padding: '4px 8px 6px' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 3,
      }}>
        <span style={{ fontSize: 9, fontFamily: FONT, color: AMBER_DIM, letterSpacing: 1 }}>
          BEAM FOCUS — RNG {rangeLabel}{!targetInRange ? ' (OUT OF RANGE)' : ''}
        </span>
        <span style={{
          fontSize: 9,
          fontFamily: FONT,
          letterSpacing: 1,
          color: !targetInRange ? AMBER_DIM : focusPct > 85 ? '#ff4400' : focusPct > 50 ? AMBER : AMBER_DIM,
        }}>
          {enabled ? (targetInRange ? `${focusPct}%` : '—') : '—'}
        </span>
      </div>
      {/* Match viewBox aspect so the diagram scales uniformly to full width (no right-side letterboxing). */}
      <div
        style={{
          width: '100%',
          minWidth: 0,
          aspectRatio: `${DEW_DIAGRAM_W} / ${totalSvgH}`,
        }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${DEW_DIAGRAM_W} ${totalSvgH}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            background: 'rgba(0,0,0,0.6)',
            border: `1px solid ${AMBER_DIM}44`,
            borderRadius: 2,
            cursor: dragging !== null ? 'grabbing' : 'default',
            display: 'block',
          }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
        {/* clip to diagram bounds (excludes scale strip) */}
        <defs>
          <clipPath id="dew-clip"><rect x={0} y={0} width={DEW_DIAGRAM_W} height={DEW_DIAGRAM_H} /></clipPath>
        </defs>
        <g clipPath="url(#dew-clip)">

        {/* optical axis */}
        <line x1={0} y1={midY} x2={DEW_DIAGRAM_W} y2={midY}
          stroke={`${AMBER_DIM}22`} strokeWidth={0.5} strokeDasharray="2,4" />

        {/* convergence zone background */}
        <rect x={DEW_CONVERGENCE_ZONE_LEFT} y={1} width={DEW_CONVERGENCE_ZONE_RIGHT - DEW_CONVERGENCE_ZONE_LEFT} height={DEW_DIAGRAM_H - 2}
          fill="rgba(255,176,0,0.03)" stroke="none" />

        {/* source emitter — vertical line representing collimated beam aperture */}
        <line
          x1={DEW_SOURCE_X} y1={midY - DEW_BEAM_HALF_H}
          x2={DEW_SOURCE_X} y2={midY + DEW_BEAM_HALF_H}
          stroke={enabled ? AMBER : AMBER_DIM} strokeWidth={2} strokeLinecap="round"
        />
        <line
          x1={DEW_SOURCE_X} y1={midY - DEW_BEAM_HALF_H}
          x2={DEW_SOURCE_X} y2={midY + DEW_BEAM_HALF_H}
          stroke={enabled ? AMBER_GLOW : AMBER_DIM} strokeWidth={1} strokeLinecap="round"
          style={{ filter: enabled ? 'drop-shadow(0 0 3px rgba(255,204,68,0.5))' : 'none' }}
        />

        {/* target range marker — only shown when target is within 20km */}
        {targetInRange && targetX !== null && (
          <g>
            <line x1={targetX} y1={4} x2={targetX} y2={DEW_DIAGRAM_H - 4}
              stroke={enabled ? WS_RED : `${AMBER_DIM}44`} strokeWidth={0.75} strokeDasharray="2,2" />
            <line x1={targetX - 6} y1={midY - 8} x2={targetX + 6} y2={midY + 8}
              stroke={enabled ? WS_RED : `${AMBER_DIM}66`} strokeWidth={1.3} />
            <line x1={targetX + 6} y1={midY - 8} x2={targetX - 6} y2={midY + 8}
              stroke={enabled ? WS_RED : `${AMBER_DIM}66`} strokeWidth={1.3} />
            <text x={targetX} y={DEW_DIAGRAM_H - 2} textAnchor="middle" fontSize={12}
              fill={enabled ? WS_RED : `${AMBER_DIM}66`} fontFamily={FONT}
              fontWeight="bold" style={{ filter: enabled ? 'drop-shadow(0 0 2px rgba(255,51,51,0.6))' : 'none' }}>TGT</text>
          </g>
        )}

        {/* beam rays */}
        <path d={topPath} fill="none" stroke={beamColor} strokeWidth={1}
          strokeLinecap="round" strokeLinejoin="round"
          style={{ filter: enabled && focusPct > 85 ? 'drop-shadow(0 0 3px #ff4400)' : 'none' }} />
        <path d={botPath} fill="none" stroke={beamColor} strokeWidth={1}
          strokeLinecap="round" strokeLinejoin="round"
          style={{ filter: enabled && focusPct > 85 ? 'drop-shadow(0 0 3px #ff4400)' : 'none' }} />

        {/* convergence point indicator */}
        {convergenceX !== null && convergenceX >= DEW_CONVERGENCE_ZONE_LEFT - 10 && convergenceX <= DEW_CONVERGENCE_ZONE_RIGHT + 10 && (
          <g>
            <circle cx={convergenceX} cy={midY} r={4}
              fill="none"
              stroke={focusPct > 85 ? '#ff4400' : focusPct > 50 ? AMBER : AMBER_DIM}
              strokeWidth={1.5}
              style={{ filter: focusPct > 85 ? 'drop-shadow(0 0 4px rgba(255,68,0,0.6))' : 'none' }} />
            <text x={convergenceX} y={13} textAnchor="middle" fontSize={12}
              fill={focusPct > 85 ? '#ff4400' : focusPct > 50 ? AMBER : AMBER_DIM} fontFamily={FONT}
              fontWeight="bold"
              style={{ filter: focusPct > 85 ? 'drop-shadow(0 0 3px rgba(255,68,0,0.7))' : 'none' }}>
              FOC
            </text>
          </g>
        )}

        {/* lenses */}
        {DEW_LENS_DEFS.map((def, i) => {
          const lx = lensXs[i] ?? 0
          const rx = lensWidths[i] ?? def.rx
          const isActive = dragging === i
          const isHot = isActive || (hovered === i && dragging === null)
          const lensHeight = DEW_LENS_HEIGHT
          const halfH = lensHeight / 2
          const type = lensTypes[i] ?? 'convex'
          const hitPadX = 14
          const hitPadY = 10
          const hitW = rx * 2 + hitPadX * 2
          const hitH = lensHeight + hitPadY * 2
          return (
            <g key={i}>
              {/* solid hitbox centered on the lens */}
              <rect
                x={lx - hitW / 2} y={midY - hitH / 2}
                width={hitW} height={hitH}
                rx={3} ry={3}
                fill="transparent"
                stroke="none"
                style={{ cursor: enabled ? 'ew-resize' : 'default' }}
                onPointerDown={handlePointerDown(i)}
                onPointerEnter={() => { if (enabled) setHovered(i) }}
                onPointerLeave={() => setHovered((prev) => prev === i ? null : prev)}
                onWheel={handleWheel(i)}
              />
              {enabled && (
                <line x1={lx} y1={midY - lensHeight / 2 - 6} x2={lx} y2={midY + lensHeight / 2 + 6}
                  stroke={isHot ? `${AMBER_GLOW}44` : `${AMBER_DIM}22`}
                  strokeWidth={0.5} strokeDasharray="2,2"
                  pointerEvents="none" />
              )}
              <path
                d={type === 'concave'
                  ? `M${lx - rx},${midY - halfH} L${lx + rx},${midY - halfH} Q${lx},${midY} ${lx + rx},${midY + halfH} L${lx - rx},${midY + halfH} Q${lx},${midY} ${lx - rx},${midY - halfH} Z`
                  : `M${lx},${midY - halfH} Q${lx + rx * 2},${midY} ${lx},${midY + halfH} Q${lx - rx * 2},${midY} ${lx},${midY - halfH} Z`}
                fill={enabled ? (isHot ? 'rgba(255,204,68,0.15)' : 'rgba(255,176,0,0.06)') : 'rgba(60,60,60,0.06)'}
                stroke={isActive ? AMBER_GLOW : isHot ? AMBER : enabled ? AMBER : AMBER_DIM}
                strokeWidth={isActive ? 2.5 : isHot ? 1.8 : 1.2}
                style={{ filter: isHot ? 'drop-shadow(0 0 5px rgba(255,204,68,0.6))' : 'none' }}
                pointerEvents="none"
              />
              <text x={lx} y={midY + lensHeight / 2 + 14}
                textAnchor="middle" fontSize={11}
                fill={enabled ? (isHot ? AMBER_GLOW : AMBER) : `${AMBER_DIM}66`}
                fontFamily={FONT} fontWeight="bold"
                style={{ filter: isHot ? 'drop-shadow(0 0 2px rgba(255,204,68,0.5))' : 'none' }}
                pointerEvents="none">
                {def.label}
              </text>
            </g>
          )
        })}

        </g>

        {/* ── range scale strip (below clipped content) ────────── */}
        <line x1={DEW_CONVERGENCE_ZONE_LEFT} y1={DEW_DIAGRAM_H}
          x2={DEW_CONVERGENCE_ZONE_RIGHT} y2={DEW_DIAGRAM_H}
          stroke={AMBER_DIM} strokeWidth={0.5} />

        {DEW_SCALE_MINOR_KM.map((km) => {
          const sx = rangeToTargetX(km * 1000)
          return (
            <line key={`minor-${km}`}
              x1={sx} y1={DEW_DIAGRAM_H} x2={sx} y2={DEW_DIAGRAM_H + 4}
              stroke={`${AMBER_DIM}88`} strokeWidth={0.5} />
          )
        })}

        {DEW_SCALE_MAJOR_KM.map((km) => {
          const sx = rangeToTargetX(km * 1000)
          return (
            <g key={`major-${km}`}>
              <line x1={sx} y1={DEW_DIAGRAM_H} x2={sx} y2={DEW_DIAGRAM_H + 7}
                stroke={AMBER_DIM} strokeWidth={0.75} />
              <text x={sx} y={DEW_DIAGRAM_H + 16}
                textAnchor="middle" fontSize={8}
                fill={AMBER_DIM} fontFamily={FONT}>
                {km}
              </text>
            </g>
          )
        })}

        <text x={DEW_CONVERGENCE_ZONE_LEFT - 4} y={DEW_DIAGRAM_H + 16}
          textAnchor="end" fontSize={7}
          fill={`${AMBER_DIM}aa`} fontFamily={FONT}>
          km
        </text>
        </svg>
      </div>
    </div>
  )
}

/* ── directed energy weapon panel ───────────────────────────── */
function LaserSystemsPanel({
  isPowered,
  isArmed,
  hasTarget,
  targetRangeM,
  onFocusAlignmentChange,
  capacitor,
  capacitorMax,
  onChargingChange,
  onTogglePower,
  onToggleArmed,
  onFire,
}: {
  isPowered: boolean
  isArmed: boolean
  hasTarget: boolean
  targetRangeM: number
  onFocusAlignmentChange?: (alignment: number) => void
  capacitor: number
  capacitorMax: number
  onChargingChange: (charging: boolean) => void
  onTogglePower: () => void
  onToggleArmed: () => void
  onFire: () => void
}) {
  const active = isPowered && isArmed
  const [charging, setCharging] = useState(false)
  const [chargePct, setChargePct] = useState(0)
  const chargeStartRef = useRef<number | null>(null)
  const chargeRafRef = useRef<number | null>(null)
  const notifiedChargingRef = useRef<boolean>(false)
  const requiredCapacitor = capacitorMax * 0.1

  useEffect(() => {
    if (!active) {
      setCharging(false)
      setChargePct(0)
      chargeStartRef.current = null
      if (chargeRafRef.current !== null) cancelAnimationFrame(chargeRafRef.current)
    }
  }, [active])

  useEffect(() => {
    const nextCharging = active && charging && chargePct < 100
    if (notifiedChargingRef.current === nextCharging) return
    notifiedChargingRef.current = nextCharging
    onChargingChange(nextCharging)
  }, [active, chargePct, charging, onChargingChange])

  useEffect(() => {
    return () => {
      notifiedChargingRef.current = false
      onChargingChange(false)
    }
  }, [onChargingChange])

  useEffect(() => {
    if (charging && capacitor <= 0) {
      setCharging(false)
      setChargePct(0)
      chargeStartRef.current = null
      if (chargeRafRef.current !== null) cancelAnimationFrame(chargeRafRef.current)
    }
  }, [capacitor, charging])

  const startCharge = () => {
    if (!active || charging) return
    if (capacitor < requiredCapacitor) return
    setCharging(true)
    setChargePct(0)
    chargeStartRef.current = performance.now()

    const tick = () => {
      const start = chargeStartRef.current
      if (start === null) return
      const elapsed = performance.now() - start
      const pct = Math.min(100, (elapsed / DEW_CHARGE_DURATION_MS) * 100)
      setChargePct(pct)
      if (pct < 100) {
        chargeRafRef.current = requestAnimationFrame(tick)
      } else {
        setCharging(false)
      }
    }
    chargeRafRef.current = requestAnimationFrame(tick)
  }

  const resetCharge = () => {
    setCharging(false)
    setChargePct(0)
    chargeStartRef.current = null
    if (chargeRafRef.current !== null) cancelAnimationFrame(chargeRafRef.current)
  }

  useEffect(() => {
    return () => {
      if (chargeRafRef.current !== null) cancelAnimationFrame(chargeRafRef.current)
    }
  }, [])

  const charged = chargePct >= 100
  const statusLabel = !isPowered ? 'OFFLINE' : !isArmed ? 'SAFE' : charged ? 'CHARGED' : charging ? 'CHARGING' : 'STBY'
  const statusColor = !isPowered ? AMBER_DIM : !isArmed ? AMBER_DIM : charged ? '#ff4400' : charging ? AMBER_GLOW : AMBER_DIM
  const canFire = active && charged && hasTarget

  const handleFire = () => {
    if (!canFire) return
    onFire()
    resetCharge()
  }

  return (
    <WsPanel
      title="Directed Energy Weapon"
      dimmed={!isPowered}
      headerRight={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={onTogglePower}
            style={{
              minWidth: 42,
              height: 20,
              border: `1px solid ${isPowered ? WS_GREEN : AMBER_DIM}`,
              background: isPowered ? 'rgba(0,255,100,0.14)' : 'rgba(80,60,20,0.2)',
              color: isPowered ? '#9dffc4' : AMBER_DIM,
              fontFamily: FONT,
              fontSize: 9,
              borderRadius: 2,
              cursor: 'pointer',
              letterSpacing: 1,
            }}
          >
            {isPowered ? 'PWR ON' : 'PWR OFF'}
          </button>
          <button
            type="button"
            onClick={onToggleArmed}
            disabled={!isPowered}
            style={{
              minWidth: 44,
              height: 20,
              border: `1px solid ${isArmed ? AMBER : AMBER_GLOW}`,
              background: isArmed ? 'rgba(255,176,0,0.15)' : 'rgba(255,176,0,0.18)',
              color: isArmed ? AMBER_GLOW : '#f2d38a',
              fontFamily: FONT,
              fontSize: 9,
              borderRadius: 2,
              cursor: isPowered ? 'pointer' : 'not-allowed',
              letterSpacing: 1,
              boxShadow: isArmed ? 'none' : '0 0 4px rgba(255,176,0,0.45)',
              opacity: isPowered ? 1 : 0.45,
            }}
          >
            {isArmed ? 'ARMED' : 'ARM'}
          </button>
        </div>
      )}
    >
      <div style={{
        opacity: active ? 1 : 0.4,
        filter: active ? 'none' : 'grayscale(1)',
        pointerEvents: active ? 'auto' : 'none',
      }}>
        {/* charge controls */}
        <div style={{ padding: '6px 8px' }}>
          <div style={{
            border: `1px solid ${AMBER_DIM}55`,
            borderRadius: 2,
            padding: '5px 8px',
            background: 'rgba(8,8,8,0.9)',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 4,
            }}>
              <span style={{ fontSize: 11, fontFamily: FONT, color: AMBER, letterSpacing: 2 }}>
                DEW-1
              </span>
              <span style={{ fontSize: 9, fontFamily: FONT, color: statusColor, letterSpacing: 1 }}>
                {statusLabel}
              </span>
            </div>

            {/* charge bar */}
            <div style={{
              height: 6,
              background: `${AMBER_DIM}44`,
              borderRadius: 1,
              overflow: 'hidden',
              marginBottom: 4,
            }}>
              <div style={{
                width: `${chargePct}%`,
                height: '100%',
                background: charged
                  ? '#ff4400'
                  : `linear-gradient(90deg, ${AMBER_DIM}, ${AMBER_GLOW})`,
                transition: 'background 0.3s',
                boxShadow: charged ? '0 0 6px #ff440088' : 'none',
              }} />
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: 8, fontFamily: FONT, color: `${AMBER_DIM}cc`, letterSpacing: 1 }}>
                CAP: {Math.round(chargePct)}%
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  disabled={!active || (charging && !charged) || (charged && !hasTarget) || (!charged && !charging && capacitor < requiredCapacitor)}
                  onClick={charged ? handleFire : (charging ? resetCharge : startCharge)}
                  style={{
                    height: 18,
                    padding: '0 8px',
                    border: `1px solid ${!active ? AMBER_DIM : charged ? '#ff4400' : AMBER}`,
                    background: charged ? 'rgba(255,68,0,0.15)' : 'rgba(255,176,0,0.1)',
                    color: !active ? AMBER_DIM : charged ? '#ff4400' : AMBER,
                    fontFamily: FONT,
                    fontSize: 9,
                    borderRadius: 2,
                    cursor: !active || (charged && !hasTarget) ? 'not-allowed' : 'pointer',
                    letterSpacing: 1,
                    opacity: charged && !hasTarget ? 0.5 : 1,
                  }}
                >
                  {charged ? (hasTarget ? 'FIRE' : 'NO TGT') : charging ? 'CHRG...' : 'CHARGE'}
                </button>
                {(charging || charged) && (
                  <button
                    type="button"
                    onClick={resetCharge}
                    style={{
                      height: 18,
                      padding: '0 6px',
                      border: `1px solid ${AMBER_DIM}`,
                      background: 'rgba(80,60,20,0.15)',
                      color: AMBER_DIM,
                      fontFamily: FONT,
                      fontSize: 9,
                      borderRadius: 2,
                      cursor: 'pointer',
                      letterSpacing: 1,
                    }}
                  >
                    RST
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* lens focus minigame — available whenever system is active */}
        <LensFocusDiagram
          enabled={active}
          targetRangeM={targetRangeM}
          onAlignmentChange={onFocusAlignmentChange}
        />
      </div>
    </WsPanel>
  )
}

/* ── countermeasures readout (scaffold) ──────────────────────── */
function CountermeasuresPanel({
  flareCount,
  flareMode,
  flareLaunching,
  flareInventory,
  flareInventoryMax,
  chaffInventory,
  chaffInventoryMax,
  isPowered,
  isArmed,
  onFlareCountChange,
  onFlareModeChange,
  onLaunchFlares,
  onLaunchChaff,
  onTogglePower,
  onToggleArmed,
}: {
  flareCount: number
  flareMode: 'PTN' | 'SGL'
  flareLaunching: boolean
  flareInventory: number
  flareInventoryMax: number
  chaffInventory: number
  chaffInventoryMax: number
  isPowered: boolean
  isArmed: boolean
  onFlareCountChange: (count: number) => void
  onFlareModeChange: (mode: 'PTN' | 'SGL') => void
  onLaunchFlares: () => void
  onLaunchChaff: () => void
  onTogglePower: () => void
  onToggleArmed: () => void
}) {
  return (
    <WsPanel
      title="Countermeasures"
      headerRight={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={onTogglePower}
            style={{
              minWidth: 42,
              height: 20,
              border: `1px solid ${isPowered ? WS_GREEN : AMBER_DIM}`,
              background: isPowered ? 'rgba(0,255,100,0.14)' : 'rgba(80,60,20,0.2)',
              color: isPowered ? '#9dffc4' : AMBER_DIM,
              fontFamily: FONT,
              fontSize: 9,
              borderRadius: 2,
              cursor: 'pointer',
              letterSpacing: 1,
            }}
          >
            {isPowered ? 'PWR ON' : 'PWR OFF'}
          </button>
          <button
            type="button"
            onClick={onToggleArmed}
            disabled={!isPowered}
            style={{
              minWidth: 44,
              height: 20,
              border: `1px solid ${isArmed ? AMBER : AMBER_GLOW}`,
              background: isArmed ? 'rgba(255,176,0,0.15)' : 'rgba(255,176,0,0.18)',
              color: isArmed ? AMBER_GLOW : '#f2d38a',
              fontFamily: FONT,
              fontSize: 9,
              borderRadius: 2,
              cursor: isPowered ? 'pointer' : 'not-allowed',
              letterSpacing: 1,
              boxShadow: isArmed ? 'none' : `0 0 4px rgba(255,176,0,0.45)`,
              opacity: isPowered ? 1 : 0.45,
            }}
          >
            {isArmed ? 'ARMED' : 'ARM'}
          </button>
        </div>
      )}
    >
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        opacity: isPowered && isArmed ? 1 : 0.4,
        filter: isPowered && isArmed ? 'none' : 'grayscale(1)',
        pointerEvents: isPowered && isArmed ? 'auto' : 'none',
      }}>
      <div style={{ padding: '6px 8px 8px 8px' }}>
        <div style={{
          border: `1px solid ${AMBER_DIM}55`,
          borderRadius: 2,
          padding: '6px 8px',
          background: 'rgba(8,8,8,0.9)',
          display: 'grid',
          gridTemplateColumns: 'auto auto 1fr auto',
          gap: 6,
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 10, fontFamily: FONT, color: AMBER, letterSpacing: 1 }}>
            FLARES {flareInventory}/{flareInventoryMax}
          </span>
          <select
            value={flareCount}
            onChange={(event) => onFlareCountChange(Number(event.target.value))}
            disabled={!isPowered || !isArmed || flareInventory <= 0}
            style={{
              height: 22,
              border: `1px solid ${AMBER_DIM}`,
              background: 'rgba(12,12,10,0.85)',
              color: AMBER_GLOW,
              fontFamily: FONT,
              fontSize: 11,
              borderRadius: 2,
              padding: '0 4px',
            }}
          >
            {Array.from(
              { length: Math.max(1, Math.min(WS_FLARE_COUNT_MAX, flareInventory || 1)) },
              (_, i) => i + 1
            ).map((count) => (
              <option key={count} value={count}>{count}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => onFlareModeChange('PTN')}
              disabled={!isPowered || !isArmed}
              style={{
                minWidth: 38,
                height: 22,
                border: `1px solid ${flareMode === 'PTN' ? AMBER : AMBER_DIM}`,
                background: flareMode === 'PTN' ? 'rgba(255,176,0,0.15)' : 'rgba(80,60,20,0.2)',
                color: flareMode === 'PTN' ? AMBER_GLOW : AMBER_DIM,
                fontFamily: FONT,
                fontSize: 10,
                borderRadius: 2,
                cursor: 'pointer',
              }}
            >
              PTN
            </button>
            <button
              type="button"
              onClick={() => onFlareModeChange('SGL')}
              disabled={!isPowered || !isArmed}
              style={{
                minWidth: 38,
                height: 22,
                border: `1px solid ${flareMode === 'SGL' ? AMBER : AMBER_DIM}`,
                background: flareMode === 'SGL' ? 'rgba(255,176,0,0.15)' : 'rgba(80,60,20,0.2)',
                color: flareMode === 'SGL' ? AMBER_GLOW : AMBER_DIM,
                fontFamily: FONT,
                fontSize: 10,
                borderRadius: 2,
                cursor: 'pointer',
              }}
            >
              SGL
            </button>
          </div>
          <button
            type="button"
            onClick={onLaunchFlares}
            disabled={!isPowered || !isArmed || flareLaunching || flareInventory <= 0}
            style={{
              minWidth: 44,
              height: 22,
              border: `1px solid ${!isPowered || !isArmed || flareLaunching || flareInventory <= 0 ? AMBER_DIM : AMBER}`,
              background: !isPowered || !isArmed || flareLaunching || flareInventory <= 0
                ? 'rgba(80,60,20,0.22)'
                : 'rgba(255,176,0,0.14)',
              color: !isPowered || !isArmed || flareLaunching || flareInventory <= 0 ? AMBER_DIM : AMBER_GLOW,
              fontFamily: FONT,
              fontSize: 11,
              borderRadius: 2,
              cursor: !isPowered || !isArmed || flareLaunching || flareInventory <= 0 ? 'not-allowed' : 'pointer',
            }}
          >
            FLR
          </button>
        </div>
        <div style={{
          marginTop: 6,
          border: `1px solid ${AMBER_DIM}55`,
          borderRadius: 2,
          padding: '6px 8px',
          background: 'rgba(8,8,8,0.9)',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 8,
          alignItems: 'center',
        }}>
          <span style={{ fontSize: 10, fontFamily: FONT, color: AMBER, letterSpacing: 1 }}>
            CHAFF SALVO · {chaffInventory}/{chaffInventoryMax}
          </span>
          <button
            type="button"
            onClick={onLaunchChaff}
            disabled={!isPowered || !isArmed || chaffInventory <= 0}
            style={{
              minWidth: 44,
              height: 22,
              border: `1px solid ${!isPowered || !isArmed || chaffInventory <= 0 ? AMBER_DIM : AMBER}`,
              background: !isPowered || !isArmed || chaffInventory <= 0
                ? 'rgba(80,60,20,0.22)'
                : 'rgba(255,176,0,0.14)',
              color: !isPowered || !isArmed || chaffInventory <= 0 ? AMBER_DIM : AMBER_GLOW,
              fontFamily: FONT,
              fontSize: 11,
              borderRadius: 2,
              cursor: !isPowered || !isArmed || chaffInventory <= 0 ? 'not-allowed' : 'pointer',
            }}
          >
            CHF
          </button>
        </div>
      </div>
      </div>
    </WsPanel>
  )
}

/* ── button style helper ────────────────────────────────────── */
const wsSlewButtonStyle: CSSProperties = {
  width: 'auto',
  padding: '7px 10px',
  border: `1px solid rgba(0, 255, 100, 0.35)`,
  borderRadius: 4,
  background: 'rgba(0, 24, 10, 0.72)',
  color: '#88ffaa',
  fontFamily: FONT,
  fontSize: 12,
  letterSpacing: '0.05em',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
}

/* ═══════════════════════════════════════════════════════════════
   WSStation – main weapons systems officer console
   ═══════════════════════════════════════════════════════════════ */
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
  const pointTrackTargetId = useIRSTStore((state) => state.pointTrackTargetId)
  const playerShipBoundingLength = useGameStore((state) => state.playerShipBoundingLength)
  const ewLockState = useGameStore((state) => state.ewLockState)
  const launchLockedCylinder = useGameStore((state) => state.launchLockedCylinder)
  const launchFlares = useGameStore((state) => state.launchFlares)
  const launchChaff = useGameStore((state) => state.launchChaff)
  const flareInventory = useGameStore((state) => state.flareInventory)
  const flareInventoryMax = useGameStore((state) => state.flareInventoryMax)
  const chaffInventory = useGameStore((state) => state.chaffInventory)
  const chaffInventoryMax = useGameStore((state) => state.chaffInventoryMax)
  const countermeasuresPowered = useGameStore((state) => state.countermeasuresPowered)
  const setCountermeasuresPowered = useGameStore((state) => state.setCountermeasuresPowered)
  const dewPowered = useGameStore((state) => state.dewPowered)
  const setDewPowered = useGameStore((state) => state.setDewPowered)
  const torpedoTubesPowered = useGameStore((state) => state.torpedoTubesPowered)
  const setTorpedoTubesPowered = useGameStore((state) => state.setTorpedoTubesPowered)
  const setDewCharging = useGameStore((state) => state.setDewCharging)
  const fireDew = useGameStore((state) => state.fireDew)
  const currentCelestialId = useGameStore((state) => state.currentCelestialId)
  const [isCountermeasuresArmed, setIsCountermeasuresArmed] = useState(true)
  const [isDewArmed, setIsDewArmed] = useState(false)
  const [isTorpedoTubesArmed, setIsTorpedoTubesArmed] = useState(false)
  const [dewFocusAlignment, setDewFocusAlignment] = useState(0)
  const [flareLaunchCount, setFlareLaunchCount] = useState(3)
  const [flareLaunchMode, setFlareLaunchMode] = useState<'PTN' | 'SGL'>('PTN')
  const [queuedSingleFlares, setQueuedSingleFlares] = useState(0)
  const flareTimeoutsRef = useRef<number[]>([])
  const hasRadarLock = Object.values(ewLockState).some((state) => state === 'hard' || state === 'soft')
  const hasIrstPointTrackTarget = pointTrackEnabled && Boolean(pointTrackTargetId)
  const shipsById = useGameStore((s) => s.shipsById)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const npcShips = useGameStore((s) => s.npcShips)
  const shipPosition = useGameStore((s) => s.ship.position)
  const shipCapacitor = useGameStore((s) => s.ship.capacitor)
  const shipCapacitorMax = useGameStore((s) => s.ship.capacitorMax)
  const dewTargetRangeM = (() => {
    if (!pointTrackTargetId) return 50_000
    const tgt = shipsById[pointTrackTargetId]
    if (!tgt) return 50_000
    const dx = tgt.position[0] - shipPosition[0]
    const dy = tgt.position[1] - shipPosition[1]
    const dz = tgt.position[2] - shipPosition[2]
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  })()
  const [torpedoTubes, setTorpedoTubes] = useState<TubeStatus[]>(
    Array.from({ length: TUBE_COUNT }, (_, i) => ({
      id: i + 1,
      selectedType: 'IR SEEKER' as TorpedoType,
      state: 'EMPTY' as TubeState,
      progressPct: 0,
      loadingStartedAtMs: null,
    }))
  )
  const [torpedoReserves, setTorpedoReserves] = useState<TorpedoReserves>({
    'IR SEEKER': TORPEDO_RESERVE_START_COUNT,
    ACTIVE: TORPEDO_RESERVE_START_COUNT,
    'SEMI ACTIVE': TORPEDO_RESERVE_START_COUNT,
  })

  const clearQueuedSingleFlares = () => {
    for (const timeoutId of flareTimeoutsRef.current) {
      window.clearTimeout(timeoutId)
    }
    flareTimeoutsRef.current = []
    setQueuedSingleFlares(0)
  }

  const fireFlaresFromWs = () => {
    if (!countermeasuresPowered || !isCountermeasuresArmed) return
    if (flareInventory <= 0) return
    const actualLaunchCount = Math.min(flareLaunchCount, flareInventory)
    if (actualLaunchCount <= 0) return

    if (flareLaunchMode === 'PTN') {
      launchFlares(playerShipBoundingLength, {
        count: actualLaunchCount,
        mode: 'pattern',
      })
      return
    }

    clearQueuedSingleFlares()
    setQueuedSingleFlares(actualLaunchCount)
    for (let i = 0; i < actualLaunchCount; i += 1) {
      const timeoutId = window.setTimeout(() => {
        launchFlares(playerShipBoundingLength, {
          count: 1,
          mode: 'single',
        })
        setQueuedSingleFlares((remaining) => Math.max(0, remaining - 1))
      }, i * FLARE_SINGLE_INTERVAL_MS)
      flareTimeoutsRef.current.push(timeoutId)
    }
  }

  const fireChaffFromWs = () => {
    if (!countermeasuresPowered || !isCountermeasuresArmed) return
    if (chaffInventory <= 0) return
    launchChaff(playerShipBoundingLength)
  }

  useEffect(() => {
    return () => {
      slewActiveRef.current = false
      slewLastTimeRef.current = null
      if (slewRafRef.current !== null) {
        cancelAnimationFrame(slewRafRef.current)
        slewRafRef.current = null
      }
      clearQueuedSingleFlares()
    }
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const nowMs = Date.now()
      setTorpedoTubes((previous) =>
        previous.map((tube) => {
          if (tube.state !== 'LOADING' || tube.loadingStartedAtMs === null) return tube
          const elapsedMs = nowMs - tube.loadingStartedAtMs
          const progressPct = Math.max(0, Math.min(100, (elapsedMs / TORPEDO_LOAD_DURATION_MS) * 100))
          if (elapsedMs >= TORPEDO_LOAD_DURATION_MS) {
            return {
              ...tube,
              state: 'READY',
              progressPct: 100,
              loadingStartedAtMs: null,
            }
          }
          return {
            ...tube,
            progressPct,
          }
        })
      )
    }, 100)
    return () => window.clearInterval(interval)
  }, [])

  const setTubeType = (tubeId: number, nextType: TorpedoType) => {
    setTorpedoTubes((previous) =>
      previous.map((tube) => (tube.id === tubeId ? { ...tube, selectedType: nextType } : tube))
    )
  }

  const beginLoadingTube = (tubeId: number) => {
    if (!torpedoTubesPowered || !isTorpedoTubesArmed) return
    const tube = torpedoTubes.find((entry) => entry.id === tubeId)
    if (!tube || tube.state !== 'EMPTY') return
    const selectedType = tube.selectedType
    const available = torpedoReserves[selectedType] ?? 0
    if (available <= 0) return

    setTorpedoReserves((previous) => ({
      ...previous,
      [selectedType]: Math.max(0, (previous[selectedType] ?? 0) - 1),
    }))
    setTorpedoTubes((previous) =>
      previous.map((entry) => (
        entry.id === tubeId
          ? {
              ...entry,
              state: 'LOADING',
              progressPct: 0,
              loadingStartedAtMs: Date.now(),
            }
          : entry
      ))
    )
  }

  const clearTubeAfterLaunch = (tubeId: number) => {
    setTorpedoTubes((previous) =>
      previous.map((tube) =>
        tube.id === tubeId
          ? {
              ...tube,
              state: 'EMPTY',
              progressPct: 0,
              loadingStartedAtMs: null,
            }
          : tube
      )
    )
  }

  useEffect(() => {
    const maxSelectable = Math.max(1, Math.min(WS_FLARE_COUNT_MAX, flareInventory || 1))
    if (flareLaunchCount > maxSelectable) {
      setFlareLaunchCount(maxSelectable)
    }
  }, [flareInventory, flareLaunchCount])

  useEffect(() => {
    if (!countermeasuresPowered && isCountermeasuresArmed) {
      setIsCountermeasuresArmed(false)
      clearQueuedSingleFlares()
    }
  }, [countermeasuresPowered, isCountermeasuresArmed])

  useEffect(() => {
    if (!torpedoTubesPowered && isTorpedoTubesArmed) {
      setIsTorpedoTubesArmed(false)
    }
  }, [torpedoTubesPowered, isTorpedoTubesArmed])

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
    <section style={{
      width: '100%',
      height: '100vh',
      maxHeight: '100vh',
      background: WS_BG_DARK,
      color: AMBER,
      fontFamily: FONT,
      fontSize: 11,
      display: 'flex',
      flexDirection: 'column',
      padding: 6,
      gap: 6,
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 12px',
        borderBottom: `1px solid ${AMBER_DIM}`,
        background: 'rgba(255,176,0,0.03)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, letterSpacing: 4, fontWeight: 'bold' }}>DARK FOREST</span>
          <span style={{ color: AMBER_DIM, fontSize: 9, letterSpacing: 2 }}>
            WS OFFICER CONSOLE v1.0
          </span>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 9, alignItems: 'center' }}>
          <span>VESSEL: <span style={{ color: AMBER_GLOW }}>RAVEN</span></span>
          <span>GRID: <span style={{ color: AMBER_GLOW }}>DF-1 PLANET I</span></span>
          <StatusDot
            color={irstCameraOn ? AMBER : AMBER_DIM}
            label={irstCameraOn ? 'IRST ONLINE' : 'IRST OFF'}
          />
        </div>
      </div>

      {/* ── Main layout ────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, flex: 1, minHeight: 0, alignItems: 'stretch' }}>

        {/* Left column – IRST display */}
        <WsPanel
          title="IRST Targeting"
          style={{ flex: '1 1 54%', minWidth: 0 }}
          headerRight={
            <StatusDot
              color={irstCameraOn ? AMBER : AMBER_DIM}
              label={irstCameraOn ? 'ACTIVE' : 'OFF'}
            />
          }
        >
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 10,
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              width: '100%',
              maxWidth: 690,
              padding: 8,
              border: `1px solid ${WS_GREEN_DIM}`,
              borderRadius: 2,
              background: `
                linear-gradient(${WS_GRID} 1px, transparent 1px),
                linear-gradient(90deg, ${WS_GRID} 1px, transparent 1px),
                rgba(0,24,10,0.42)
              `,
              backgroundSize: '48px 48px, 48px 48px, auto',
              boxShadow: 'inset 0 0 0 1px rgba(0,255,100,0.1)',
            }}>
              <IRSTView
                displayScale={1.95}
                showPowerToggle
                onPowerChange={(on) => {
                  if (!on) {
                    stopSlew()
                    setPointTrackEnabled(false)
                    setPointTrackTargetId(null)
                  }
                }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
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
          </div>
        </WsPanel>

        {/* Right column – weapons systems panels */}
        <div style={{ flex: '0 0 42%', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <TorpedoTubesPanel
            hasRadarLock={hasRadarLock}
            hasIrstPointTrackTarget={hasIrstPointTrackTarget}
            isPowered={torpedoTubesPowered}
            isArmed={isTorpedoTubesArmed}
            onTogglePower={() => {
              if (torpedoTubesPowered) {
                setIsTorpedoTubesArmed(false)
              }
              setTorpedoTubesPowered(!torpedoTubesPowered)
            }}
            onToggleArmed={() => {
              if (!torpedoTubesPowered) return
              setIsTorpedoTubesArmed((previous) => !previous)
            }}
            tubes={torpedoTubes}
            reserves={torpedoReserves}
            onSetTubeType={setTubeType}
            onBeginLoadingTube={beginLoadingTube}
            onLaunchTube={clearTubeAfterLaunch}
            onLaunchTubeTorpedo={(tubeId) => {
              if (!torpedoTubesPowered || !isTorpedoTubesArmed) return false
              const tube = torpedoTubes.find((t) => t.id === tubeId)
              if (!tube || tube.state !== 'READY') return false
              if (tube.selectedType === 'IR SEEKER') {
                if (!pointTrackTargetId) return false
                launchLockedCylinder(playerShipBoundingLength, { targetLockId: pointTrackTargetId })
                return true
              }
              launchLockedCylinder(playerShipBoundingLength)
              return true
            }}
          />
          <TorpedoReservesPanel reserves={torpedoReserves} />
          <LaserSystemsPanel
            isPowered={dewPowered}
            isArmed={isDewArmed}
            hasTarget={hasIrstPointTrackTarget}
            targetRangeM={dewTargetRangeM}
            onFocusAlignmentChange={setDewFocusAlignment}
            capacitor={shipCapacitor}
            capacitorMax={shipCapacitorMax}
            onChargingChange={setDewCharging}
            onTogglePower={() => setDewPowered(!dewPowered)}
            onToggleArmed={() => setIsDewArmed((a) => !a)}
            onFire={() => {
              if (!pointTrackTargetId) return
              const tgt = shipsById[pointTrackTargetId]
              if (!tgt) return
              const dx = tgt.position[0] - shipPosition[0]
              const dy = tgt.position[1] - shipPosition[1]
              const dz = tgt.position[2] - shipPosition[2]
              const rangeM = Math.sqrt(dx * dx + dy * dy + dz * dz)
              const baseDamage = getDewBaseDamageByRange(rangeM)
              const alignment = Math.max(0, Math.min(1, dewFocusAlignment))
              const appliedDamage = Math.round(baseDamage * alignment)
              const isNpcTarget = Boolean(npcShips[pointTrackTargetId])
              const isLocalTarget = pointTrackTargetId === localPlayerId
              const shouldSendMultiplayerDamage =
                multiplayerClient.isConnected()
                && !isNpcTarget
                && !isLocalTarget
              fireDew(
                [...shipPosition],
                [...tgt.position],
                currentCelestialId,
                pointTrackTargetId,
                shouldSendMultiplayerDamage ? 0 : appliedDamage,
              )
              if (shouldSendMultiplayerDamage && appliedDamage > 0) {
                multiplayerClient.sendShipDamage({
                  targetShipId: pointTrackTargetId,
                  damage: appliedDamage,
                  currentCelestialId,
                })
              }
            }}
          />
          <CountermeasuresPanel
            flareCount={flareLaunchCount}
            flareMode={flareLaunchMode}
            flareLaunching={queuedSingleFlares > 0}
            flareInventory={flareInventory}
            flareInventoryMax={flareInventoryMax}
            chaffInventory={chaffInventory}
            chaffInventoryMax={chaffInventoryMax}
            isPowered={countermeasuresPowered}
            isArmed={isCountermeasuresArmed}
            onFlareCountChange={(count) => setFlareLaunchCount(Math.max(1, Math.min(WS_FLARE_COUNT_MAX, count)))}
            onFlareModeChange={(mode) => {
              setFlareLaunchMode(mode)
              clearQueuedSingleFlares()
            }}
            onLaunchFlares={fireFlaresFromWs}
            onLaunchChaff={fireChaffFromWs}
            onTogglePower={() => {
              if (countermeasuresPowered) {
                setIsCountermeasuresArmed(false)
                clearQueuedSingleFlares()
              }
              setCountermeasuresPowered(!countermeasuresPowered)
            }}
            onToggleArmed={() => {
              if (!countermeasuresPowered) return
              setIsCountermeasuresArmed((previous) => !previous)
            }}
          />

          {/* Reserved container placeholder */}
          <WsPanel
            title="Reserved"
            style={{ flex: 1, minHeight: 80 }}
            headerRight={<span style={{ color: AMBER_DIM, fontSize: 8 }}>UNUSED</span>}
          >
            <div style={{
              flex: 1,
              padding: '6px 8px',
              fontSize: 8,
              fontFamily: FONT,
              color: `${AMBER_DIM}cc`,
              border: `1px dashed ${AMBER_DIM}66`,
              margin: 6,
              borderRadius: 2,
              background: 'rgba(8,8,8,0.9)',
            }}>
              RESERVED FOR FUTURE WS MODULE
            </div>
          </WsPanel>
        </div>
      </div>

      {/* ── Bottom status bar ──────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '3px 12px',
        borderTop: `1px solid ${AMBER_DIM}66`,
        fontSize: 8,
        color: AMBER_DIM,
        flexShrink: 0,
      }}>
        <span>TUBES: 0/{TUBE_COUNT} LOADED</span>
        <span>LASER: STBY</span>
        <span>CHAFF: {chaffInventory}</span>
        <span>FLARES: {flareInventory}</span>
        <span>IRST: {irstCameraOn ? 'ONLINE' : 'OFF'}</span>
        <span style={{ color: pointTrackEnabled ? AMBER : AMBER_DIM }}>
          {pointTrackEnabled ? 'TGT LOCKED' : 'NO TGT'}
        </span>
      </div>
    </section>
  )
}
