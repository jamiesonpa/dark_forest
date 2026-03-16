import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import { getCelestialById } from '@/utils/systemData'
import {
  bearingInclinationFromVector,
  formatDistanceAu,
  WORLD_UNITS_PER_AU,
  getWorldShipPosition,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'

const AMBER = '#ffb000'
const AMBER_DIM = '#7a5500'
const AMBER_GLOW = '#ffcc44'
const BG_SCREEN = '#080808'
const LINE_GREY = '#7d848e'
const SELECT_BLUE = '#6cb8ff'

const MAP_TABS = ['MAP', 'SIG', 'DATA'] as const

type MapTab = (typeof MAP_TABS)[number]

type OrbitState = {
  yaw: number
  pitch: number
  distance?: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

type DisplayPoint = [number, number, number]
type RevealedTrack = {
  bearingDeg: number
  inclinationDeg: number
  id: string
  name: string
  distanceWorldUnits: number
  orbitRadius: number
  position: DisplayPoint
}

type HoveredMarker = {
  bearingDeg: number
  inclinationDeg: number
  id: string
  name: string
  distanceWorldUnits: number
}

const DISPLAY_RADIUS = 5.25
const SHIP_MARKER_HEIGHT_OFFSET = 0.26

function normalizePoint(
  point: readonly [number, number, number],
  center: readonly [number, number, number],
  systemRadius: number
): DisplayPoint {
  const safeRadius = Math.max(1, systemRadius)
  const scale = DISPLAY_RADIUS / safeRadius
  return [
    (point[0] - center[0]) * scale,
    (point[1] - center[1]) * scale,
    (point[2] - center[2]) * scale,
  ]
}

function planarRadius(point: readonly [number, number, number]) {
  return Math.hypot(point[0], point[2])
}

function createStarfieldTexture() {
  const size = 4096
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)

  const starCount = 1400
  for (let i = 0; i < starCount; i += 1) {
    const x = Math.floor(Math.random() * size)
    const y = Math.floor(Math.random() * size)
    const brightness = 180 + Math.floor(Math.random() * 75)
    const alpha = 0.4 + Math.random() * 0.6
    const pixelSize = Math.random() > 0.94 ? 2 : 1
    ctx.fillStyle = `rgba(${brightness},${brightness},${brightness},${alpha})`
    ctx.fillRect(x, y, pixelSize, pixelSize)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function createLensFlareTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  const center = size * 0.5
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0, 'rgba(255,255,255,0.85)')
  gradient.addColorStop(0.18, 'rgba(255,248,232,0.32)')
  gradient.addColorStop(0.42, 'rgba(255,240,214,0.12)')
  gradient.addColorStop(1, 'rgba(255,240,214,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function createSunCoreTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  const center = size * 0.5
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.16, 'rgba(255,255,255,0.98)')
  gradient.addColorStop(0.4, 'rgba(255,250,242,0.62)')
  gradient.addColorStop(0.72, 'rgba(255,245,228,0.18)')
  gradient.addColorStop(1, 'rgba(255,245,228,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function createSunHaloTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  const center = size * 0.5
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0, 'rgba(255,248,238,0.22)')
  gradient.addColorStop(0.2, 'rgba(255,246,234,0.16)')
  gradient.addColorStop(0.48, 'rgba(255,240,224,0.08)')
  gradient.addColorStop(0.78, 'rgba(255,235,214,0.028)')
  gradient.addColorStop(1, 'rgba(255,235,214,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function CameraRig({
  orbit,
  targetPosition,
}: {
  orbit: OrbitState
  targetPosition: DisplayPoint
}) {
  const { camera } = useThree()
  const target = useMemo(() => new THREE.Vector3(0, 0, 0), [])
  const desiredTarget = useMemo(() => new THREE.Vector3(0, 0, 0), [])

  useFrame(() => {
    const distance = orbit.distance ?? 10.5
    const cosPitch = Math.cos(orbit.pitch)
    desiredTarget.set(targetPosition[0], targetPosition[1], targetPosition[2])
    target.lerp(desiredTarget, 0.08)
    camera.position.set(
      target.x + Math.sin(orbit.yaw) * cosPitch * distance,
      target.y + Math.sin(orbit.pitch) * distance,
      target.z + Math.cos(orbit.yaw) * cosPitch * distance
    )
    camera.lookAt(target)
  })

  return null
}

function SkyDome({ texture }: { texture: THREE.Texture }) {
  const { camera } = useThree()
  const domeRef = useRef<THREE.Mesh>(null)

  useFrame(() => {
    if (!domeRef.current) return
    domeRef.current.position.copy(camera.position)
  })

  return (
    <mesh ref={domeRef} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[40, 48, 48]} />
      <meshBasicMaterial
        map={texture}
        side={THREE.BackSide}
        toneMapped={false}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  )
}

function RevealedTrackGeometry({
  hovered,
  onHoverChange,
  selected,
  track,
  time,
}: {
  hovered: boolean
  onHoverChange: (marker: HoveredMarker | null) => void
  selected: boolean
  track: RevealedTrack
  time: number
}) {
  const markerRef = useRef<THREE.Mesh>(null)
  const highlighted = hovered || selected

  useFrame(() => {
    if (!markerRef.current) return
    const pulse = 1 + Math.sin(time * 1.8 + track.orbitRadius) * (highlighted ? 0.2 : 0.12)
    markerRef.current.scale.setScalar(pulse)
  })

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[track.orbitRadius, 0.012, 10, 96]} />
        <meshBasicMaterial
          color={highlighted ? SELECT_BLUE : LINE_GREY}
          transparent
          opacity={highlighted ? 0.7 : 0.42}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        ref={markerRef}
        position={track.position}
        onPointerOut={() => onHoverChange(null)}
        onPointerOver={(event) => {
          event.stopPropagation()
          onHoverChange({
            id: track.id,
            name: track.name,
            bearingDeg: track.bearingDeg,
            distanceWorldUnits: track.distanceWorldUnits,
            inclinationDeg: track.inclinationDeg,
          })
        }}
      >
        <sphereGeometry args={[0.07, 14, 14]} />
        <meshBasicMaterial color={highlighted ? SELECT_BLUE : LINE_GREY} />
      </mesh>
      <mesh
        position={track.position}
        onPointerOut={() => onHoverChange(null)}
        onPointerOver={(event) => {
          event.stopPropagation()
          onHoverChange({
            id: track.id,
            name: track.name,
            bearingDeg: track.bearingDeg,
            distanceWorldUnits: track.distanceWorldUnits,
            inclinationDeg: track.inclinationDeg,
          })
        }}
      >
        <sphereGeometry args={[0.22, 14, 14]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

function ShipMarker({
  hovered,
  onHoverChange,
  position,
  selected,
  time,
}: {
  hovered: boolean
  onHoverChange: (marker: HoveredMarker | null) => void
  position: DisplayPoint
  selected: boolean
  time: number
}) {
  const markerRef = useRef<THREE.Mesh>(null)
  const highlighted = hovered || selected
  const markerPosition = useMemo<DisplayPoint>(
    () => [position[0], position[1] + SHIP_MARKER_HEIGHT_OFFSET, position[2]],
    [position]
  )

  useFrame(() => {
    if (markerRef.current) {
      const pulse = 1 + Math.sin(time * 2.1) * 0.25
      markerRef.current.scale.setScalar(pulse)
      markerRef.current.rotation.y += 0.015
    }
  })

  return (
    <group
      position={markerPosition}
      onPointerOut={() => onHoverChange(null)}
      onPointerOver={(event) => {
        event.stopPropagation()
        onHoverChange({
          bearingDeg: 0,
          id: 'ship',
          inclinationDeg: 0,
          name: 'Raven',
          distanceWorldUnits: 0,
        })
      }}
    >
      <mesh ref={markerRef} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.09, 0.24, 18]} />
        <meshBasicMaterial color={highlighted ? '#9fd4ff' : '#2f8fff'} />
      </mesh>
      <mesh
        onPointerOut={() => onHoverChange(null)}
        onPointerOver={(event) => {
          event.stopPropagation()
          onHoverChange({
            bearingDeg: 0,
            id: 'ship',
            inclinationDeg: 0,
            name: 'Raven',
            distanceWorldUnits: 0,
          })
        }}
      >
        <sphereGeometry args={[0.26, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

function SystemMapScene({
  hoveredMarkerId,
  onHoverChange,
  orbit,
  distance,
  revealedTracks,
  selectedMarkerId,
  selectedTargetPosition,
  shipPosition,
  time,
}: {
  hoveredMarkerId: string | null
  onHoverChange: (marker: HoveredMarker | null) => void
  orbit: OrbitState
  distance: number
  revealedTracks: RevealedTrack[]
  selectedMarkerId: string | null
  selectedTargetPosition: DisplayPoint
  shipPosition: DisplayPoint
  time: number
}) {
  const starCoreRef = useRef<THREE.Sprite>(null)
  const starHaloRef = useRef<THREE.Sprite>(null)
  const flareRef = useRef<THREE.Sprite>(null)
  const starfieldTexture = useMemo(() => createStarfieldTexture(), [])
  const sunCoreTexture = useMemo(() => createSunCoreTexture(), [])
  const sunHaloTexture = useMemo(() => createSunHaloTexture(), [])
  const flareTexture = useMemo(() => createLensFlareTexture(), [])

  useFrame(() => {
    const pulse = 1 + Math.sin(time * 0.8) * 0.04
    if (starCoreRef.current) {
      starCoreRef.current.scale.setScalar(0.72 + Math.sin(time * 1.2) * 0.02)
    }
    if (starHaloRef.current) {
      starHaloRef.current.scale.setScalar(1.6 * pulse)
    }
    if (flareRef.current) {
      flareRef.current.scale.setScalar(1.18 + Math.sin(time * 0.65) * 0.03)
      const material = flareRef.current.material as THREE.SpriteMaterial
      material.opacity = 0.115 + Math.sin(time * 0.9) * 0.015
    }
  })

  return (
    <>
      <color attach="background" args={[BG_SCREEN]} />
      <ambientLight intensity={0.5} />
      <pointLight position={[0, 0, 0]} intensity={30} distance={30} color="#ffcf7a" />
      <CameraRig orbit={{ ...orbit, distance }} targetPosition={selectedTargetPosition} />
      <SkyDome texture={starfieldTexture} />
      {revealedTracks.map((track) => (
        <RevealedTrackGeometry
          key={track.id}
          hovered={hoveredMarkerId === track.id}
          onHoverChange={onHoverChange}
          selected={selectedMarkerId === track.id}
          track={track}
          time={time}
        />
      ))}

      <group
        onPointerOut={() => onHoverChange(null)}
        onPointerOver={(event) => {
          event.stopPropagation()
          onHoverChange({
            bearingDeg: 0,
            id: 'star',
            inclinationDeg: 0,
            name: 'Dark Forest Prime',
            distanceWorldUnits: 0,
          })
        }}
      >
        <sprite ref={starHaloRef} scale={[1.6, 1.6, 1]} renderOrder={16}>
          <spriteMaterial
            map={sunHaloTexture}
            color={hoveredMarkerId === 'star' || selectedMarkerId === 'star' ? SELECT_BLUE : '#fff6e8'}
            blending={THREE.AdditiveBlending}
            transparent
            opacity={hoveredMarkerId === 'star' || selectedMarkerId === 'star' ? 0.52 : 0.32}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </sprite>
        <sprite ref={starCoreRef} scale={[0.72, 0.72, 1]} renderOrder={18}>
          <spriteMaterial
            map={sunCoreTexture}
            color={selectedMarkerId === 'star' ? '#d8ecff' : '#ffffff'}
            blending={THREE.AdditiveBlending}
            transparent
            opacity={0.98}
            depthWrite={false}
            depthTest={false}
            toneMapped={false}
          />
        </sprite>
        <mesh
          onPointerOut={() => onHoverChange(null)}
          onPointerOver={(event) => {
            event.stopPropagation()
            onHoverChange({
              bearingDeg: 0,
              id: 'star',
              inclinationDeg: 0,
              name: 'Dark Forest Prime',
              distanceWorldUnits: 0,
            })
          }}
        >
          <sphereGeometry args={[0.9, 18, 18]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <sprite ref={flareRef} scale={[1.18, 1.18, 1]} renderOrder={20}>
        <spriteMaterial
          map={flareTexture}
          color="#fff8ea"
          blending={THREE.AdditiveBlending}
          transparent
          opacity={0.085}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </sprite>

      <ShipMarker
        hovered={hoveredMarkerId === 'ship'}
        onHoverChange={onHoverChange}
        position={shipPosition}
        selected={selectedMarkerId === 'ship'}
        time={time}
      />
    </>
  )
}

export function EWSystemMap({ time }: { time: number }) {
  const dragRef = useRef<{
    pointerId: number
    lastX: number
    lastY: number
  } | null>(null)
  const dragMovedRef = useRef(false)
  const [activeTab, setActiveTab] = useState<MapTab>('MAP')
  const [orbit, setOrbit] = useState<OrbitState>({ yaw: -0.7, pitch: 0.62 })
  const [zoomDistance, setZoomDistance] = useState(10.5)
  const [isDragging, setIsDragging] = useState(false)
  const [hoveredMarker, setHoveredMarker] = useState<HoveredMarker | null>(null)
  const [hoveredMarkerPosition, setHoveredMarkerPosition] = useState({ x: 0, y: 0 })
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)

  const starSystem = useGameStore((s) => s.starSystem)
  const shipPosition = useGameStore((s) => s.ship.position)
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const warpState = useGameStore((s) => s.warpState)
  const warpSourceCelestialId = useGameStore((s) => s.warpSourceCelestialId)
  const warpTargetId = useGameStore((s) => s.warpTargetId)
  const warpTravelProgress = useGameStore((s) => s.warpTravelProgress)
  const revealedCelestialIds = useGameStore((s) => s.ewRevealedCelestialIds)

  const star = useMemo(
    () => getCelestialById('star', starSystem) ?? starSystem.celestials[0] ?? null,
    [starSystem]
  )

  const currentCelestial = useMemo(
    () => getCelestialById(currentCelestialId, starSystem),
    [currentCelestialId, starSystem]
  )

  const shipWorldPosition = useMemo<[number, number, number]>(() => {
    if (!currentCelestial) return [...shipPosition]
    return getWorldShipPosition(shipPosition, worldPositionForCelestial(currentCelestial))
  }, [currentCelestial, shipPosition])

  const warpSourceCelestial = useMemo(
    () => (warpSourceCelestialId ? getCelestialById(warpSourceCelestialId, starSystem) : null),
    [starSystem, warpSourceCelestialId]
  )
  const warpTargetCelestial = useMemo(
    () => (warpTargetId ? getCelestialById(warpTargetId, starSystem) : null),
    [starSystem, warpTargetId]
  )

  const stellarMapShipWorldPosition = useMemo<[number, number, number]>(() => {
    if (warpState === 'aligning') {
      if (warpSourceCelestial) return worldPositionForCelestial(warpSourceCelestial)
      if (currentCelestial) return worldPositionForCelestial(currentCelestial)
      return shipWorldPosition
    }

    if (warpState === 'warping' || warpState === 'landing') {
      if (warpSourceCelestial && warpTargetCelestial) {
        const sourceWorld = worldPositionForCelestial(warpSourceCelestial)
        const targetWorld = worldPositionForCelestial(warpTargetCelestial)
        const progress = Math.max(0, Math.min(1, warpTravelProgress))
        return [
          sourceWorld[0] + (targetWorld[0] - sourceWorld[0]) * progress,
          sourceWorld[1] + (targetWorld[1] - sourceWorld[1]) * progress,
          sourceWorld[2] + (targetWorld[2] - sourceWorld[2]) * progress,
        ]
      }
      if (warpTargetCelestial) return worldPositionForCelestial(warpTargetCelestial)
      return shipWorldPosition
    }

    if (!currentCelestial) return shipWorldPosition
    return worldPositionForCelestial(currentCelestial)
  }, [currentCelestial, shipWorldPosition, warpSourceCelestial, warpState, warpTargetCelestial, warpTravelProgress])

  const starWorldPosition = useMemo<[number, number, number]>(() => {
    if (!star) return [0, 0, 0]
    return worldPositionForCelestial(star)
  }, [star])

  const systemRadius = useMemo(() => {
    const distances = starSystem.celestials.map((celestial) => {
      const position = worldPositionForCelestial(celestial)
      return Math.hypot(
        position[0] - starWorldPosition[0],
        position[1] - starWorldPosition[1],
        position[2] - starWorldPosition[2]
      )
    })

    distances.push(
      Math.hypot(
        stellarMapShipWorldPosition[0] - starWorldPosition[0],
        stellarMapShipWorldPosition[1] - starWorldPosition[1],
        stellarMapShipWorldPosition[2] - starWorldPosition[2]
      )
    )

    return Math.max(4000, ...distances, 1)
  }, [starSystem.celestials, starWorldPosition, stellarMapShipWorldPosition])

  const shipDisplayPosition = useMemo(() => {
    const normalized = normalizePoint(stellarMapShipWorldPosition, starWorldPosition, systemRadius)
    return [normalized[0], 0, normalized[2]] as DisplayPoint
  }, [starWorldPosition, stellarMapShipWorldPosition, systemRadius])

  const revealedTracks = useMemo<RevealedTrack[]>(() => (
    starSystem.celestials
      .filter((celestial) =>
        celestial.type !== 'star' && (celestial.id === currentCelestialId || revealedCelestialIds.includes(celestial.id))
      )
      .map((celestial) => {
        const worldPosition = worldPositionForCelestial(celestial)
        const normalized = normalizePoint(worldPosition, starWorldPosition, systemRadius)
        const vectorToTarget = vectorBetweenWorldPoints(stellarMapShipWorldPosition, worldPosition)
        const distanceWorldUnits = vectorMagnitude(vectorToTarget)
        const { bearing, inclination } = bearingInclinationFromVector(vectorToTarget)
        return {
          bearingDeg: bearing,
          id: celestial.id,
          inclinationDeg: inclination,
          name: celestial.name,
          distanceWorldUnits,
          orbitRadius: Math.max(0.45, planarRadius([normalized[0], 0, normalized[2]])),
          position: [normalized[0], 0, normalized[2]] as DisplayPoint,
        }
      })
  ), [currentCelestialId, revealedCelestialIds, starSystem.celestials, starWorldPosition, stellarMapShipWorldPosition, systemRadius])

  const hoveredMarkerDetails = useMemo(() => {
    if (!hoveredMarker) return null

    if (hoveredMarker.id === 'ship') {
      return {
        bearingInclinationLabel: '(0, 0)',
        name: hoveredMarker.name,
        distanceLabel: '0 AU',
      }
    }

    if (hoveredMarker.id === 'star') {
      const vectorToStar = vectorBetweenWorldPoints(stellarMapShipWorldPosition, starWorldPosition)
      const distanceWorldUnits = vectorMagnitude(vectorToStar)
      const { bearing, inclination } = bearingInclinationFromVector(vectorToStar)
      return {
        bearingInclinationLabel: `(${Math.round(bearing)}, ${Math.round(inclination)})`,
        name: star?.name ?? hoveredMarker.name,
        distanceLabel: formatDistanceAu(distanceWorldUnits),
      }
    }

    return {
      bearingInclinationLabel: `(${Math.round(hoveredMarker.bearingDeg)}, ${Math.round(hoveredMarker.inclinationDeg)})`,
      name: hoveredMarker.name,
      distanceLabel: formatDistanceAu(hoveredMarker.distanceWorldUnits),
    }
  }, [hoveredMarker, star, starWorldPosition, stellarMapShipWorldPosition])

  const selectedTargetPosition = useMemo<DisplayPoint>(() => {
    if (selectedMarkerId === 'ship') {
      return shipDisplayPosition
    }
    if (selectedMarkerId === 'star') {
      return [0, 0, 0]
    }
    const selectedTrack = revealedTracks.find((track) => track.id === selectedMarkerId)
    return selectedTrack?.position ?? [0, 0, 0]
  }, [revealedTracks, selectedMarkerId, shipDisplayPosition])

  const rangeAu =
    Math.hypot(
      stellarMapShipWorldPosition[0] - starWorldPosition[0],
      stellarMapShipWorldPosition[1] - starWorldPosition[1],
      stellarMapShipWorldPosition[2] - starWorldPosition[2]
    ) / WORLD_UNITS_PER_AU

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeTab !== 'MAP') return
    if (hoveredMarker) return
    setHoveredMarker(null)
    dragMovedRef.current = false
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    }
    setIsDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHoveredMarkerPosition({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    })

    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return

    const dx = event.clientX - dragRef.current.lastX
    const dy = event.clientY - dragRef.current.lastY

    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    }
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      dragMovedRef.current = true
    }

    setOrbit((prev) => ({
      yaw: prev.yaw + dx * 0.008,
      pitch: clamp(prev.pitch + dy * 0.006, -1.15, 1.15),
    }))
  }

  const endDrag = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && dragRef.current && dragRef.current.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setIsDragging(false)
    if (event?.type === 'pointerleave') {
      setHoveredMarker(null)
    }
  }

  const handleClick = () => {
    if (activeTab !== 'MAP') return
    if (dragMovedRef.current) {
      dragMovedRef.current = false
      return
    }
    if (hoveredMarker) {
      setSelectedMarkerId(hoveredMarker.id)
      return
    }
    setSelectedMarkerId(null)
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (activeTab !== 'MAP') return
    event.preventDefault()
    setZoomDistance((prev) => clamp(prev + event.deltaY * 0.01, 6, 18))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 8px',
          borderBottom: `1px solid ${AMBER_DIM}55`,
          background: 'rgba(0,0,0,0.28)',
          flexShrink: 0,
        }}
      >
        {MAP_TABS.map((tab) => {
          const active = tab === activeTab
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '4px 10px',
                borderRadius: 1,
                border: `1px solid ${active ? AMBER : AMBER_DIM}`,
                background: active ? 'rgba(255,176,0,0.14)' : 'rgba(255,176,0,0.04)',
                color: active ? AMBER_GLOW : AMBER_DIM,
                fontFamily: "'Consolas', 'Monaco', monospace",
                fontSize: 10,
                letterSpacing: 1,
                cursor: 'pointer',
              }}
            >
              {tab}
            </button>
          )
        })}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 8,
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            background: BG_SCREEN,
            cursor: activeTab === 'MAP' ? (isDragging ? 'grabbing' : 'grab') : 'default',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerCancel={endDrag}
          onClick={handleClick}
          onWheel={handleWheel}
        >
          {activeTab === 'MAP' ? (
            <>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  border: '1px solid rgba(125,132,142,0.28)',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 14,
                  left: 16,
                  color: '#b7bec8',
                  fontFamily: "'Consolas', 'Monaco', monospace",
                  fontSize: 15,
                  letterSpacing: 1,
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              >
                STELLAR MAP
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: 14,
                  left: 16,
                  color: LINE_GREY,
                  fontFamily: "'Consolas', 'Monaco', monospace",
                  fontSize: 12,
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              >
                {`RANGE ${rangeAu.toFixed(1)} AU`}
              </div>
              {hoveredMarkerDetails ? (
                <div
                  style={{
                    position: 'absolute',
                    left: hoveredMarkerPosition.x + 14,
                    top: hoveredMarkerPosition.y + 14,
                    maxWidth: 240,
                    color: AMBER_GLOW,
                    fontFamily: "'Consolas', 'Monaco', monospace",
                    fontSize: 12,
                    pointerEvents: 'none',
                    zIndex: 2,
                    background: 'rgba(0,0,0,0.38)',
                    padding: '4px 8px',
                    border: `1px solid ${AMBER_DIM}77`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {`${hoveredMarkerDetails.name.toUpperCase()}  |  ${hoveredMarkerDetails.distanceLabel}  |  ${hoveredMarkerDetails.bearingInclinationLabel}`}
                </div>
              ) : null}
              <div
                style={{
                  position: 'absolute',
                  top: 14,
                  right: 16,
                  color: AMBER_GLOW,
                  fontFamily: "'Consolas', 'Monaco', monospace",
                  fontSize: 12,
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              >
                {`TRACKS ${revealedTracks.length}`}
              </div>
              <div
                style={{
                  position: 'absolute',
                  bottom: 14,
                  right: 16,
                  color: LINE_GREY,
                  fontFamily: "'Consolas', 'Monaco', monospace",
                  fontSize: 12,
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              >
                {`ORB ${orbit.yaw.toFixed(2)} / ${orbit.pitch.toFixed(2)}`}
              </div>
              <Canvas
                camera={{ fov: 45, near: 0.1, far: 50, position: [0, 4, 9] }}
                gl={{ antialias: true }}
                style={{ width: '100%', height: '100%' }}
              >
                <SystemMapScene
                  hoveredMarkerId={hoveredMarker?.id ?? null}
                  onHoverChange={setHoveredMarker}
                  orbit={orbit}
                  distance={zoomDistance}
                  revealedTracks={revealedTracks}
                  selectedMarkerId={selectedMarkerId}
                  selectedTargetPosition={selectedTargetPosition}
                  shipPosition={shipDisplayPosition}
                  time={time}
                />
              </Canvas>
            </>
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                border: '1px solid rgba(255,176,0,0.08)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: AMBER,
                fontFamily: "'Consolas', 'Monaco', monospace",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 30, fontWeight: 'bold' }}>{`${activeTab} MODE`}</div>
              <div style={{ fontSize: 18, color: AMBER_DIM }}>NO SENSOR PAGE INSTALLED</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
