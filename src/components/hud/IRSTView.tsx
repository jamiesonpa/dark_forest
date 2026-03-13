import { useRef, useEffect, useState } from 'react'
import { useIRSTStore } from '@/state/irstStore'
import { useGameStore } from '@/state/gameStore'

function pad3(n: number): string {
  return String(Math.round(n)).padStart(3, '0')
}

function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360
}

function clampInclination(deg: number): number {
  return Math.max(-85, Math.min(85, deg))
}

function clampZoom(zoom: number): number {
  return Math.max(1, Math.min(10, zoom))
}

const IRST_DRAG_DEG_PER_PX = 0.2
const IRST_ZOOM_DELTA_PER_WHEEL = 0.0025

export function IRSTView() {
  const displayRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const canvas = useIRSTStore((s) => s.canvas)
  const irstBearing = useGameStore((s) => s.ship.irstBearing)
  const irstInclination = useGameStore((s) => s.ship.irstInclination)
  const irstMode = useGameStore((s) => s.ship.irstMode)
  const laserRange = useGameStore((s) => s.ship.laserRange)
  const actualSpeed = useGameStore((s) => s.ship.actualSpeed)
  const irstZoom = useGameStore((s) => s.ship.irstZoom)
  const setShipState = useGameStore((s) => s.setShipState)

  useEffect(() => {
    if (!canvas || !displayRef.current) return
    const display = displayRef.current
    const ctx = display.getContext('2d')
    if (!ctx) return

    let raf = 0
    const draw = () => {
      ctx.drawImage(canvas, 0, 0, display.width, display.height)
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [canvas])

  const zoom = irstZoom.toFixed(1)

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
    setIsDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.preventDefault()

    const dx = e.clientX - drag.lastX
    const dy = e.clientY - drag.lastY
    if (dx === 0 && dy === 0) return

    drag.lastX = e.clientX
    drag.lastY = e.clientY

    const ship = useGameStore.getState().ship
    const nextBearing = normalizeBearing(ship.irstBearing - dx * IRST_DRAG_DEG_PER_PX)
    const nextInclination = clampInclination(ship.irstInclination - dy * IRST_DRAG_DEG_PER_PX)
    useGameStore.getState().setShipState({
      irstBearing: nextBearing,
      irstInclination: nextInclination,
    })
  }

  const endDrag = (pointerId: number) => {
    if (!dragRef.current || dragRef.current.pointerId !== pointerId) return
    dragRef.current = null
    setIsDragging(false)
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const ship = useGameStore.getState().ship
    const deltaZoom = -e.deltaY * IRST_ZOOM_DELTA_PER_WHEEL
    const nextZoom = clampZoom(ship.irstZoom + deltaZoom)
    useGameStore.getState().setShipState({ irstZoom: nextZoom })
  }

  return (
    <div className="irst-panel-wrap">
      <div className="irst-left-column">
        <div className="irst-panel">
          <div className="irst-header">
            <span className="irst-label">IRST</span>
            <span className="irst-status">TRK</span>
          </div>
          <div
            className={`irst-viewport${isDragging ? ' is-dragging' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(e) => endDrag(e.pointerId)}
            onPointerCancel={(e) => endDrag(e.pointerId)}
            onLostPointerCapture={(e) => endDrag(e.pointerId)}
            onWheel={handleWheel}
          >
            <canvas
              ref={displayRef}
              width={320}
              height={240}
              className="irst-canvas"
            />
            <div className="irst-overlay">
              <div className="irst-bracket">
                <div className="bracket-corner tl" />
                <div className="bracket-corner tr" />
                <div className="bracket-corner bl" />
                <div className="bracket-corner br" />
              </div>

              <div className="irst-hud-heading">
                <span className="irst-hdg-value">{pad3(irstBearing)}</span>
              </div>

              <div className="irst-hud-bl">
                <span className="irst-mode">{irstMode}</span>
              </div>

              <div className="irst-hud-br">
                <span className="irst-range-label">LSR</span>
                <span className="irst-range-value">
                  {laserRange >= 0 ? `${Math.round(laserRange)}M` : '- - -'}
                </span>
              </div>

              <div className="irst-hud-tl">
                <span className="irst-data">{zoom}X</span>
              </div>

              <div className="irst-hud-tr">
                <span className="irst-data">EL {irstInclination >= 0 ? '+' : ''}{pad3(Math.abs(irstInclination))}</span>
              </div>

              <div className="irst-hud-bc">
                <span className="irst-data">GS {Math.round(actualSpeed)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="irst-zoom-slider">
        <span className="irst-zoom-label">10x</span>
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={irstZoom}
          onChange={(e) => setShipState({ irstZoom: Number(e.target.value) })}
          className="irst-zoom-input"
        />
        <span className="irst-zoom-label">1x</span>
      </div>
    </div>
  )
}
