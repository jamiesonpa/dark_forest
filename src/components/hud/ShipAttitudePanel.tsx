import { useState, type PointerEvent } from 'react'
import { useGameStore } from '@/state/gameStore'

function normalizeBearingDeg(value: number) {
  return ((value % 360) + 360) % 360
}

function clampInclinationDeg(value: number) {
  return Math.max(-90, Math.min(90, value))
}

function normalizeSigned180(value: number) {
  const wrapped = ((value % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}

export function ShipAttitudePanel() {
  const ship = useGameStore((s) => s.ship)
  const setShipState = useGameStore((s) => s.setShipState)
  const navMode = useGameStore((s) => s.navAttitudeMode)
  const setNavAttitudeMode = useGameStore((s) => s.setNavAttitudeMode)
  const [hoverBearing, setHoverBearing] = useState<number | null>(null)
  const [hoverInclination, setHoverInclination] = useState<number | null>(null)
  const dacMode = navMode === 'DAC'

  const targetBearing = normalizeBearingDeg(ship.bearing)
  const actualBearing = normalizeBearingDeg(ship.actualHeading)
  const targetInclination = dacMode
    ? normalizeSigned180(ship.inclination)
    : clampInclinationDeg(ship.inclination)
  const actualInclination = dacMode
    ? normalizeSigned180(ship.actualInclination)
    : clampInclinationDeg(ship.actualInclination)

  const bearingEndpoint = (bearingDeg: number, radiusValue: number) => {
    const angleRad = ((bearingDeg - 90) * Math.PI) / 180
    return {
      x: 50 + radiusValue * Math.cos(angleRad),
      y: 50 + radiusValue * Math.sin(angleRad),
    }
  }

  const targetBearingPoint = bearingEndpoint(targetBearing, 29)
  const actualBearingPoint = bearingEndpoint(actualBearing, 23)
  const inclinationMin = dacMode ? -180 : -90
  const inclinationMax = dacMode ? 180 : 90
  const inclinationSpan = inclinationMax - inclinationMin
  const inclinationToY = (inclinationDeg: number) =>
    14 + ((inclinationMax - inclinationDeg) / inclinationSpan) * 72
  const targetInclinationY = inclinationToY(targetInclination)
  const actualInclinationY = inclinationToY(actualInclination)
  const formatBearing = (value: number) => Math.round(value).toString().padStart(3, '0')
  const formatInclination = (value: number) => {
    const rounded = Math.round(value)
    return `${rounded >= 0 ? '+' : ''}${rounded}`
  }
  const hoverBearingPoint = hoverBearing === null ? null : bearingEndpoint(hoverBearing, 35)
  const hoverInclinationY = hoverInclination === null ? null : inclinationToY(hoverInclination)
  const navSolutionOffline = !ship.dampenersActive || navMode === 'DAC'
  const canEditNavSolution = ship.dampenersActive && navMode === 'AA'

  const getLocalSvgPoint = (event: PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const vb = svg.viewBox.baseVal
    const viewBoxX = vb?.x ?? 0
    const viewBoxY = vb?.y ?? 0
    const viewBoxWidth = vb?.width || rect.width
    const viewBoxHeight = vb?.height || rect.height
    const normalizedX = (event.clientX - rect.left) / rect.width
    const normalizedY = (event.clientY - rect.top) / rect.height
    return {
      x: viewBoxX + normalizedX * viewBoxWidth,
      y: viewBoxY + normalizedY * viewBoxHeight,
    }
  }

  const handleBearingPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!canEditNavSolution) return
    const localPoint = getLocalSvgPoint(event)
    if (!localPoint) return
    const dx = localPoint.x - 50
    const dy = localPoint.y - 50
    const radius = Math.hypot(dx, dy)
    if (radius < 3) return
    const nextBearing = normalizeBearingDeg((Math.atan2(dy, dx) * 180) / Math.PI + 90)
    setHoverBearing(nextBearing)
  }

  const handleInclinationPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!canEditNavSolution) return
    const localPoint = getLocalSvgPoint(event)
    if (!localPoint) return
    const nextInclination = clampInclinationDeg(90 - ((localPoint.y - 14) / 72) * 180)
    setHoverInclination(nextInclination)
  }

  const handleBearingPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!canEditNavSolution) return
    const localPoint = getLocalSvgPoint(event)
    if (!localPoint) return
    const dx = localPoint.x - 50
    const dy = localPoint.y - 50
    const radius = Math.hypot(dx, dy)
    if (radius < 3) return
    const nextBearing = normalizeBearingDeg((Math.atan2(dy, dx) * 180) / Math.PI + 90)
    setShipState({ bearing: nextBearing })
  }

  const handleInclinationPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!canEditNavSolution) return
    const localPoint = getLocalSvgPoint(event)
    if (!localPoint) return
    const nextInclination = clampInclinationDeg(90 - ((localPoint.y - 14) / 72) * 180)
    setShipState({ inclination: nextInclination })
  }

  return (
    <div className="attitude-panel-stack">
      <div className="attitude-nav-mode-wrap">
        <div className="attitude-nav-mode-toggle" role="group" aria-label="Navigation mode">
          <button
            type="button"
            className={`attitude-nav-mode-option ${navMode === 'AA' ? 'active' : ''}`.trim()}
            onClick={() => setNavAttitudeMode('AA')}
            aria-pressed={navMode === 'AA'}
          >
            AA
          </button>
          <button
            type="button"
            className={`attitude-nav-mode-option ${navMode === 'DAC' ? 'active' : ''}`.trim()}
            onClick={() => setNavAttitudeMode('DAC')}
            aria-pressed={navMode === 'DAC'}
          >
            DAC
          </button>
        </div>
        <div className="attitude-nav-mode-label">
          {navMode === 'AA' ? 'ATTITUDE ASSIST' : 'DIRECT ATTITUDE CONTROL'}
        </div>
      </div>
      <div
        className={`attitude-panel ${navSolutionOffline ? 'attitude-panel-offline' : ''}`.trim()}
        aria-label="Bearing and inclination readout"
      >
        <div className="attitude-header">NAV SOLUTION</div>
        <div className="attitude-content">
          {navSolutionOffline && (
            <div className="attitude-offline-overlay" aria-hidden="true">
              <span className="attitude-offline-text">
                {!ship.dampenersActive ? 'INERTIAL DAMPENERS OFFLINE' : 'DIRECT ATTITUDE CONTROL ACTIVE'}
              </span>
            </div>
          )}
          <div className="attitude-viz-row">
            <div className="attitude-viz-col">
              <div className="attitude-viz-title">BEARING</div>
              <svg
                viewBox="0 -6 100 106"
                className="attitude-bearing-scope"
                role="img"
                onPointerMove={handleBearingPointerMove}
                onPointerDown={handleBearingPointerDown}
                onPointerLeave={() => setHoverBearing(null)}
              >
                <circle cx="50" cy="50" r="40" className="attitude-scope-ring attitude-scope-ring-outer" />
                <circle cx="50" cy="50" r="28" className="attitude-scope-ring attitude-scope-ring-inner" />
                <line x1="50" y1="8" x2="50" y2="92" className="attitude-scope-axis" />
                <line x1="8" y1="50" x2="92" y2="50" className="attitude-scope-axis" />
                {hoverBearingPoint && (
                  <line
                    x1="50"
                    y1="50"
                    x2={hoverBearingPoint.x}
                    y2={hoverBearingPoint.y}
                    className="attitude-vector attitude-vector-hover"
                  />
                )}
                <line
                  x1="50"
                  y1="50"
                  x2={targetBearingPoint.x}
                  y2={targetBearingPoint.y}
                  className="attitude-vector attitude-vector-tgt"
                />
                <line
                  x1="50"
                  y1="50"
                  x2={actualBearingPoint.x}
                  y2={actualBearingPoint.y}
                  className="attitude-vector attitude-vector-act"
                />
                <circle cx={targetBearingPoint.x} cy={targetBearingPoint.y} r="2.8" className="attitude-dot attitude-dot-tgt" />
                <circle cx={actualBearingPoint.x} cy={actualBearingPoint.y} r="2.8" className="attitude-dot attitude-dot-act" />
                <text x="50" y="3" textAnchor="middle" className="attitude-bearing-label">0</text>
                <text x="97" y="53" textAnchor="middle" className="attitude-bearing-label">90</text>
                <text x="50" y="99" textAnchor="middle" className="attitude-bearing-label">180</text>
                <text x="3" y="53" textAnchor="middle" className="attitude-bearing-label">270</text>
                {hoverBearing !== null && (
                  <text x="50" y="108" textAnchor="middle" className="attitude-hover-label">
                    HOVER {formatBearing(hoverBearing)}
                  </text>
                )}
              </svg>
              <div className="attitude-viz-value-row">
                <span className="attitude-mode-left">{formatBearing(actualBearing)}</span>
                <span className="attitude-mode-separator">{'\u00A0\u00A0/\u00A0\u00A0'}</span>
                <span className="attitude-header-right">{formatBearing(targetBearing)}</span>
              </div>
              <div className={`attitude-hover-row ${hoverBearing === null ? 'is-hidden' : ''}`}>
                {`(${formatBearing(hoverBearing ?? 0)})`}
              </div>
            </div>
            <div className="attitude-viz-col">
              <div className="attitude-viz-title">INCLINATION</div>
              <svg
                viewBox="0 0 56 100"
                className="attitude-inclination-meter"
                role="img"
                onPointerMove={handleInclinationPointerMove}
                onPointerDown={handleInclinationPointerDown}
                onPointerLeave={() => setHoverInclination(null)}
              >
                <rect x="19" y="14" width="24" height="72" className="attitude-meter-track" />
                <line x1="19" y1="50" x2="43" y2="50" className="attitude-meter-midline" />
                {hoverInclinationY !== null && (
                  <line
                    x1="11"
                    y1={hoverInclinationY}
                    x2="51"
                    y2={hoverInclinationY}
                    className="attitude-meter-marker attitude-meter-marker-hover"
                  />
                )}
                <line x1="11" y1={targetInclinationY} x2="51" y2={targetInclinationY} className="attitude-meter-marker attitude-meter-marker-tgt" />
                <line x1="11" y1={actualInclinationY} x2="51" y2={actualInclinationY} className="attitude-meter-marker attitude-meter-marker-act" />
                <text x={dacMode ? 0 : 2} y="18" className="attitude-meter-label">{dacMode ? '+180' : '+90'}</text>
                <text x="2" y="54" className="attitude-meter-label">0</text>
                <text x={dacMode ? 0 : 2} y="90" className="attitude-meter-label">{dacMode ? '-180' : '-90'}</text>
              </svg>
              <div className="attitude-viz-value-row">
                <span className="attitude-mode-left">{formatInclination(actualInclination)}</span>
                <span className="attitude-mode-separator">{'\u00A0\u00A0/\u00A0\u00A0'}</span>
                <span className="attitude-header-right">{formatInclination(targetInclination)}</span>
              </div>
              <div className={`attitude-hover-row ${hoverInclination === null ? 'is-hidden' : ''}`}>
                {`(${formatInclination(hoverInclination ?? 0)})`}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
