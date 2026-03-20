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
  return Math.max(1, Math.min(20, zoom))
}

const IRST_BASE_DRAG_DEG_PER_PX = 0.2
const IRST_DISPLAY_WIDTH = 320
const IRST_DISPLAY_HEIGHT = 240
const IRST_ZOOM_LEVELS = Array.from({ length: 20 }, (_, i) => i + 1)

function dragDegPerPixelForZoom(zoom: number): number {
  const safeZoom = clampZoom(zoom)
  return IRST_BASE_DRAG_DEG_PER_PX / safeZoom
}

function closestZoomLevel(zoom: number): number {
  let closest = IRST_ZOOM_LEVELS[0] ?? 1
  let bestDistance = Math.abs(zoom - closest)
  for (const level of IRST_ZOOM_LEVELS) {
    const distance = Math.abs(zoom - level)
    if (distance < bestDistance) {
      closest = level
      bestDistance = distance
    }
  }
  return closest
}

type IRSTViewProps = {
  displayScale?: number
  showPowerToggle?: boolean
  onPowerChange?: (on: boolean) => void
}

export function IRSTView({ displayScale = 1, showPowerToggle = false, onPowerChange }: IRSTViewProps) {
  const displayRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const canvas = useIRSTStore((s) => s.canvas)
  const irstMode = useGameStore((s) => s.ship.irstMode)
  const irstSpectrumMode = useGameStore((s) => s.ship.irstSpectrumMode)
  const laserRange = useGameStore((s) => s.ship.laserRange)
  const actualSpeed = useGameStore((s) => s.ship.actualSpeed)
  const irstZoom = useGameStore((s) => s.ship.irstZoom)
  const irstCameraOn = useGameStore((s) => s.irstCameraOn)
  const setShipState = useGameStore((s) => s.setShipState)
  const setIrstCameraOn = useGameStore((s) => s.setIrstCameraOn)
  const displayWidth = Math.round(IRST_DISPLAY_WIDTH * displayScale)
  const displayHeight = Math.round(IRST_DISPLAY_HEIGHT * displayScale)
  const hdgRef = useRef<HTMLSpanElement>(null)
  const elRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!canvas || !displayRef.current) return
    const display = displayRef.current
    const ctx = display.getContext('2d')
    if (!ctx) return
    ctx.drawImage(canvas, 0, 0, display.width, display.height)
    const id = setInterval(() => {
      ctx.drawImage(canvas, 0, 0, display.width, display.height)
    }, 50)
    return () => clearInterval(id)
  }, [canvas])

  useEffect(() => {
    let prevB = -1
    let prevI = -999
    const sync = () => {
      const { irstBearing, irstInclination } = useGameStore.getState().ship
      if (irstBearing !== prevB && hdgRef.current) {
        prevB = irstBearing
        hdgRef.current.textContent = pad3(irstBearing)
      }
      if (irstInclination !== prevI && elRef.current) {
        prevI = irstInclination
        const sign = irstInclination >= 0 ? '+' : ''
        elRef.current.textContent = `EL ${sign}${pad3(Math.abs(irstInclination))}`
      }
    }
    sync()
    return useGameStore.subscribe(sync)
  }, [])

  const zoom = irstZoom.toFixed(1)
  const modeLabel = irstSpectrumMode === 'VIS' ? 'VIS' : irstMode

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!irstCameraOn) return
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
    setIsDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!irstCameraOn) return
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.preventDefault()

    const dx = e.clientX - drag.lastX
    const dy = e.clientY - drag.lastY
    if (dx === 0 && dy === 0) return

    drag.lastX = e.clientX
    drag.lastY = e.clientY

    const ship = useGameStore.getState().ship
    const dragDegPerPx = dragDegPerPixelForZoom(ship.irstZoom)
    const nextBearing = normalizeBearing(ship.irstBearing - dx * dragDegPerPx)
    const nextInclination = clampInclination(ship.irstInclination - dy * dragDegPerPx)
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
    if (!irstCameraOn) return
    e.preventDefault()
    const ship = useGameStore.getState().ship
    const currentZoom = closestZoomLevel(ship.irstZoom)
    const currentIndex = IRST_ZOOM_LEVELS.indexOf(currentZoom)
    const wheelDirection = Math.sign(e.deltaY)
    const directionStep = wheelDirection > 0 ? -1 : 1
    const nextIndex = Math.max(0, Math.min(IRST_ZOOM_LEVELS.length - 1, currentIndex + directionStep))
    const nextZoom = clampZoom(IRST_ZOOM_LEVELS[nextIndex] ?? currentZoom)
    useGameStore.getState().setShipState({ irstZoom: nextZoom })
  }

  return (
    <div className="irst-panel-wrap">
      <div className="irst-left-column">
        <div className="irst-panel">
          <div className="irst-header">
            <span className="irst-label">IRST</span>
            {showPowerToggle ? (
              <div className="irst-header-controls">
                <button
                  type="button"
                  className={`irst-power-btn${irstCameraOn ? ' on' : ''}`}
                  onClick={() => {
                    const nextOn = !irstCameraOn
                    setIrstCameraOn(nextOn)
                    onPowerChange?.(nextOn)
                  }}
                  aria-label="Toggle IRST camera power"
                >
                  {irstCameraOn ? 'ON' : 'OFF'}
                </button>
              </div>
            ) : (
              <span className="irst-status">{irstCameraOn ? 'TRK' : 'OFF'}</span>
            )}
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
              width={displayWidth}
              height={displayHeight}
              className="irst-canvas"
              style={{
                width: `${displayWidth}px`,
                height: `${displayHeight}px`,
              }}
            />
            <div className="irst-overlay">
              <div className="irst-bracket">
                <div className="bracket-corner tl" />
                <div className="bracket-corner tr" />
                <div className="bracket-corner bl" />
                <div className="bracket-corner br" />
              </div>

              <div className="irst-hud-heading">
                <span className="irst-hdg-value" ref={hdgRef} />
              </div>

              <div className="irst-hud-bl">
                <span className="irst-mode">{modeLabel}</span>
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
                <span className="irst-data" ref={elRef} />
              </div>

              <div className="irst-hud-bc">
                <span className="irst-data">GS {Math.round(actualSpeed)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="irst-zoom-slider">
        <span className="irst-zoom-label">20x</span>
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={irstZoom}
          disabled={!irstCameraOn}
          onChange={(e) => setShipState({ irstZoom: closestZoomLevel(Number(e.target.value)) })}
          className="irst-zoom-input"
        />
        <span className="irst-zoom-label">1x</span>
      </div>
    </div>
  )
}
