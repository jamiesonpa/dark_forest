import { useEffect, useMemo, useRef, useState } from 'react'
import { Html, Billboard } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import type { StarSystemData } from '@/types/game'
import { getCelestialById } from '@/utils/systemData'
import {
  bearingInclinationFromVector,
  formatDistanceAu,
  getWorldShipPosition,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'

const MARKER_DISTANCE = 1_000_000

function getDefaultDestination(currentCelestialId: string, availableDestinationIds: string[], starSystem: StarSystemData) {
  if (currentCelestialId !== 'belt' && availableDestinationIds.includes('belt')) return 'belt'
  const fallback = starSystem.celestials.find((c) => availableDestinationIds.includes(c.id) && c.id !== currentCelestialId && c.type !== 'star')
  return fallback?.id ?? null
}

export function WarpTargetMarkers() {
  const markerRefs = useRef(new Map<string, THREE.Group>())
  const [hoveredDestinationId, setHoveredDestinationId] = useState<string | null>(null)
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const navAttitudeMode = useGameStore((s) => s.navAttitudeMode)
  const starSystem = useGameStore((s) => s.starSystem)
  const dampenersActive = useGameStore((s) => s.ship.dampenersActive)
  const shipPosition = useGameStore((s) => s.ship.position)
  const selectedWarpDestinationId = useGameStore((s) => s.selectedWarpDestinationId)
  const warpTargetId = useGameStore((s) => s.warpTargetId)
  const warpSourceCelestialId = useGameStore((s) => s.warpSourceCelestialId)
  const warpAligned = useGameStore((s) => s.warpAligned)
  const warpState = useGameStore((s) => s.warpState)
  const revealedCelestialIds = useGameStore((s) => s.ewRevealedCelestialIds)
  const setShipState = useGameStore((s) => s.setShipState)
  const setSelectedWarpDestination = useGameStore((s) => s.setSelectedWarpDestination)

  const availableDestinationIds = useMemo(
    () => revealedCelestialIds.filter((id) => id !== currentCelestialId && starSystem.celestials.some((c) => c.id === id && c.type !== 'star')),
    [currentCelestialId, revealedCelestialIds, starSystem]
  )

  useEffect(() => {
    const selected = selectedWarpDestinationId
      ? getCelestialById(selectedWarpDestinationId, starSystem)
      : null
    if (selected && availableDestinationIds.includes(selected.id) && selected.id !== currentCelestialId) return
    setSelectedWarpDestination(getDefaultDestination(currentCelestialId, availableDestinationIds, starSystem))
  }, [availableDestinationIds, currentCelestialId, selectedWarpDestinationId, setSelectedWarpDestination, starSystem])

  const currentCelestial = useMemo(
    () => getCelestialById(currentCelestialId, starSystem),
    [currentCelestialId, starSystem]
  )
  const destinationCelestial = useMemo(
    () => (selectedWarpDestinationId ? getCelestialById(selectedWarpDestinationId, starSystem) : null),
    [selectedWarpDestinationId, starSystem]
  )
  const warpSourceCelestial = useMemo(
    () => (warpSourceCelestialId ? getCelestialById(warpSourceCelestialId, starSystem) : null),
    [starSystem, warpSourceCelestialId]
  )
  const currentCelestialWorldPosition = useMemo(
    () => (currentCelestial ? worldPositionForCelestial(currentCelestial) : null),
    [currentCelestial]
  )
  const shipWorldPosition = useMemo(
    () => (currentCelestialWorldPosition ? getWorldShipPosition(shipPosition, currentCelestialWorldPosition) : null),
    [currentCelestialWorldPosition, shipPosition]
  )
  const suppressNonTargetMarkers = warpState === 'warping' || warpState === 'landing'
  const activeWarpMarkerId = suppressNonTargetMarkers ? warpTargetId : destinationCelestial?.id ?? null

  const markerDataList = useMemo(() => {
    if (!currentCelestialWorldPosition || !currentCelestial) return []
    return starSystem.celestials
      .filter((c) => availableDestinationIds.includes(c.id) && c.id !== currentCelestial.id && c.type !== 'star')
      .map((destinationCelestial) => {
        const destinationWorld = worldPositionForCelestial(destinationCelestial)
        const toDestination = vectorBetweenWorldPoints(currentCelestialWorldPosition, destinationWorld)
        const directionDistance = vectorMagnitude(toDestination)
        if (directionDistance < 0.001) return null
        const liveShipToDestination = shipWorldPosition
          ? vectorBetweenWorldPoints(shipWorldPosition, destinationWorld)
          : toDestination
        const liveDistance = vectorMagnitude(liveShipToDestination)
        const lockedWarpVector =
          suppressNonTargetMarkers &&
          destinationCelestial.id === activeWarpMarkerId &&
          warpSourceCelestial
            ? vectorBetweenWorldPoints(worldPositionForCelestial(warpSourceCelestial), destinationWorld)
            : null
        const markerVector =
          lockedWarpVector && vectorMagnitude(lockedWarpVector) >= 0.001
            ? lockedWarpVector
            : suppressNonTargetMarkers && destinationCelestial.id === activeWarpMarkerId && liveDistance >= 0.001
              ? liveShipToDestination
            : toDestination
        const markerVectorDistance = vectorMagnitude(markerVector)
        const { bearing, inclination } = bearingInclinationFromVector(markerVector)
        return {
          destinationId: destinationCelestial.id,
          destinationName: destinationCelestial.name,
          distanceMeters: liveDistance,
          bearing,
          inclination,
          direction: new THREE.Vector3(
            markerVector[0] / markerVectorDistance,
            markerVector[1] / markerVectorDistance,
            markerVector[2] / markerVectorDistance
          ),
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  }, [activeWarpMarkerId, availableDestinationIds, currentCelestial, currentCelestialWorldPosition, shipWorldPosition, starSystem, suppressNonTargetMarkers, warpSourceCelestial])

  useEffect(() => {
    if (!hoveredDestinationId) return
    const hoveredStillVisible = markerDataList.some((markerData) => {
      if (markerData.destinationId !== hoveredDestinationId) return false
      return !(suppressNonTargetMarkers && markerData.destinationId !== activeWarpMarkerId)
    })
    if (!hoveredStillVisible) {
      setHoveredDestinationId(null)
    }
  }, [activeWarpMarkerId, hoveredDestinationId, markerDataList, suppressNonTargetMarkers])

  const markerWorldPosRef = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    if (markerDataList.length === 0) return
    markerDataList.forEach((markerData) => {
      const markerRef = markerRefs.current.get(markerData.destinationId)
      if (!markerRef) return
      markerWorldPosRef
        .set(shipPosition[0], shipPosition[1], shipPosition[2])
        .addScaledVector(markerData.direction, MARKER_DISTANCE)
      markerRef.position.copy(markerWorldPosRef)
    })
  })

  if (markerDataList.length === 0) return null

  return (
    <>
      {markerDataList.map((markerData) => {
        const isSelected = markerData.destinationId === destinationCelestial?.id
        const isAlignedSelection = isSelected && warpAligned && warpState === 'idle'
        const isWarpHidden = suppressNonTargetMarkers && markerData.destinationId !== activeWarpMarkerId
        const markerOpacity = isWarpHidden ? 0 : 1
        const markerTransitionMs = isWarpHidden ? 1000 : 120
        const isHovered = markerData.destinationId === hoveredDestinationId && !isWarpHidden
        return (
          <group
            key={markerData.destinationId}
            ref={(node) => {
              if (node) markerRefs.current.set(markerData.destinationId, node)
              else markerRefs.current.delete(markerData.destinationId)
            }}
          >
            <Billboard>
              <mesh>
                <sphereGeometry args={[34, 16, 16]} />
                <meshBasicMaterial
                  color={isSelected ? 0xffd27a : 0x75d7ff}
                  toneMapped={false}
                  transparent
                  opacity={markerOpacity}
                />
              </mesh>
            </Billboard>
            <Html
              center
              transform={false}
              zIndexRange={[10000, 0]}
              style={{
                pointerEvents: 'none',
                opacity: markerOpacity,
                transition: `opacity ${markerTransitionMs}ms ease`,
              }}
            >
              <button
                type="button"
                className="warp-marker-screen-button"
                onMouseEnter={() => setHoveredDestinationId(markerData.destinationId)}
                onMouseLeave={() => setHoveredDestinationId((prev) => (prev === markerData.destinationId ? null : prev))}
                onClick={() => setSelectedWarpDestination(markerData.destinationId)}
                onDoubleClick={() => {
                  setSelectedWarpDestination(markerData.destinationId)
                  if (navAttitudeMode !== 'AA' || !dampenersActive || warpState !== 'idle') return
                  setShipState({
                    bearing: markerData.bearing,
                    inclination: markerData.inclination,
                  })
                }}
                style={{ pointerEvents: isWarpHidden ? 'none' : 'auto' }}
                aria-label={`Warp marker ${markerData.destinationName}`}
                title={navAttitudeMode === 'AA' ? 'Double-click to align for warp' : undefined}
              >
                <span
                  className={`warp-marker-screen-ring ${isAlignedSelection ? 'is-visible' : ''}`.trim()}
                  aria-hidden
                />
                <span className="warp-marker-screen-dot" aria-hidden />
              </button>
              {isHovered && (
                <div className="warp-marker-tooltip" style={{ pointerEvents: 'none', position: 'absolute', left: 14, top: -14 }}>
                  <div className="warp-marker-title">{markerData.destinationName}</div>
                  <div className="warp-marker-row">{formatDistanceAu(markerData.distanceMeters)}</div>
                  <div className="warp-marker-row">
                    {`(${Math.round(markerData.bearing)}, ${Math.round(markerData.inclination)})`}
                  </div>
                </div>
              )}
            </Html>
          </group>
        )
      })}
    </>
  )
}
