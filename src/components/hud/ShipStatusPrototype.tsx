import { useMemo, useState, type CSSProperties } from 'react'
import { useGameStore } from '@/state/gameStore'
import { getCelestialById } from '@/utils/systemData'
import {
  getWarpCapacitorRequiredAmount,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'

const MAX_SUBWARP_MPS = 215
const MWD_SPEED_MPS = 800
const SPEED_GAUGE_SWEEP_DEGREES = 120
const SPEED_ARC_START_DEG = 30
const SPEED_ARC_END_DEG = SPEED_ARC_START_DEG + SPEED_GAUGE_SWEEP_DEGREES
const STATUS_ARC_EDGE_PAD_DEG = 15
const STATUS_ARC_START_DEG = SPEED_ARC_END_DEG + STATUS_ARC_EDGE_PAD_DEG
const STATUS_ARC_SWEEP_DEGREES = 360 - SPEED_GAUGE_SWEEP_DEGREES - STATUS_ARC_EDGE_PAD_DEG * 2
const GAUGE_VIEWBOX_SIZE = 200
const CAPACITOR_RING_COUNT = 5
const CAPACITOR_RADIAL_GROUP_COUNT = 18
const CAPACITOR_GROUP_SIDE_PAD_DEG = 5
const CAPACITOR_SEGMENT_STROKE_WIDTH = 4
const CAPACITOR_SEGMENT_RING_GAP = 2
const CAPACITOR_RING_INWARD_SHIFT = 1
const CAPACITOR_START_DEG = -90
const MWD_CAPACITOR_ACTIVATION_FRACTION = 0.2
const WARP_MIN_POST_CAPACITOR = 1
const STATUS_SPEED_EPSILON_MPS = 0.5
const STATUS_SPEED_TRACK_EPSILON_MPS = 1
const STATUS_ANGLE_EPSILON_DEG = 0.5
const WARP_ARRIVAL_DISTANCE_OPTIONS_KM = [15, 20, 25, 30, 35, 40, 45, 50] as const
const WARP_ARRIVAL_DISTANCE_DATALIST_ID = 'warp-arrival-distance-steps'
const WARP_ARRIVAL_MIN_KM = WARP_ARRIVAL_DISTANCE_OPTIONS_KM[0]
const WARP_ARRIVAL_MAX_KM =
  WARP_ARRIVAL_DISTANCE_OPTIONS_KM[WARP_ARRIVAL_DISTANCE_OPTIONS_KM.length - 1]!

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function formatHudValue(value: number) {
  return Math.round(value).toLocaleString()
}

function shortestAngleDeltaDeg(fromDeg: number, toDeg: number) {
  return ((toDeg - fromDeg + 540) % 360) - 180
}

function getArcMetrics(radius: number, sweepDeg: number, pct: number) {
  const circumference = 2 * Math.PI * radius
  const arcLength = circumference * (sweepDeg / 360)
  const filledArcLength = arcLength * clamp01(pct)
  return { circumference, arcLength, filledArcLength }
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleDeg: number) {
  const angleRad = (angleDeg * Math.PI) / 180
  return {
    x: centerX + radius * Math.cos(angleRad),
    y: centerY + radius * Math.sin(angleRad),
  }
}

function describeArcPath(
  centerX: number,
  centerY: number,
  radius: number,
  startDeg: number,
  endDeg: number
) {
  const start = polarToCartesian(centerX, centerY, radius, startDeg)
  const end = polarToCartesian(centerX, centerY, radius, endDeg)
  const deltaDeg = ((endDeg - startDeg) % 360 + 360) % 360
  const largeArcFlag = deltaDeg > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`
}

export function ShipStatusPrototype() {
  const ship = useGameStore((s) => s.ship)
  const setTargetSpeed = useGameStore((s) => s.setTargetSpeed)
  const setMwdActive = useGameStore((s) => s.setMwdActive)
  const setDampenersActive = useGameStore((s) => s.setDampenersActive)
  const startWarp = useGameStore((s) => s.startWarp)
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const navAttitudeMode = useGameStore((s) => s.navAttitudeMode)
  const starSystem = useGameStore((s) => s.starSystem)
  const selectedWarpDestinationId = useGameStore((s) => s.selectedWarpDestinationId)
  const warpArrivalDistanceKm = useGameStore((s) => s.warpArrivalDistanceKm)
  const setWarpArrivalDistanceKm = useGameStore((s) => s.setWarpArrivalDistanceKm)
  const warpAligned = useGameStore((s) => s.warpAligned)
  const warpRequiredBearing = useGameStore((s) => s.warpRequiredBearing)
  const warpRequiredInclination = useGameStore((s) => s.warpRequiredInclination)
  const warpState = useGameStore((s) => s.warpState)
  const warpTargetId = useGameStore((s) => s.warpTargetId)
  const warpTravelProgress = useGameStore((s) => s.warpTravelProgress)
  const [hoverPct, setHoverPct] = useState<number | null>(null)

  const setSpeedMps = ship.mwdActive ? MWD_SPEED_MPS : ship.targetSpeed
  const actualSpeedMps = ship.actualSpeed
  const maxSpeedMps = ship.mwdActive ? MWD_SPEED_MPS : MAX_SUBWARP_MPS
  const setSpeedPct = clamp01(setSpeedMps / maxSpeedMps)
  const actualSpeedPct = clamp01(actualSpeedMps / maxSpeedMps)
  const shieldPct = clamp01(ship.shield / ship.shieldMax)
  const armorPct = clamp01(ship.armor / ship.armorMax)
  const hullPct = clamp01(ship.hull / ship.hullMax)
  const capacitorPct = clamp01(ship.capacitor / ship.capacitorMax)
  const shieldTooltip = `Shield: ${formatHudValue(ship.shield)} / ${formatHudValue(ship.shieldMax)}`
  const armorTooltip = `Armor: ${formatHudValue(ship.armor)} / ${formatHudValue(ship.armorMax)}`
  const hullTooltip = `Hull: ${formatHudValue(ship.hull)} / ${formatHudValue(ship.hullMax)}`

  const center = 100
  const radius = 70
  const strokeWidth = 20
  const statusStrokeWidth = 6
  const statusGap = 2
  const speedOuterRadius = radius + strokeWidth / 2
  const shieldRadius = speedOuterRadius - statusStrokeWidth / 2
  const armorRadius = shieldRadius - statusStrokeWidth - statusGap
  const hullRadius = armorRadius - statusStrokeWidth - statusGap
  const speedArc = getArcMetrics(radius, SPEED_GAUGE_SWEEP_DEGREES, 1)
  const setArcLength = speedArc.arcLength * setSpeedPct
  const setArcOffset = -(speedArc.arcLength - setArcLength)
  const actualArcLength = speedArc.arcLength * actualSpeedPct
  const actualArcOffset = -(speedArc.arcLength - actualArcLength)
  const shieldArc = getArcMetrics(shieldRadius, STATUS_ARC_SWEEP_DEGREES, shieldPct)
  const armorArc = getArcMetrics(armorRadius, STATUS_ARC_SWEEP_DEGREES, armorPct)
  const hullArc = getArcMetrics(hullRadius, STATUS_ARC_SWEEP_DEGREES, hullPct)
  const capacitorRingStep = CAPACITOR_SEGMENT_STROKE_WIDTH + CAPACITOR_SEGMENT_RING_GAP
  const capacitorOuterRadius =
    hullRadius -
    statusStrokeWidth / 2 -
    CAPACITOR_SEGMENT_STROKE_WIDTH / 2 -
    CAPACITOR_SEGMENT_RING_GAP -
    capacitorRingStep * CAPACITOR_RING_INWARD_SHIFT
  const capacitorSegmentsTotal = CAPACITOR_RADIAL_GROUP_COUNT * CAPACITOR_RING_COUNT
  const capacitorActiveSegments = Math.round(capacitorPct * capacitorSegmentsTotal)
  const capacitorDrainedSegments = capacitorSegmentsTotal - capacitorActiveSegments
  const capacitorGroupSweep = 360 / CAPACITOR_RADIAL_GROUP_COUNT - CAPACITOR_GROUP_SIDE_PAD_DEG * 2
  const markerRadius = radius + strokeWidth / 2 + 4
  const hoverDesignatedSpeed = hoverPct !== null ? Math.round(hoverPct * MAX_SUBWARP_MPS) : null
  const displaySpeedNumerator = hoverDesignatedSpeed ?? Math.round(actualSpeedMps)
  const isHoverPreviewing = hoverDesignatedSpeed !== null
  const mwdCooldownRemaining = Math.max(0, ship.mwdCooldownRemaining)
  const isMwdCoolingDown = !ship.mwdActive && mwdCooldownRemaining > 0
  const canActivateMwd =
    ship.capacitor >= ship.capacitorMax * MWD_CAPACITOR_ACTIVATION_FRACTION &&
    mwdCooldownRemaining <= 0
  const warpBusy = warpState !== 'idle'
  const warpTransitActive = warpState === 'warping' || warpState === 'landing'
  const hasWarpCapacitor = useMemo(() => {
    if (!selectedWarpDestinationId) return false
    const sourceCelestial = getCelestialById(currentCelestialId, starSystem)
    const destinationCelestial = getCelestialById(selectedWarpDestinationId, starSystem)
    if (!sourceCelestial || !destinationCelestial || sourceCelestial.id === destinationCelestial.id) {
      return false
    }
    const sourceWorld = worldPositionForCelestial(sourceCelestial)
    const destinationWorld = worldPositionForCelestial(destinationCelestial)
    const distanceWorldUnits = vectorMagnitude(vectorBetweenWorldPoints(sourceWorld, destinationWorld))
    const requiredCapacitor = getWarpCapacitorRequiredAmount(distanceWorldUnits, ship.capacitorMax)
    return ship.capacitor - requiredCapacitor >= WARP_MIN_POST_CAPACITOR
  }, [currentCelestialId, selectedWarpDestinationId, ship.capacitor, ship.capacitorMax, starSystem])
  const canWarp = !warpBusy && Boolean(selectedWarpDestinationId) && warpAligned && hasWarpCapacitor
  const selectedWarpDestination = useMemo(
    () => (selectedWarpDestinationId ? getCelestialById(selectedWarpDestinationId, starSystem) : null),
    [selectedWarpDestinationId, starSystem]
  )
  const warpArrivalProgress =
    (warpArrivalDistanceKm - WARP_ARRIVAL_MIN_KM) /
    (WARP_ARRIVAL_MAX_KM - WARP_ARRIVAL_MIN_KM)
  const warpArrivalSliderValue =
    WARP_ARRIVAL_MAX_KM - (warpArrivalDistanceKm - WARP_ARRIVAL_MIN_KM)
  const activeWarpTarget = useMemo(
    () => (warpTargetId ? getCelestialById(warpTargetId, starSystem) : null),
    [starSystem, warpTargetId]
  )
  const autoAlignBearingDelta = Math.abs(shortestAngleDeltaDeg(ship.bearing, warpRequiredBearing))
  const autoAlignInclinationDelta = Math.abs(ship.inclination - warpRequiredInclination)
  const autoAligningToSelectedWarpTarget =
    selectedWarpDestination &&
    navAttitudeMode === 'AA' &&
    ship.dampenersActive &&
    !warpAligned &&
    warpState === 'idle' &&
    autoAlignBearingDelta <= 0.5 &&
    autoAlignInclinationDelta <= 0.5
  const attitudeCorrectionBearingDelta = Math.abs(shortestAngleDeltaDeg(ship.actualHeading, ship.bearing))
  const attitudeCorrectionInclinationDelta = Math.abs(ship.actualInclination - ship.inclination)
  const attitudeManeuvering =
    ship.dampenersActive &&
    (attitudeCorrectionBearingDelta > STATUS_ANGLE_EPSILON_DEG ||
      attitudeCorrectionInclinationDelta > STATUS_ANGLE_EPSILON_DEG)
  const thrustManeuvering =
    ship.mwdActive ||
    Math.abs(actualSpeedMps - setSpeedMps) > STATUS_SPEED_TRACK_EPSILON_MPS ||
    (!ship.dampenersActive && setSpeedMps > STATUS_SPEED_EPSILON_MPS)
  const activelyManeuvering = thrustManeuvering || attitudeManeuvering
  const shipStatusTitle = (() => {
    if ((warpState === 'warping' || warpState === 'landing') && activeWarpTarget) {
      return `SHIP STATUS: WARPING TO ${activeWarpTarget.name.toUpperCase()}`
    }
    if (warpState === 'idle' && warpAligned && selectedWarpDestination) {
      return `SHIP STATUS: ALIGNED TO ${selectedWarpDestination.name.toUpperCase()}`
    }
    if (autoAligningToSelectedWarpTarget) {
      return `SHIP STATUS: ALIGNING TO ${selectedWarpDestination.name.toUpperCase()}`
    }
    if (activelyManeuvering) {
      return 'SHIP STATUS: MANEUVERING'
    }
    if (actualSpeedMps <= STATUS_SPEED_EPSILON_MPS) {
      return 'SHIP STATUS: STATIC'
    }
    return 'SHIP STATUS: NOMINAL'
  })()

  const pctFromPointer = (clientX: number, clientY: number, bounds: DOMRect) => {
    const localX = ((clientX - bounds.left) / bounds.width) * GAUGE_VIEWBOX_SIZE
    const localY = ((clientY - bounds.top) / bounds.height) * GAUGE_VIEWBOX_SIZE
    const dx = localX - center
    const dy = localY - center
    const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
    const clampedAngle = Math.max(SPEED_ARC_START_DEG, Math.min(SPEED_ARC_END_DEG, angle))
    const angleProgress = (clampedAngle - SPEED_ARC_START_DEG) / SPEED_GAUGE_SWEEP_DEGREES
    return clamp01(1 - angleProgress)
  }

  const pctToArrowTransform = (pct: number) => {
    const clampedPct = clamp01(pct)
    const angleDeg = SPEED_ARC_END_DEG - clampedPct * SPEED_GAUGE_SWEEP_DEGREES
    const angleRad = (angleDeg * Math.PI) / 180
    const x = center + markerRadius * Math.cos(angleRad)
    const y = center + markerRadius * Math.sin(angleRad)
    const inwardRotationDeg = angleDeg + 180
    return { x, y, inwardRotationDeg, angleRad }
  }

  const hoverArrow = hoverPct !== null ? pctToArrowTransform(hoverPct) : null
  const selectedArrow = pctToArrowTransform(setSpeedPct)
  const selectedLabelRadius = markerRadius + 18
  const selectedLabelTangentOffset = 8
  const selectedLabelNormalX = Math.cos(selectedArrow.angleRad)
  const selectedLabelNormalY = Math.sin(selectedArrow.angleRad)
  const selectedLabelTangentX = -Math.sin(selectedArrow.angleRad)
  const selectedLabelTangentY = Math.cos(selectedArrow.angleRad)
  const selectedLabelX =
    center +
    selectedLabelRadius * selectedLabelNormalX +
    selectedLabelTangentOffset * selectedLabelTangentX
  const selectedLabelY =
    center +
    selectedLabelRadius * selectedLabelNormalY +
    selectedLabelTangentOffset * selectedLabelTangentY
  const selectedLabelAnchor: 'start' | 'end' =
    selectedLabelNormalX >= 0 ? 'start' : 'end'

  return (
    <div className="hud-panel ship-status-panel ship-status-v2-panel">
      <div className="hud-panel-title">{shipStatusTitle}</div>
      <div className="ship-status-v2-body">
        <div
          className="speed-arc-wrap"
          aria-label="Ship speed gauge"
          onMouseMove={(e) => {
            const bounds = e.currentTarget.getBoundingClientRect()
            setHoverPct(pctFromPointer(e.clientX, e.clientY, bounds))
          }}
          onMouseLeave={() => setHoverPct(null)}
          onClick={(e) => {
            const bounds = e.currentTarget.getBoundingClientRect()
            const nextPct = pctFromPointer(e.clientX, e.clientY, bounds)
            const nextTargetSpeed = Math.round(nextPct * MAX_SUBWARP_MPS)
            setTargetSpeed(nextTargetSpeed)
          }}
        >
          <svg viewBox="0 0 200 200" className="speed-arc-svg" role="img">
              <circle
                className="status-arc-bg"
                cx={center}
                cy={center}
                r={shieldRadius}
                fill="none"
                strokeWidth={statusStrokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${shieldArc.arcLength} ${shieldArc.circumference}`}
                transform={`rotate(${STATUS_ARC_START_DEG} ${center} ${center})`}
              >
                <title>{shieldTooltip}</title>
              </circle>
              <circle
                className="status-arc-fill status-arc-fill-shield"
                cx={center}
                cy={center}
                r={shieldRadius}
                fill="none"
                strokeWidth={statusStrokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${shieldArc.filledArcLength} ${shieldArc.circumference}`}
                transform={`rotate(${STATUS_ARC_START_DEG} ${center} ${center})`}
              >
                <title>{shieldTooltip}</title>
              </circle>
              <circle
                className="status-arc-bg"
                cx={center}
                cy={center}
                r={armorRadius}
                fill="none"
                strokeWidth={statusStrokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${armorArc.arcLength} ${armorArc.circumference}`}
                transform={`rotate(${STATUS_ARC_START_DEG} ${center} ${center})`}
              >
                <title>{armorTooltip}</title>
              </circle>
              <circle
                className="status-arc-fill status-arc-fill-armor"
                cx={center}
                cy={center}
                r={armorRadius}
                fill="none"
                strokeWidth={statusStrokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${armorArc.filledArcLength} ${armorArc.circumference}`}
                transform={`rotate(${STATUS_ARC_START_DEG} ${center} ${center})`}
              >
                <title>{armorTooltip}</title>
              </circle>
              <circle
                className="status-arc-bg"
                cx={center}
                cy={center}
                r={hullRadius}
                fill="none"
                strokeWidth={statusStrokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${hullArc.arcLength} ${hullArc.circumference}`}
                transform={`rotate(${STATUS_ARC_START_DEG} ${center} ${center})`}
              >
                <title>{hullTooltip}</title>
              </circle>
              <circle
                className="status-arc-fill status-arc-fill-hull"
                cx={center}
                cy={center}
                r={hullRadius}
                fill="none"
                strokeWidth={statusStrokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${hullArc.filledArcLength} ${hullArc.circumference}`}
                transform={`rotate(${STATUS_ARC_START_DEG} ${center} ${center})`}
              >
                <title>{hullTooltip}</title>
              </circle>
              {Array.from({ length: CAPACITOR_RADIAL_GROUP_COUNT }).map((_, groupIdx) => {
                const groupStartDeg =
                  CAPACITOR_START_DEG +
                  groupIdx * (360 / CAPACITOR_RADIAL_GROUP_COUNT) +
                  CAPACITOR_GROUP_SIDE_PAD_DEG
                const groupEndDeg = groupStartDeg + capacitorGroupSweep

                return Array.from({ length: CAPACITOR_RING_COUNT }).map((__, ringIdx) => {
                  const segmentIdx = groupIdx * CAPACITOR_RING_COUNT + ringIdx
                  const isCharged = segmentIdx >= capacitorDrainedSegments
                  const segmentRadius = capacitorOuterRadius - ringIdx * capacitorRingStep
                  const arcPath = describeArcPath(
                    center,
                    center,
                    segmentRadius,
                    groupStartDeg,
                    groupEndDeg
                  )

                  return (
                    <path
                      key={`cap-${groupIdx}-${ringIdx}`}
                      className={`capacitor-bank-segment ${
                        isCharged ? 'capacitor-bank-segment-charged' : 'capacitor-bank-segment-empty'
                      }`}
                      d={arcPath}
                      fill="none"
                      strokeWidth={CAPACITOR_SEGMENT_STROKE_WIDTH}
                      strokeLinecap="round"
                    />
                  )
                })
              })}
              <circle
                className="speed-arc-bg"
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${speedArc.arcLength} ${speedArc.circumference}`}
                transform={`rotate(${SPEED_ARC_START_DEG} ${center} ${center})`}
              />
              <circle
                className="speed-arc-fill speed-arc-fill-set"
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${setArcLength} ${speedArc.circumference}`}
                strokeDashoffset={setArcOffset}
                transform={`rotate(${SPEED_ARC_START_DEG} ${center} ${center})`}
              />
              <circle
                className="speed-arc-fill speed-arc-fill-actual"
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${actualArcLength} ${speedArc.circumference}`}
                strokeDashoffset={actualArcOffset}
                transform={`rotate(${SPEED_ARC_START_DEG} ${center} ${center})`}
              />
              {hoverArrow && (
                <g
                  className="speed-arc-arrow speed-arc-arrow-hover"
                  transform={`translate(${hoverArrow.x} ${hoverArrow.y}) rotate(${hoverArrow.inwardRotationDeg})`}
                >
                  <polygon points="0,0 -8,-4 -8,4" />
                </g>
              )}
              {selectedArrow && (
                <>
                  <g
                    className="speed-arc-arrow speed-arc-arrow-selected"
                    transform={`translate(${selectedArrow.x} ${selectedArrow.y}) rotate(${selectedArrow.inwardRotationDeg})`}
                  >
                    <polygon points="0,0 -8,-4 -8,4" />
                  </g>
                  <text
                    x={selectedLabelX}
                    y={selectedLabelY}
                    className="speed-arc-selected-label"
                    textAnchor={selectedLabelAnchor}
                    dominantBaseline="middle"
                  >
                    {warpTransitActive ? 'WARP' : `${Math.round(setSpeedMps)} m/s`}
                  </text>
                </>
              )}
              <text
                x={center}
                y={center}
                className="capacitor-bank-label"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {Math.round(capacitorPct * 100)}%
              </text>
          </svg>
        </div>
        <div className="ship-status-v2-speed-row">
          <div className="speed-arc-fraction">
            {warpTransitActive ? (
              <span className="speed-arc-metric speed-arc-metric-actual">WARP</span>
            ) : (
              <>
                <span
                  className={`speed-arc-metric ${
                    isHoverPreviewing ? 'speed-arc-metric-preview' : 'speed-arc-metric-actual'
                  }`}
                >
                  {displaySpeedNumerator}
                </span>
                <span className="speed-arc-separator"> / </span>
                <span className="speed-arc-max">{maxSpeedMps}</span>
                <span className="speed-arc-unit"> m/s</span>
              </>
            )}
          </div>
          <button
            type="button"
            className={`dmp-button ship-status-v2-dmp-button ${ship.dampenersActive ? 'active' : ''}`}
            onClick={() => setDampenersActive(!ship.dampenersActive)}
            aria-pressed={ship.dampenersActive}
          >
            DMP
          </button>
          <button
            type="button"
            className={`mwd-button ship-status-v2-mwd-button ${ship.mwdActive ? 'active' : ''} ${isMwdCoolingDown ? 'cooldown' : ''}`.trim()}
            onClick={() => !ship.mwdActive && canActivateMwd && setMwdActive(true)}
            disabled={ship.mwdActive || !canActivateMwd}
          >
            {ship.mwdActive
              ? `MWD ${ship.mwdRemaining.toFixed(1)}s`
              : mwdCooldownRemaining > 0
                ? `CD ${mwdCooldownRemaining.toFixed(1)}s`
                : 'MWD'}
          </button>
          <div className="ship-status-v2-warp-stack">
            <div className="ship-status-v2-warp-distance-slider">
              <span className="ship-status-v2-warp-distance-title">
                <span>WARP AT</span>
                <span>(KM)</span>
              </span>
              <div className="ship-status-v2-warp-distance-labels" aria-hidden="true">
                {[...WARP_ARRIVAL_DISTANCE_OPTIONS_KM].reverse().map((distanceKm, index) => (
                  <span key={distanceKm} style={{ '--warp-notch-index': index } as CSSProperties}>
                    {distanceKm}
                  </span>
                ))}
              </div>
              <div className="ship-status-v2-warp-distance-input-wrap">
                <div className="ship-status-v2-warp-notch-rail" aria-hidden="true">
                  {[...WARP_ARRIVAL_DISTANCE_OPTIONS_KM].reverse().map((distanceKm, index) => (
                    <span key={`notch-${distanceKm}`} style={{ '--warp-notch-index': index } as CSSProperties} />
                  ))}
                </div>
                <input
                  type="range"
                  min={WARP_ARRIVAL_MIN_KM}
                  max={WARP_ARRIVAL_MAX_KM}
                  step={5}
                  list={WARP_ARRIVAL_DISTANCE_DATALIST_ID}
                  className="ship-status-v2-warp-distance-input"
                  value={warpArrivalSliderValue}
                  onChange={(event) => {
                    const nextSliderValue = Number(event.target.value)
                    const nextDistanceKm =
                      WARP_ARRIVAL_MAX_KM - (nextSliderValue - WARP_ARRIVAL_MIN_KM)
                    setWarpArrivalDistanceKm(nextDistanceKm)
                  }}
                  disabled={warpBusy}
                  aria-label="Warp arrival distance from destination center"
                />
                <span
                  className="ship-status-v2-warp-distance-dot"
                  style={{ '--warp-thumb-progress': warpArrivalProgress } as CSSProperties}
                  aria-hidden="true"
                />
              </div>
              <datalist id={WARP_ARRIVAL_DISTANCE_DATALIST_ID}>
                {WARP_ARRIVAL_DISTANCE_OPTIONS_KM.map((distanceKm) => (
                  <option key={distanceKm} value={distanceKm} />
                ))}
              </datalist>
            </div>
            <button
              type="button"
              className={`warp-button ship-status-v2-warp-button ${canWarp ? 'ready' : ''} ${warpBusy ? 'active' : ''}`.trim()}
              onClick={() => {
                if (!selectedWarpDestinationId || !canWarp) return
                startWarp(selectedWarpDestinationId)
              }}
              disabled={!canWarp}
            >
              {warpBusy ? `WARP ${(warpTravelProgress * 100).toFixed(0)}%` : 'WARP'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
