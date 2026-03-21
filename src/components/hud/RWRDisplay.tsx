import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '@/state/gameStore'
import { getIncomingEnemyTorpedoRwrMarkers } from '@/systems/ew/rwrIncomingTorpedoes'
import type { RWRContact } from '@/types/game'

const PANEL_PX = 240

const COL = {
  bg: 'rgba(0, 12, 8, 0.92)',
  ringStrong: 'rgba(0, 255, 100, 0.18)',
  ringMid: 'rgba(0, 255, 100, 0.1)',
  ringDash: 'rgba(0, 255, 100, 0.08)',
  cross: 'rgba(0, 255, 100, 0.12)',
  center: 'rgba(0, 255, 100, 0.5)',
  label: 'rgba(0, 255, 100, 0.45)',
  hdg: '#44ff66',
  crit: '#ff4444',
  high: '#ffaa00',
  low: 'rgba(0, 255, 100, 0.75)',
} as const

/** Scales legacy 0.42 / 0.12 ring fractions (1 = original size). */
const RWR_RING_SCALE = 0.9
const RWR_OUTER_R_FRAC = 0.42 * RWR_RING_SCALE
const RWR_INNER_R_FRAC = 0.12 * RWR_RING_SCALE

function drawRwrScope(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  time: number,
  rwrContacts: RWRContact[],
  torpedoMarkers: readonly { bearingDeg: number }[],
  shipHeading: number,
  powered: boolean,
) {
  const cx = w / 2
  const cy = h / 2
  const m = Math.min(w, h)
  const outerR = m * RWR_OUTER_R_FRAC
  const innerR = m * RWR_INNER_R_FRAC
  /** Minimum gap between cardinal glyphs and the canvas border. */
  const edgePad = 8

  const labelSize = Math.max(10, Math.round(m * 0.058))
  const capApprox = labelSize * 0.72
  const y12 = Math.max(edgePad + capApprox, cy - outerR - 4)
  const y6 = Math.min(h - edgePad, Math.max(cy + outerR + capApprox + 2, cy + outerR + 6))
  const ySide = cy + Math.round(labelSize * 0.36)

  if (!powered) {
    ctx.fillStyle = 'rgba(5, 8, 6, 0.96)'
    ctx.fillRect(0, 0, w, h)
    const ringMuted = 'rgba(88, 96, 90, 0.2)'
    const ringMidMuted = 'rgba(88, 96, 90, 0.1)'
    ;[outerR, (outerR + innerR) / 2, innerR].forEach((r, i) => {
      ctx.strokeStyle = i === 1 ? ringMidMuted : ringMuted
      ctx.lineWidth = 1
      ctx.setLineDash(i === 1 ? [3, 3] : [])
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    })
    ctx.setLineDash([])
    ctx.strokeStyle = 'rgba(70, 78, 74, 0.18)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(cx, cy - outerR - 4)
    ctx.lineTo(cx, cy + outerR + 4)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx - outerR - 4, cy)
    ctx.lineTo(cx + outerR + 4, cy)
    ctx.stroke()
    ctx.fillStyle = 'rgba(110, 118, 112, 0.35)'
    ctx.beginPath()
    ctx.arc(cx, cy, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = `${labelSize}px Consolas, Monaco, monospace`
    ctx.fillStyle = 'rgba(120, 128, 122, 0.4)'
    ctx.textAlign = 'center'
    ctx.fillText('12', cx, y12)
    ctx.fillText('6', cx, y6)
    ctx.textAlign = 'end'
    ctx.fillText('3', w - edgePad, ySide)
    ctx.textAlign = 'start'
    ctx.fillText('9', edgePad, ySide)
    const offMsg = Math.max(12, Math.round(m * 0.065))
    ctx.font = `bold ${offMsg}px Consolas, Monaco, monospace`
    ctx.fillStyle = 'rgba(130, 138, 132, 0.45)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('RWR OFF', cx, cy)
    ctx.textBaseline = 'alphabetic'
    const hudSize = Math.max(11, Math.round(m * 0.058))
    ctx.font = `${hudSize}px Consolas, Monaco, monospace`
    ctx.fillStyle = 'rgba(120, 128, 122, 0.42)'
    ctx.textAlign = 'left'
    ctx.fillText('HDG ---', 6, 16)
    ctx.textAlign = 'right'
    ctx.fillText('OFF', w - 6, 16)
    ctx.textAlign = 'start'
    return
  }

  const threatCount = rwrContacts.length + torpedoMarkers.length

  ctx.fillStyle = COL.bg
  ctx.fillRect(0, 0, w, h)

  ;[outerR, (outerR + innerR) / 2, innerR].forEach((r, i) => {
    ctx.strokeStyle = i === 1 ? COL.ringDash : COL.ringStrong
    ctx.lineWidth = 1
    ctx.setLineDash(i === 1 ? [3, 3] : [])
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  })
  ctx.setLineDash([])

  ctx.strokeStyle = COL.cross
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(cx, cy - outerR - 4)
  ctx.lineTo(cx, cy + outerR + 4)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx - outerR - 4, cy)
  ctx.lineTo(cx + outerR + 4, cy)
  ctx.stroke()

  ctx.fillStyle = COL.center
  ctx.beginPath()
  ctx.arc(cx, cy, 3, 0, Math.PI * 2)
  ctx.fill()

  ctx.font = `${labelSize}px Consolas, Monaco, monospace`
  ctx.fillStyle = COL.label
  ctx.textAlign = 'center'
  ctx.fillText('12', cx, y12)
  ctx.fillText('6', cx, y6)
  ctx.textAlign = 'end'
  ctx.fillText('3', w - edgePad, ySide)
  ctx.textAlign = 'start'
  ctx.fillText('9', edgePad, ySide)
  ctx.textAlign = 'start'

  rwrContacts.forEach((c) => {
    const relBearing = ((c.bearing - shipHeading + 360) % 360)
    const rad = (relBearing - 90) * (Math.PI / 180)
    const str = Math.max(1, Math.min(10, c.signalStrength))
    const dist = outerR - ((str - 1) / 9) * (outerR - innerR)
    const px = cx + Math.cos(rad) * dist
    const py = cy + Math.sin(rad) * dist

    const isCrit = c.priority === 'critical'
    const isHigh = c.priority === 'high'
    const symColor = isCrit ? COL.crit : isHigh ? COL.high : COL.low

    if (c.sttLock) {
      ctx.strokeStyle = symColor
      ctx.lineWidth = 1.5
      if (c.symbol === 'M') {
        const r2 = 14
        ctx.beginPath()
        ctx.moveTo(px, py - r2)
        ctx.lineTo(px + r2, py)
        ctx.lineTo(px, py + r2)
        ctx.lineTo(px - r2, py)
        ctx.closePath()
        ctx.stroke()
      } else {
        const flash = Math.sin(time * 6) > 0
        if (flash) ctx.strokeRect(px - 12, py - 12, 24, 24)
      }
    }

    const symSize = Math.max(12, Math.round(Math.min(w, h) * 0.067))
    ctx.font = `bold ${symSize}px Consolas, Monaco, monospace`
    ctx.fillStyle = symColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(c.symbol, px, py)
    ctx.textAlign = 'start'
    ctx.textBaseline = 'alphabetic'
  })

  torpedoMarkers.forEach((t) => {
    const relBearing = ((t.bearingDeg - shipHeading + 360) % 360)
    const rad = (relBearing - 90) * (Math.PI / 180)
    const str = 9
    const dist = outerR - ((str - 1) / 9) * (outerR - innerR)
    const px = cx + Math.cos(rad) * dist
    const py = cy + Math.sin(rad) * dist
    const symColor = COL.crit
    ctx.strokeStyle = symColor
    ctx.lineWidth = 1.5
    const flash = Math.sin(time * 10) > 0
    if (flash) ctx.strokeRect(px - 12, py - 12, 24, 24)
    const symSize = Math.max(12, Math.round(Math.min(w, h) * 0.067))
    ctx.font = `bold ${symSize}px Consolas, Monaco, monospace`
    ctx.fillStyle = symColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('T', px, py)
    ctx.textAlign = 'start'
    ctx.textBaseline = 'alphabetic'
  })

  const hudSize = Math.max(11, Math.round(Math.min(w, h) * 0.058))
  ctx.font = `${hudSize}px Consolas, Monaco, monospace`
  ctx.fillStyle = COL.hdg
  ctx.textAlign = 'left'
  ctx.fillText(`HDG ${String(Math.round(shipHeading)).padStart(3, '0')}`, 6, 16)

  ctx.textAlign = 'right'
  ctx.fillStyle = threatCount > 0 ? COL.hdg : COL.label
  ctx.fillText(`${threatCount} THR`, w - 6, 16)
  ctx.textAlign = 'start'
}

export type RWRDisplayLayout = 'panel' | 'fill'

export type RWRDisplayProps = {
  /** `panel`: framed HUD widget (pilot). `fill`: scope only, grows with parent (EW station). */
  layout?: RWRDisplayLayout
  className?: string
}

export function RWRDisplay({ layout = 'panel', className = '' }: RWRDisplayProps) {
  const rwrContacts = useGameStore((s) => s.rwrContacts)
  const launchedCylinders = useGameStore((s) => s.launchedCylinders)
  const remoteLaunchedCylinders = useGameStore((s) => s.remoteLaunchedCylinders)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const shipsById = useGameStore((s) => s.shipsById)
  const ship = useGameStore((s) => s.ship)
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const shipHeading = useGameStore((s) => s.ship.actualHeading)
  const ewRwrPowered = useGameStore((s) => s.ewRwrPowered)
  const ewRwrVolume = useGameStore((s) => s.ewRwrVolume)
  const setEwRwrVolume = useGameStore((s) => s.setEwRwrVolume)

  const torpedoRwrMarkers = useMemo(
    () =>
      getIncomingEnemyTorpedoRwrMarkers({
        launchedCylinders,
        remoteLaunchedCylinders,
        localPlayerId,
        shipsById,
        ship,
        currentCelestialId,
      }),
    [
      launchedCylinders,
      remoteLaunchedCylinders,
      localPlayerId,
      shipsById,
      ship,
      currentCelestialId,
    ],
  )
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fillOuterRef = useRef<HTMLDivElement>(null)
  const [time, setTime] = useState(0)
  /** Fill layout: pixel edge of the square scope (min of parent width and height). */
  const [fillSquareSide, setFillSquareSide] = useState(PANEL_PX)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setTime((t) => t + 0.016)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useLayoutEffect(() => {
    if (layout !== 'fill') return
    const el = fillOuterRef.current
    if (!el) return
    const measure = () => {
      const w = Math.floor(el.clientWidth)
      const h = Math.floor(el.clientHeight)
      setFillSquareSide(Math.max(1, Math.min(w, h)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [layout])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (layout === 'panel') {
      canvas.width = PANEL_PX
      canvas.height = PANEL_PX
      drawRwrScope(
        ctx,
        PANEL_PX,
        PANEL_PX,
        time,
        rwrContacts,
        ewRwrPowered ? torpedoRwrMarkers : [],
        shipHeading,
        ewRwrPowered,
      )
      return
    }

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const side = fillSquareSide
    const buf = Math.max(1, Math.floor(side * dpr))
    if (canvas.width !== buf || canvas.height !== buf) {
      canvas.width = buf
      canvas.height = buf
    }
    canvas.style.width = `${side}px`
    canvas.style.height = `${side}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawRwrScope(
      ctx,
      side,
      side,
      time,
      rwrContacts,
      ewRwrPowered ? torpedoRwrMarkers : [],
      shipHeading,
      ewRwrPowered,
    )
  }, [layout, time, rwrContacts, torpedoRwrMarkers, shipHeading, fillSquareSide, ewRwrPowered])

  const threatTotal = rwrContacts.length + (ewRwrPowered ? torpedoRwrMarkers.length : 0)
  const statusText = !ewRwrPowered
    ? 'OFF'
    : threatTotal > 0
      ? `${threatTotal} THREAT${threatTotal === 1 ? '' : 'S'}`
      : 'NOMINAL'

  const scope =
    layout === 'fill' ? (
      <div ref={fillOuterRef} className="rwr-scope-fill-outer">
        <div
          className="rwr-scope-fill-square"
          style={{
            width: fillSquareSide,
            height: fillSquareSide,
            flexShrink: 0,
          }}
        >
          <canvas ref={canvasRef} className="rwr-scope" aria-label="Radar warning receiver" />
        </div>
      </div>
    ) : (
      <div>
        <canvas
          ref={canvasRef}
          className="rwr-scope"
          width={PANEL_PX}
          height={PANEL_PX}
          style={{ display: 'block', width: PANEL_PX, height: PANEL_PX }}
          aria-label="Radar warning receiver"
        />
      </div>
    )

  if (layout === 'panel') {
    return (
      <div className={`rwr-panel ${className}`.trim()}>
        <div className="rwr-header">
          <span className="rwr-title">RWR</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={ewRwrVolume}
            onChange={(e) => setEwRwrVolume(Number(e.target.value))}
            className="rwr-vol-slider"
            aria-label="RWR audio volume"
            title={`RWR audio ${Math.round(ewRwrVolume * 100)}%`}
            style={{ opacity: ewRwrPowered ? 0.85 : 0.4 }}
          />
          <span className="rwr-status">{statusText}</span>
        </div>
        {scope}
      </div>
    )
  }

  return <div className={className.trim()} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>{scope}</div>
}
