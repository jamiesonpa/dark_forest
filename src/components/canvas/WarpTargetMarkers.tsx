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
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'

const MARKER_DISTANCE = 1_000_000

function getDefaultDestination(currentCelestialId: string, starSystem: StarSystemData) {
  if (currentCelestialId !== 'belt' && starSystem.celestials.some((c) => c.id === 'belt')) return 'belt'
  const fallback = starSystem.celestials.find((c) => c.id !== currentCelestialId && c.type !== 'star')
  return fallback?.id ?? null
}

export function WarpTargetMarkers() {
  const markerRefs = useRef(new Map<string, THREE.Group>())
  const [hoveredDestinationId, setHoveredDestinationId] = useState<string | null>(null)
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const starSystem = useGameStore((s) => s.starSystem)
  const shipPosition = useGameStore((s) => s.ship.position)
  const selectedWarpDestinationId = useGameStore((s) => s.selectedWarpDestinationId)
  const setSelectedWarpDestination = useGameStore((s) => s.setSelectedWarpDestination)

  useEffect(() => {
    const selected = selectedWarpDestinationId
      ? getCelestialById(selectedWarpDestinationId, starSystem)
      : null
    if (selected && selected.id !== currentCelestialId) return
    setSelectedWarpDestination(getDefaultDestination(currentCelestialId, starSystem))
  }, [currentCelestialId, selectedWarpDestinationId, setSelectedWarpDestination, starSystem])

  const currentCelestial = useMemo(
    () => getCelestialById(currentCelestialId, starSystem),
    [currentCelestialId, starSystem]
  )
  const destinationCelestial = useMemo(
    () => (selectedWarpDestinationId ? getCelestialById(selectedWarpDestinationId, starSystem) : null),
    [selectedWarpDestinationId, starSystem]
  )

  const markerDataList = useMemo(() => {
    if (!currentCelestial) return []
    const currentWorld = worldPositionForCelestial(currentCelestial)
    return starSystem.celestials
      .filter((c) => c.id !== currentCelestial.id && c.type !== 'star')
      .map((destinationCelestial) => {
        const destinationWorld = worldPositionForCelestial(destinationCelestial)
        const toDestination = vectorBetweenWorldPoints(currentWorld, destinationWorld)
        const directionDistance = vectorMagnitude(toDestination)
        if (directionDistance < 0.001) return null
        const { bearing, inclination } = bearingInclinationFromVector(toDestination)
        return {
          destinationId: destinationCelestial.id,
          destinationName: destinationCelestial.name,
          distanceMeters: directionDistance,
          bearing,
          inclination,
          direction: new THREE.Vector3(
            toDestination[0] / directionDistance,
            toDestination[1] / directionDistance,
            toDestination[2] / directionDistance
          ),
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
  }, [currentCelestial, starSystem])

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
        const isHovered = markerData.destinationId === hoveredDestinationId
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
                <meshBasicMaterial color={isSelected ? 0xffd27a : 0x75d7ff} toneMapped={false} />
              </mesh>
            </Billboard>
            <Html center transform={false} zIndexRange={[10000, 0]} style={{ pointerEvents: 'none' }}>
              <button
                type="button"
                className="warp-marker-screen-button"
                onMouseEnter={() => setHoveredDestinationId(markerData.destinationId)}
                onMouseLeave={() => setHoveredDestinationId((prev) => (prev === markerData.destinationId ? null : prev))}
                onClick={() => setSelectedWarpDestination(markerData.destinationId)}
                style={{ pointerEvents: 'auto' }}
                aria-label={`Warp marker ${markerData.destinationName}`}
              >
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
