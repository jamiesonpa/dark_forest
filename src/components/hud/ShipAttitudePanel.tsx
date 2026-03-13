import { useGameStore } from '@/state/gameStore'

function normalizeBearingDeg(value: number) {
  return ((value % 360) + 360) % 360
}

function clampInclinationDeg(value: number) {
  return Math.max(-90, Math.min(90, value))
}

export function ShipAttitudePanel() {
  const ship = useGameStore((s) => s.ship)

  const targetBearing = normalizeBearingDeg(ship.bearing)
  const actualBearing = normalizeBearingDeg(ship.actualHeading)
  const targetInclination = clampInclinationDeg(ship.inclination)
  const actualInclination = clampInclinationDeg(ship.actualInclination)

  const bearingEndpoint = (bearingDeg: number, radiusValue: number) => {
    const angleRad = ((bearingDeg - 90) * Math.PI) / 180
    return {
      x: 50 + radiusValue * Math.cos(angleRad),
      y: 50 + radiusValue * Math.sin(angleRad),
    }
  }

  const targetBearingPoint = bearingEndpoint(targetBearing, 29)
  const actualBearingPoint = bearingEndpoint(actualBearing, 23)
  const inclinationToY = (inclinationDeg: number) => 14 + ((90 - inclinationDeg) / 180) * 72
  const targetInclinationY = inclinationToY(targetInclination)
  const actualInclinationY = inclinationToY(actualInclination)
  const formatBearing = (value: number) => Math.round(value).toString().padStart(3, '0')
  const formatInclination = (value: number) => {
    const rounded = Math.round(value)
    return `${rounded >= 0 ? '+' : ''}${rounded}`
  }

  return (
    <div
      className={`attitude-panel ${ship.dampenersActive ? '' : 'attitude-panel-offline'}`.trim()}
      aria-label="Bearing and inclination readout"
    >
      <div className="attitude-header">NAV SOLUTION</div>
      <div className="attitude-content">
        {!ship.dampenersActive && (
          <div className="attitude-offline-overlay" aria-hidden="true">
            <span className="attitude-offline-text">INERTIAL DAMPENERS OFFLINE</span>
          </div>
        )}
        <div className="attitude-viz-row">
          <div className="attitude-viz-col">
            <div className="attitude-viz-title">BEARING</div>
            <svg viewBox="0 -6 100 106" className="attitude-bearing-scope" role="img">
              <circle cx="50" cy="50" r="40" className="attitude-scope-ring attitude-scope-ring-outer" />
              <circle cx="50" cy="50" r="28" className="attitude-scope-ring attitude-scope-ring-inner" />
              <line x1="50" y1="8" x2="50" y2="92" className="attitude-scope-axis" />
              <line x1="8" y1="50" x2="92" y2="50" className="attitude-scope-axis" />
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
            </svg>
            <div className="attitude-viz-value-row">
              <span className="attitude-mode-left">{formatBearing(actualBearing)}</span>
              <span className="attitude-mode-separator">{'\u00A0\u00A0/\u00A0\u00A0'}</span>
              <span className="attitude-header-right">{formatBearing(targetBearing)}</span>
            </div>
          </div>
          <div className="attitude-viz-col">
            <div className="attitude-viz-title">INCLINATION</div>
            <svg viewBox="0 0 56 100" className="attitude-inclination-meter" role="img">
              <rect x="19" y="14" width="24" height="72" className="attitude-meter-track" />
              <line x1="19" y1="50" x2="43" y2="50" className="attitude-meter-midline" />
              <line x1="11" y1={targetInclinationY} x2="51" y2={targetInclinationY} className="attitude-meter-marker attitude-meter-marker-tgt" />
              <line x1="11" y1={actualInclinationY} x2="51" y2={actualInclinationY} className="attitude-meter-marker attitude-meter-marker-act" />
              <text x="2" y="18" className="attitude-meter-label">+90</text>
              <text x="2" y="54" className="attitude-meter-label">0</text>
              <text x="2" y="90" className="attitude-meter-label">-90</text>
            </svg>
            <div className="attitude-viz-value-row">
              <span className="attitude-mode-left">{formatInclination(actualInclination)}</span>
              <span className="attitude-mode-separator">{'\u00A0\u00A0/\u00A0\u00A0'}</span>
              <span className="attitude-header-right">{formatInclination(targetInclination)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
