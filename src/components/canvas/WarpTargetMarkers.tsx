import { useEffect, useMemo, useRef, useState } from 'react'
import { Html, Billboard } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import { STAR_SYSTEM, getCelestialById } from '@/utils/systemData'
import {
  bearingInclinationFromVector,
  formatDistanceAu,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'

const MARKER_DISTANCE = 1_000_000

function getDefaultDestination(currentCelestialId: string) {
  if (currentCelestialId !== 'belt') return 'belt'
  const fallback = STAR_SYSTEM.celestials.find((c) => c.id !== currentCelestialId)
  return fallback?.id ?? null
}

export function WarpTargetMarkers() {
  const markerRef = useRef<THREE.Group>(null)
  const [hovered, setHovered] = useState(false)
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const shipPosition = useGameStore((s) => s.ship.position)
  const selectedWarpDestinationId = useGameStore((s) => s.selectedWarpDestinationId)
  const setSelectedWarpDestination = useGameStore((s) => s.setSelectedWarpDestination)

  useEffect(() => {
    const selected = selectedWarpDestinationId ? getCelestialById(selectedWarpDestinationId) : null
    if (selected && selected.id !== currentCelestialId) return
    setSelectedWarpDestination(getDefaultDestination(currentCelestialId))
  }, [currentCelestialId, selectedWarpDestinationId, setSelectedWarpDestination])

  const currentCelestial = useMemo(
    () => getCelestialById(currentCelestialId),
    [currentCelestialId]
  )
  const destinationCelestial = useMemo(
    () => (selectedWarpDestinationId ? getCelestialById(selectedWarpDestinationId) : null),
    [selectedWarpDestinationId]
  )

  const markerData = useMemo(() => {
    if (!currentCelestial || !destinationCelestial) return null
    if (destinationCelestial.id === currentCelestial.id) return null

    const currentWorld = worldPositionForCelestial(currentCelestial)
    const destinationWorld = worldPositionForCelestial(destinationCelestial)
    // Use fixed grid-to-grid direction so alignment values do not drift
    // with local ship attitude or small in-grid translations.
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
  }, [currentCelestial, destinationCelestial])

  const markerWorldPosRef = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    if (!markerRef.current || !markerData) return
    markerWorldPosRef
      .set(shipPosition[0], shipPosition[1], shipPosition[2])
      .addScaledVector(markerData.direction, MARKER_DISTANCE)
    markerRef.current.position.copy(markerWorldPosRef)
  })

  if (!markerData) return null

  return (
    <group ref={markerRef}>
      <Billboard>
        <mesh>
          <sphereGeometry args={[34, 16, 16]} />
          <meshBasicMaterial color={0x75d7ff} toneMapped={false} />
        </mesh>
      </Billboard>
      <Html center transform={false} zIndexRange={[10000, 0]} style={{ pointerEvents: 'none' }}>
        <button
          type="button"
          className="warp-marker-screen-button"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={() => setSelectedWarpDestination(markerData.destinationId)}
          style={{ pointerEvents: 'auto' }}
          aria-label={`Warp marker ${markerData.destinationName}`}
        >
          <span className="warp-marker-screen-dot" aria-hidden />
        </button>
        {hovered && (
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
}
