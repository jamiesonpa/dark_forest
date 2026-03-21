import {
  useEffect,
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
import { B_SCOPE_AZ_LIMIT_DEG, B_SCOPE_RANGE_OPTIONS_KM } from '@/systems/ew/bScopeConstants'
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

const B_SCOPE_MIN_VIEW_SPAN_DEG = 12
const B_SCOPE_AZ_GRID_STEP_DEG = 5
const B_SCOPE_GREEN = '#44ff66'
const B_SCOPE_GREEN_DIM = '#1f8a39'
const B_SCOPE_GREEN_GLOW = '#88ffaa'

/** MAP / RADAR views only; TV is handled on `EWConsole` MFD. */
export type EwSystemMapMfdTab = 'MAP' | 'RADAR'

type BScopeTrack = {
  id: string
  label: string
  absBearingDeg: number
  relInclinationDeg: number
  rangeM: number
  relBearingDeg: number
}

type OrbitState = {
  yaw: number
  pitch: number
  distance?: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizeBearingDeg(value: number) {
  return ((value % 360) + 360) % 360
}

type DisplayPoint = [number, number, number]
type RevealedTrack = {
  bearingDeg: number
  inclinationDeg: number
  id: string
  name: string
  distanceWorldUnits: number
  orbitPathPoints: DisplayPoint[]
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

function normalizeRelativePoint(
  relativePoint: readonly [number, number, number],
  systemRadius: number
): DisplayPoint {
  const safeRadius = Math.max(1, systemRadius)
  const scale = DISPLAY_RADIUS / safeRadius
  return [
    relativePoint[0] * scale,
    relativePoint[1] * scale,
    relativePoint[2] * scale,
  ]
}

function planarRadius(point: readonly [number, number, number]) {
  return Math.hypot(point[0], point[2])
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function normalizeVector(vector: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(vector[0], vector[1], vector[2])
  if (len < 1e-6) return [0, 0, 1]
  return [vector[0] / len, vector[1] / len, vector[2] / len]
}

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function buildOrbitPathPoints(
  orbitId: string,
  starWorldPosition: readonly [number, number, number],
  fallbackWorldPosition: readonly [number, number, number],
  systemRadius: number,
  referenceFrameRotation: THREE.Quaternion,
  orbitalElements?: {
    semiMajorAxisAu: number
    eccentricity: number
    inclinationDeg: number
    ascendingNodeDeg: number
    argumentOfPeriapsisDeg: number
  }
) {
  const pointCount = 128
  const points: DisplayPoint[] = []

  if (!orbitalElements) {
    const relativeWorld: [number, number, number] = [
      fallbackWorldPosition[0] - starWorldPosition[0],
      fallbackWorldPosition[1] - starWorldPosition[1],
      fallbackWorldPosition[2] - starWorldPosition[2],
    ]
    const relativeVector = new THREE.Vector3(relativeWorld[0], relativeWorld[1], relativeWorld[2])
    relativeVector.applyQuaternion(referenceFrameRotation)
    const relative: [number, number, number] = [relativeVector.x, relativeVector.y, relativeVector.z]
    const relMag = Math.hypot(relative[0], relative[1], relative[2])
    if (relMag < 1e-6) {
      const fallbackNormalized = normalizePoint(fallbackWorldPosition, starWorldPosition, systemRadius)
      const fallbackRadius = Math.max(0.45, planarRadius(fallbackNormalized))
      for (let i = 0; i <= pointCount; i += 1) {
        const t = (i / pointCount) * Math.PI * 2
        points.push([
          Math.cos(t) * fallbackRadius,
          0,
          Math.sin(t) * fallbackRadius,
        ])
      }
      return points
    }

    if (orbitId === 'planet-1') {
      const referenceRadius = Math.max(0.45, Math.hypot(relative[0], relative[2]))
      for (let i = 0; i <= pointCount; i += 1) {
        const t = (i / pointCount) * Math.PI * 2
        points.push([
          (Math.cos(t) * referenceRadius / Math.max(1, systemRadius)) * DISPLAY_RADIUS,
          0,
          (Math.sin(t) * referenceRadius / Math.max(1, systemRadius)) * DISPLAY_RADIUS,
        ])
      }
      return points
    }

    const hash = stableHash(orbitId)
    const axisCandidate = normalizeVector([
      ((hash & 1023) / 511.5) - 1,
      (((hash >>> 10) & 1023) / 511.5) - 1,
      (((hash >>> 20) & 1023) / 511.5) - 1,
    ])
    let orbitNormal = cross(relative, axisCandidate)
    if (Math.hypot(orbitNormal[0], orbitNormal[1], orbitNormal[2]) < 1e-4) {
      orbitNormal = cross(relative, [0, 1, 0])
    }
    if (Math.hypot(orbitNormal[0], orbitNormal[1], orbitNormal[2]) < 1e-4) {
      orbitNormal = cross(relative, [1, 0, 0])
    }
    const n = normalizeVector(orbitNormal)
    const nCrossR = cross(n, relative)

    for (let i = 0; i <= pointCount; i += 1) {
      const t = (i / pointCount) * Math.PI * 2
      const cosT = Math.cos(t)
      const sinT = Math.sin(t)
      const x = relative[0] * cosT + nCrossR[0] * sinT
      const y = relative[1] * cosT + nCrossR[1] * sinT
      const z = relative[2] * cosT + nCrossR[2] * sinT
      points.push(normalizeRelativePoint([x, y, z], systemRadius))
    }
    return points
  }

  const semiMajorAxisUnits = orbitalElements.semiMajorAxisAu * WORLD_UNITS_PER_AU
  const eccentricity = clamp(orbitalElements.eccentricity, 0, 0.9)
  const inclination = (orbitalElements.inclinationDeg * Math.PI) / 180
  const ascendingNode = (orbitalElements.ascendingNodeDeg * Math.PI) / 180
  const argumentOfPeriapsis = (orbitalElements.argumentOfPeriapsisDeg * Math.PI) / 180
  const cosNode = Math.cos(ascendingNode)
  const sinNode = Math.sin(ascendingNode)
  const cosInclination = Math.cos(inclination)
  const sinInclination = Math.sin(inclination)

  for (let i = 0; i <= pointCount; i += 1) {
    const trueAnomaly = (i / pointCount) * Math.PI * 2
    const denominator = 1 + eccentricity * Math.cos(trueAnomaly)
    const orbitRadiusUnits =
      Math.abs(denominator) <= 1e-6
        ? semiMajorAxisUnits
        : (semiMajorAxisUnits * (1 - eccentricity * eccentricity)) / denominator
    const argumentOfLatitude = argumentOfPeriapsis + trueAnomaly
    const cosU = Math.cos(argumentOfLatitude)
    const sinU = Math.sin(argumentOfLatitude)
    const x = orbitRadiusUnits * (cosNode * cosU - sinNode * sinU * cosInclination)
    const y = orbitRadiusUnits * (sinU * sinInclination)
    const z = orbitRadiusUnits * (sinNode * cosU + cosNode * sinU * cosInclination)
    const orbitWorld = new THREE.Vector3(x, y, z)
    orbitWorld.applyQuaternion(referenceFrameRotation)
    points.push(
      normalizeRelativePoint([orbitWorld.x, orbitWorld.y, orbitWorld.z], systemRadius)
    )
  }
  return points
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
  const orbitLinePositions = useMemo(
    () => new Float32Array(track.orbitPathPoints.flatMap((point) => point)),
    [track.orbitPathPoints]
  )

  useFrame(() => {
    if (!markerRef.current) return
    const pulse = 1 + Math.sin(time * 1.8 + track.distanceWorldUnits * 0.00014) * (highlighted ? 0.2 : 0.12)
    markerRef.current.scale.setScalar(pulse)
  })

  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[orbitLinePositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={highlighted ? SELECT_BLUE : LINE_GREY}
          transparent
          opacity={highlighted ? 0.72 : 0.45}
        />
      </line>
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
  primaryStarName,
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
  primaryStarName: string
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
            name: primaryStarName,
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
              name: primaryStarName,
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

export function EWSystemMap({ time, mfdTab }: { time: number; mfdTab: EwSystemMapMfdTab }) {
  const dragRef = useRef<{
    pointerId: number
    lastX: number
    lastY: number
  } | null>(null)
  const dragMovedRef = useRef(false)
  const [bScopeRangeIdx, setBScopeRangeIdx] = useState(B_SCOPE_RANGE_OPTIONS_KM.length - 1)
  const [bScopeBearingMode, setBScopeBearingMode] = useState<'REL' | 'ABS'>('REL')
  const [bScopeViewMinDeg, setBScopeViewMinDeg] = useState(-B_SCOPE_AZ_LIMIT_DEG)
  const [bScopeViewMaxDeg, setBScopeViewMaxDeg] = useState(B_SCOPE_AZ_LIMIT_DEG)
  const [bScopeCursor, setBScopeCursor] = useState<{ xPct: number; yPct: number } | null>(null)
  const [orbit, setOrbit] = useState<OrbitState>({ yaw: -0.7, pitch: 0.62 })
  const [zoomDistance, setZoomDistance] = useState(10.5)
  const [isDragging, setIsDragging] = useState(false)
  const [hoveredMarker, setHoveredMarker] = useState<HoveredMarker | null>(null)
  const [hoveredMarkerPosition, setHoveredMarkerPosition] = useState({ x: 0, y: 0 })
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)

  const starSystem = useGameStore((s) => s.starSystem)
  const shipsById = useGameStore((s) => s.shipsById)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const shipPosition = useGameStore((s) => s.ship.position)
  const shipHeadingDeg = useGameStore((s) => s.ship.actualHeading)
  const ewLockState = useGameStore((s) => s.ewLockState)
  const setEwLockState = useGameStore((s) => s.setEwLockState)
  const ewRadarOn = useGameStore((s) => s.ewRadarOn)
  const ewRadarPower = useGameStore((s) => s.ewRadarPower)
  const setEwRadar = useGameStore((s) => s.setEwRadar)
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const warpState = useGameStore((s) => s.warpState)
  const warpSourceCelestialId = useGameStore((s) => s.warpSourceCelestialId)
  const warpTargetId = useGameStore((s) => s.warpTargetId)
  const warpTravelProgress = useGameStore((s) => s.warpTravelProgress)
  const revealedCelestialIds = useGameStore((s) => s.ewRevealedCelestialIds)
  const radarWarpInterference = warpState === 'warping' || warpState === 'landing'
  const radarOperational = ewRadarOn && !radarWarpInterference

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

  const referenceFrameRotation = useMemo(() => {
    const up = new THREE.Vector3(0, 1, 0)
    const reference = getCelestialById('planet-1', starSystem)
    const orbital = reference?.orbitalElements
    if (!orbital) return new THREE.Quaternion()
    const inclination = (orbital.inclinationDeg * Math.PI) / 180
    const ascendingNode = (orbital.ascendingNodeDeg * Math.PI) / 180
    const sinInclination = Math.sin(inclination)
    const normal = new THREE.Vector3(
      Math.sin(ascendingNode) * sinInclination,
      Math.cos(inclination),
      Math.cos(ascendingNode) * sinInclination
    ).normalize()
    const rotation = new THREE.Quaternion()
    rotation.setFromUnitVectors(normal, up)
    return rotation
  }, [starSystem])

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
    const relative = new THREE.Vector3(
      stellarMapShipWorldPosition[0] - starWorldPosition[0],
      stellarMapShipWorldPosition[1] - starWorldPosition[1],
      stellarMapShipWorldPosition[2] - starWorldPosition[2]
    )
    relative.applyQuaternion(referenceFrameRotation)
    return normalizeRelativePoint([relative.x, relative.y, relative.z], systemRadius)
  }, [referenceFrameRotation, starWorldPosition, stellarMapShipWorldPosition, systemRadius])

  const revealedTracks = useMemo<RevealedTrack[]>(() => (
    starSystem.celestials
      .filter((celestial) =>
        celestial.type !== 'star' && (celestial.id === currentCelestialId || revealedCelestialIds.includes(celestial.id))
      )
      .map((celestial) => {
        const worldPosition = worldPositionForCelestial(celestial)
        const worldRelative = new THREE.Vector3(
          worldPosition[0] - starWorldPosition[0],
          worldPosition[1] - starWorldPosition[1],
          worldPosition[2] - starWorldPosition[2]
        )
        worldRelative.applyQuaternion(referenceFrameRotation)
        const normalized = normalizeRelativePoint([worldRelative.x, worldRelative.y, worldRelative.z], systemRadius)
        const vectorToTarget = vectorBetweenWorldPoints(stellarMapShipWorldPosition, worldPosition)
        const distanceWorldUnits = vectorMagnitude(vectorToTarget)
        const { bearing, inclination } = bearingInclinationFromVector(vectorToTarget)
        return {
          bearingDeg: bearing,
          id: celestial.id,
          inclinationDeg: inclination,
          name: celestial.name,
          distanceWorldUnits,
          orbitPathPoints: buildOrbitPathPoints(
            celestial.id,
            starWorldPosition,
            worldPosition,
            systemRadius,
            referenceFrameRotation,
            celestial.orbitalElements
          ),
          position: normalized,
        }
      })
  ), [currentCelestialId, referenceFrameRotation, revealedCelestialIds, starSystem.celestials, starWorldPosition, stellarMapShipWorldPosition, systemRadius])

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
  const bScopeRangeKm = B_SCOPE_RANGE_OPTIONS_KM[bScopeRangeIdx] ?? 160
  const bScopeMaxRangeM = bScopeRangeKm * 1000
  const bScopeAbsoluteMaxRangeKm = B_SCOPE_RANGE_OPTIONS_KM[B_SCOPE_RANGE_OPTIONS_KM.length - 1] ?? bScopeRangeKm
  const bScopeAbsoluteMaxRangeM = bScopeAbsoluteMaxRangeKm * 1000
  const radarPowerClamped = clamp(ewRadarPower, 0, 100)
  const radarPowerNorm = radarPowerClamped / 100
  const bScopeDetectionRangeAbsM = bScopeAbsoluteMaxRangeM * (0.15 + radarPowerNorm * 0.85)
  const bScopeDetectionRangeDisplayM = Math.min(bScopeDetectionRangeAbsM, bScopeMaxRangeM)
  const bScopeDetectionRangePct = clamp((bScopeDetectionRangeDisplayM / Math.max(1, bScopeMaxRangeM)) * 100, 0, 100)
  const bScopeViewSpanDeg = Math.max(1, bScopeViewMaxDeg - bScopeViewMinDeg)
  const bScopeAzTicks = useMemo(() => {
    const start = Math.ceil(bScopeViewMinDeg / B_SCOPE_AZ_GRID_STEP_DEG) * B_SCOPE_AZ_GRID_STEP_DEG
    const ticks: number[] = []
    for (let tick = start; tick <= bScopeViewMaxDeg; tick += B_SCOPE_AZ_GRID_STEP_DEG) {
      ticks.push(tick)
    }
    if (!ticks.includes(0) && bScopeViewMinDeg < 0 && bScopeViewMaxDeg > 0) {
      ticks.push(0)
      ticks.sort((a, b) => a - b)
    }
    return ticks
  }, [bScopeViewMaxDeg, bScopeViewMinDeg])

  const bScopeAllTracks = useMemo<BScopeTrack[]>(() => {
    const tracks: BScopeTrack[] = []
    let npcIdx = 0
    let remoteIdx = 0

    for (const [id, ship] of Object.entries(shipsById)) {
      if (id === localPlayerId) continue
      if (ship.currentCelestialId !== currentCelestialId) continue
      if (ship.inWarpTransit) continue

      const isNpc = id.startsWith('npc-')
      const label = isNpc ? `N${++npcIdx}` : `P${++remoteIdx}`

      const dx = ship.position[0] - shipPosition[0]
      const dy = ship.position[1] - shipPosition[1]
      const dz = ship.position[2] - shipPosition[2]
      const rangeM = Math.hypot(dx, dz)
      const { bearing: bearingDeg, inclination: relInclinationDeg } =
        bearingInclinationFromVector([dx, dy, dz])
      const relBearingDeg = ((bearingDeg - shipHeadingDeg + 540) % 360) - 180
      tracks.push({
        id,
        label,
        absBearingDeg: bearingDeg,
        relInclinationDeg,
        rangeM,
        relBearingDeg,
      })
    }

    return tracks
  }, [currentCelestialId, localPlayerId, shipHeadingDeg, shipPosition, shipsById])

  const bScopeTracks = useMemo<BScopeTrack[]>(() => {
    if (!radarOperational) return []
    return bScopeAllTracks.filter(
      (track) =>
        !track.id.startsWith('planet-')
        && !track.id.startsWith('moon-')
        && !track.id.startsWith('asteroid-')
        && track.id !== 'star'
        && track.id !== 'sun'
        &&
        track.relBearingDeg >= bScopeViewMinDeg
        && track.relBearingDeg <= bScopeViewMaxDeg
        && track.rangeM <= bScopeMaxRangeM
        && track.rangeM <= bScopeDetectionRangeAbsM
    )
  }, [bScopeAllTracks, bScopeDetectionRangeAbsM, bScopeMaxRangeM, bScopeViewMaxDeg, bScopeViewMinDeg, radarOperational])
  const bScopeTargetTracks = useMemo(
    () => (radarOperational ? bScopeAllTracks.filter((track) => track.rangeM <= bScopeDetectionRangeAbsM) : []),
    [bScopeAllTracks, bScopeDetectionRangeAbsM, radarOperational]
  )
  const bScopeNearestTarget = useMemo(() => {
    if (bScopeTargetTracks.length === 0) return null
    return [...bScopeTargetTracks].sort((a, b) => a.rangeM - b.rangeM)[0] ?? null
  }, [bScopeTargetTracks])
  const bScopeTrackRelBearingById = useMemo<Record<string, number>>(() => {
    const byId: Record<string, number> = {}
    bScopeAllTracks.forEach((track) => {
      byId[track.id] = track.relBearingDeg
    })
    return byId
  }, [bScopeAllTracks])

  useEffect(() => {
    if (!radarOperational) {
      setEwLockState((prev) => {
        if (Object.keys(prev).length === 0) return prev
        return {}
      })
      return
    }
    setEwLockState((prev) => {
      const lockIds = Object.keys(prev)
      if (lockIds.length === 0) return prev
      let changed = false
      const next = { ...prev }
      lockIds.forEach((lockId) => {
        const relBearing = bScopeTrackRelBearingById[lockId]
        if (relBearing === undefined || Math.abs(relBearing) > B_SCOPE_AZ_LIMIT_DEG) {
          delete next[lockId]
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [bScopeTrackRelBearingById, ewLockState, radarOperational, setEwLockState])

  const handleBScopeWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!radarOperational) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const mouseXNorm = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1)
    const currentSpan = bScopeViewSpanDeg
    const zoomFactor = event.deltaY < 0 ? 0.86 : 1.18
    const nextSpan = clamp(currentSpan * zoomFactor, B_SCOPE_MIN_VIEW_SPAN_DEG, B_SCOPE_AZ_LIMIT_DEG * 2)
    const mouseAzDeg = bScopeViewMinDeg + mouseXNorm * currentSpan

    let nextMin = mouseAzDeg - mouseXNorm * nextSpan
    let nextMax = nextMin + nextSpan

    if (nextMin < -B_SCOPE_AZ_LIMIT_DEG) {
      const shift = -B_SCOPE_AZ_LIMIT_DEG - nextMin
      nextMin += shift
      nextMax += shift
    }
    if (nextMax > B_SCOPE_AZ_LIMIT_DEG) {
      const shift = nextMax - B_SCOPE_AZ_LIMIT_DEG
      nextMin -= shift
      nextMax -= shift
    }

    setBScopeViewMinDeg(nextMin)
    setBScopeViewMaxDeg(nextMax)
  }
  const bScopeLeftAbsDeg = normalizeBearingDeg(shipHeadingDeg + bScopeViewMinDeg)
  const bScopeCenterAbsDeg = normalizeBearingDeg(shipHeadingDeg + (bScopeViewMinDeg + bScopeViewMaxDeg) * 0.5)
  const bScopeRightAbsDeg = normalizeBearingDeg(shipHeadingDeg + bScopeViewMaxDeg)
  const bScopeCursorRelBearingDeg = bScopeCursor
    ? bScopeViewMinDeg + (bScopeCursor.xPct / 100) * bScopeViewSpanDeg
    : null
  const bScopeCursorAbsBearingDeg = bScopeCursorRelBearingDeg === null
    ? null
    : normalizeBearingDeg(shipHeadingDeg + bScopeCursorRelBearingDeg)
  const bScopeCursorRangeKm = bScopeCursor
    ? clamp((1 - bScopeCursor.yPct / 100) * bScopeRangeKm, 0, bScopeRangeKm)
    : null
  const bScopeCursorBearingLabel = bScopeCursorRelBearingDeg === null
    ? null
    : bScopeBearingMode === 'REL'
      ? bScopeCursorRelBearingDeg < 0
        ? `L${Math.round(Math.abs(bScopeCursorRelBearingDeg))}`
        : `R${Math.round(bScopeCursorRelBearingDeg)}`
      : String(Math.round(bScopeCursorAbsBearingDeg ?? 0)).padStart(3, '0')

  useEffect(() => {
    const shouldRadarBeOn = radarPowerClamped > 0
    if (ewRadarOn === shouldRadarBeOn) return
    setEwRadar({ radarOn: shouldRadarBeOn })
  }, [ewRadarOn, radarPowerClamped, setEwRadar])

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (mfdTab !== 'MAP') return
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
    if (mfdTab !== 'MAP') return
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
    if (mfdTab !== 'MAP') return
    event.preventDefault()
    setZoomDistance((prev) => clamp(prev + event.deltaY * 0.01, 6, 18))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
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
            cursor: mfdTab === 'MAP' ? (isDragging ? 'grabbing' : 'grab') : 'default',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerCancel={endDrag}
          onClick={handleClick}
          onWheel={handleWheel}
        >
          {mfdTab === 'MAP' ? (
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
                  primaryStarName={star?.name ?? 'STAR'}
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
                alignItems: 'center',
                justifyContent: 'center',
                color: AMBER,
                fontFamily: "'Consolas', 'Monaco', monospace",
              }}
            >
              <div
                style={{
                  width: '68%',
                  height: '78%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 6 }}>
                  <div
                    style={{
                      width: 64,
                    border: `1px solid ${B_SCOPE_GREEN_DIM}77`,
                      background: 'rgba(0,0,0,0.38)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 6px',
                      flexShrink: 0,
                    }}
                  >
                  <span style={{ fontSize: 9, color: B_SCOPE_GREEN_DIM, letterSpacing: 1 }}>RNG</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => setBScopeRangeIdx((prev) => Math.min(B_SCOPE_RANGE_OPTIONS_KM.length - 1, prev + 1))}
                      disabled={bScopeRangeIdx >= B_SCOPE_RANGE_OPTIONS_KM.length - 1}
                      style={{
                        width: 30,
                        height: 22,
                        border: `1px solid ${B_SCOPE_GREEN_DIM}`,
                        background: 'rgba(68,255,102,0.08)',
                        color: B_SCOPE_GREEN_GLOW,
                        fontFamily: "'Consolas', 'Monaco', monospace",
                        fontSize: 12,
                        lineHeight: 1,
                        cursor: bScopeRangeIdx >= B_SCOPE_RANGE_OPTIONS_KM.length - 1 ? 'not-allowed' : 'pointer',
                        opacity: bScopeRangeIdx >= B_SCOPE_RANGE_OPTIONS_KM.length - 1 ? 0.45 : 1,
                      }}
                      aria-label="Increase B-scope range scale"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => setBScopeRangeIdx((prev) => Math.max(0, prev - 1))}
                      disabled={bScopeRangeIdx <= 0}
                      style={{
                        width: 30,
                        height: 22,
                        border: `1px solid ${B_SCOPE_GREEN_DIM}`,
                        background: 'rgba(68,255,102,0.08)',
                        color: B_SCOPE_GREEN_GLOW,
                        fontFamily: "'Consolas', 'Monaco', monospace",
                        fontSize: 14,
                        lineHeight: 1,
                        cursor: bScopeRangeIdx <= 0 ? 'not-allowed' : 'pointer',
                        opacity: bScopeRangeIdx <= 0 ? 0.45 : 1,
                      }}
                      aria-label="Decrease B-scope range scale"
                    >
                      -
                    </button>
                  </div>
                  <span style={{ fontSize: 10, color: B_SCOPE_GREEN_GLOW, letterSpacing: 0.5 }}>
                      {`${bScopeRangeKm}km`}
                    </span>
                  </div>
                  <div
                    style={{
                      flex: 1,
                    border: `1px solid ${B_SCOPE_GREEN_DIM}55`,
                      background: 'rgba(0,0,0,0.38)',
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '10px 12px',
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        color: B_SCOPE_GREEN_GLOW,
                        fontSize: 12,
                        letterSpacing: 1,
                      }}
                    >
                      <span>B-SCOPE</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: B_SCOPE_GREEN_DIM }}>
                          {`PWR ${ewRadarOn ? 'ON' : 'OFF'} | AZ ${bScopeViewSpanDeg.toFixed(0)}° | RNG ${bScopeRangeKm}km`}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (ewRadarOn) {
                              setEwRadar({ radarOn: false, radarPower: 0 })
                              return
                            }
                            setEwRadar({ radarOn: true, radarPower: Math.max(1, radarPowerClamped) })
                          }}
                          style={{
                            minWidth: 84,
                            padding: '2px 8px',
                            border: `1px solid ${B_SCOPE_GREEN_DIM}77`,
                            background: ewRadarOn ? 'rgba(68,255,102,0.16)' : 'rgba(0,0,0,0.35)',
                            color: ewRadarOn ? B_SCOPE_GREEN_GLOW : B_SCOPE_GREEN_DIM,
                            fontFamily: "'Consolas', 'Monaco', monospace",
                            fontSize: 10,
                            letterSpacing: 1,
                            cursor: 'pointer',
                          }}
                          aria-label={ewRadarOn ? 'Turn radar off' : 'Turn radar on'}
                        >
                          {`RADAR ${ewRadarOn ? 'ON' : 'OFF'}`}
                        </button>
                      </div>
                    </div>
                    <div
                      style={{
                        color: B_SCOPE_GREEN_DIM,
                        fontSize: 10,
                        letterSpacing: 0.3,
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>
                        {bScopeNearestTarget
                          ? `nearest ${bScopeNearestTarget.label} brg:${Math.round(bScopeNearestTarget.relBearingDeg)} rng:${(bScopeNearestTarget.rangeM / 1000).toFixed(1)}km`
                          : 'nearest -'}
                      </span>
                    </div>

                    <div
                      style={{
                        position: 'relative',
                        flex: 1,
                        border: `1px solid ${B_SCOPE_GREEN_DIM}55`,
                        background: BG_SCREEN,
                        overflow: 'hidden',
                      }}
                      onWheel={handleBScopeWheel}
                      onMouseMove={(event) => {
                        const bounds = event.currentTarget.getBoundingClientRect()
                        const xPct = clamp(((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 100, 0, 100)
                        const yPct = clamp(((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 100, 0, 100)
                        setBScopeCursor({ xPct, yPct })
                      }}
                      onMouseLeave={() => {
                        setBScopeCursor(null)
                      }}
                      onContextMenu={(event) => {
                        if (!radarOperational) return
                        event.preventDefault()
                        setEwLockState((prev) => {
                          const next = { ...prev }
                          Object.keys(next).forEach((id) => {
                            if (next[id] === 'hard') {
                              delete next[id]
                            }
                          })
                          return next
                        })
                      }}
                    >
                      {radarWarpInterference ? (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0,0,0,0.62)',
                            color: B_SCOPE_GREEN_GLOW,
                            fontSize: 12,
                            letterSpacing: 1,
                            textAlign: 'center',
                            padding: '0 20px',
                            zIndex: 5,
                            pointerEvents: 'none',
                          }}
                        >
                          RADAR INOPERABLE DURING WARP TRANSIT
                        </div>
                      ) : !ewRadarOn ? (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: 'rgba(0,0,0,0.62)',
                            color: B_SCOPE_GREEN_GLOW,
                            fontSize: 12,
                            letterSpacing: 1,
                            textAlign: 'center',
                            padding: '0 20px',
                            zIndex: 5,
                            pointerEvents: 'none',
                          }}
                        >
                          RADAR STANDBY - POWER ON TO SCAN
                        </div>
                      ) : null}
                      {radarOperational ? (
                        <>
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              top: 0,
                              bottom: `${bScopeDetectionRangePct}%`,
                              background: 'rgba(0,0,0,0.32)',
                              pointerEvents: 'none',
                            }}
                          />
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              bottom: `${bScopeDetectionRangePct}%`,
                              borderTop: `1px dotted ${B_SCOPE_GREEN_GLOW}`,
                              opacity: 0.95,
                              pointerEvents: 'none',
                            }}
                          />
                        </>
                      ) : null}
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: 0,
                          bottom: 0,
                          width: 1,
                        background: 'rgba(68,255,102,0.28)',
                        }}
                      />
                      {bScopeAzTicks.map((tickDeg) => (
                        <div
                          key={`az-${tickDeg}`}
                          style={{
                            position: 'absolute',
                            left: `${((tickDeg - bScopeViewMinDeg) / bScopeViewSpanDeg) * 100}%`,
                            top: 0,
                            bottom: 0,
                            width: 1,
                          background: tickDeg === 0 ? 'rgba(68,255,102,0.3)' : 'rgba(68,255,102,0.14)',
                          }}
                        />
                      ))}
                      {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                        const rangeKm = Math.round((step * bScopeRangeKm) / 10) * 10
                        return (
                          <div key={`rng-${step}`}>
                            <div
                              style={{
                                position: 'absolute',
                                left: 0,
                                right: 0,
                                bottom: `${step * 100}%`,
                                height: 1,
                                background: step === 0 ? 'rgba(68,255,102,0.28)' : 'rgba(68,255,102,0.1)',
                              }}
                            />
                            <div
                              style={{
                                position: 'absolute',
                                left: 6,
                                bottom: `${step * 100}%`,
                                transform: step === 0 ? 'translateY(0)' : step === 1 ? 'translateY(-100%)' : 'translateY(50%)',
                                color: B_SCOPE_GREEN_DIM,
                                fontSize: 11,
                                letterSpacing: 0.3,
                                pointerEvents: 'none',
                              }}
                            >
                              {`${rangeKm} km`}
                            </div>
                          </div>
                        )
                      })}
                      {bScopeCursor ? (
                        <>
                          <div
                            style={{
                              position: 'absolute',
                              left: `${bScopeCursor.xPct}%`,
                              top: 0,
                              bottom: 0,
                              width: 1,
                              background: 'rgba(136,255,170,0.42)',
                              boxShadow: `0 0 8px ${B_SCOPE_GREEN_DIM}`,
                              zIndex: 4,
                              pointerEvents: 'none',
                            }}
                          />
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              top: `${bScopeCursor.yPct}%`,
                              height: 1,
                              background: 'rgba(136,255,170,0.42)',
                              boxShadow: `0 0 8px ${B_SCOPE_GREEN_DIM}`,
                              zIndex: 4,
                              pointerEvents: 'none',
                            }}
                          />
                          {bScopeCursorBearingLabel ? (
                            <div
                              style={{
                                position: 'absolute',
                                left: `${bScopeCursor.xPct}%`,
                                bottom: 2,
                                transform: 'translateX(-50%)',
                                color: B_SCOPE_GREEN_GLOW,
                                border: `1px solid ${B_SCOPE_GREEN_DIM}aa`,
                                background: 'rgba(0,0,0,0.82)',
                                padding: '1px 5px',
                                fontSize: 10,
                                letterSpacing: 0.3,
                                zIndex: 6,
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {bScopeCursorBearingLabel}
                            </div>
                          ) : null}
                          {bScopeCursorRangeKm !== null ? (
                            <div
                              style={{
                                position: 'absolute',
                                left: 2,
                                top: `${bScopeCursor.yPct}%`,
                                transform: 'translateY(-50%)',
                                color: B_SCOPE_GREEN_GLOW,
                                border: `1px solid ${B_SCOPE_GREEN_DIM}aa`,
                                background: 'rgba(0,0,0,0.82)',
                                padding: '1px 5px',
                                fontSize: 10,
                                letterSpacing: 0.3,
                                zIndex: 6,
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {`${bScopeCursorRangeKm.toFixed(1)} km`}
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      {bScopeTracks.map((track) => {
                        const xPct =
                          ((track.relBearingDeg - bScopeViewMinDeg) / bScopeViewSpanDeg) * 100
                        const yPct = (track.rangeM / bScopeMaxRangeM) * 100
                        const incLabel = `${track.relInclinationDeg >= 0 ? '+' : ''}${Math.round(track.relInclinationDeg)}`
                        const isHardLocked = ewLockState[track.id] === 'hard'
                        const trackColor = isHardLocked ? '#f4f7ff' : B_SCOPE_GREEN
                        const trackGlow = isHardLocked ? '#ffffff' : B_SCOPE_GREEN_DIM
                        return (
                          <div key={track.id}>
                            <div
                              style={{
                                position: 'absolute',
                                left: `${xPct}%`,
                                bottom: `${yPct}%`,
                                transform: 'translate(-50%, 50%)',
                                width: 16,
                                height: 10,
                                border: `1px solid ${trackColor}`,
                                background: isHardLocked ? 'rgba(255,255,255,0.12)' : 'rgba(68,255,102,0.17)',
                                boxShadow: `0 0 8px ${trackGlow}`,
                                color: trackColor,
                                fontSize: 9,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'crosshair',
                              }}
                              title={`${track.label} | BRG ${track.relBearingDeg.toFixed(0)}° | RNG ${(track.rangeM / 1000).toFixed(1)}km | INC ${incLabel}`}
                              onContextMenu={(event) => {
                                if (!radarOperational) return
                                event.preventDefault()
                                event.stopPropagation()
                                setEwLockState((prev) => {
                                  const next = { ...prev }
                                  Object.keys(next).forEach((id) => {
                                    if (next[id] === 'hard' && id !== track.id) {
                                      delete next[id]
                                    }
                                  })
                                  next[track.id] = 'hard'
                                  return next
                                })
                              }}
                            >
                              {track.label}
                            </div>
                            {isHardLocked ? (
                              <>
                                <div style={{ position: 'absolute', left: `calc(${xPct}% - 14px)`, bottom: `calc(${yPct}% - 8px)`, width: 1, height: 16, background: trackColor, boxShadow: `0 0 4px ${trackGlow}` }} />
                                <div style={{ position: 'absolute', left: `calc(${xPct}% - 14px)`, bottom: `calc(${yPct}% + 8px)`, width: 6, height: 1, background: trackColor, boxShadow: `0 0 4px ${trackGlow}` }} />
                                <div style={{ position: 'absolute', left: `calc(${xPct}% - 14px)`, bottom: `calc(${yPct}% - 8px)`, width: 6, height: 1, background: trackColor, boxShadow: `0 0 4px ${trackGlow}` }} />
                                <div style={{ position: 'absolute', left: `calc(${xPct}% + 13px)`, bottom: `calc(${yPct}% - 8px)`, width: 1, height: 16, background: trackColor, boxShadow: `0 0 4px ${trackGlow}` }} />
                                <div style={{ position: 'absolute', left: `calc(${xPct}% + 8px)`, bottom: `calc(${yPct}% + 8px)`, width: 6, height: 1, background: trackColor, boxShadow: `0 0 4px ${trackGlow}` }} />
                                <div style={{ position: 'absolute', left: `calc(${xPct}% + 8px)`, bottom: `calc(${yPct}% - 8px)`, width: 6, height: 1, background: trackColor, boxShadow: `0 0 4px ${trackGlow}` }} />
                              </>
                            ) : null}
                            <div
                              style={{
                                position: 'absolute',
                                left: `calc(${xPct}% + 10px)`,
                                bottom: `calc(${yPct}% + 10px)`,
                                color: trackColor,
                                fontSize: 10,
                                letterSpacing: 0.2,
                                pointerEvents: 'none',
                                textShadow: `0 0 4px ${trackGlow}`,
                              }}
                            >
                              {incLabel}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        color: B_SCOPE_GREEN_DIM,
                        fontSize: 10,
                      }}
                    >
                      {bScopeBearingMode === 'REL' ? (
                        <>
                          <span>{bScopeViewMinDeg < 0 ? `L${Math.round(Math.abs(bScopeViewMinDeg))}` : `R${Math.round(bScopeViewMinDeg)}`}</span>
                          <span>{`C${Math.round((bScopeViewMinDeg + bScopeViewMaxDeg) / 2)}`}</span>
                          <span>{bScopeViewMaxDeg < 0 ? `L${Math.round(Math.abs(bScopeViewMaxDeg))}` : `R${Math.round(bScopeViewMaxDeg)}`}</span>
                        </>
                      ) : (
                        <>
                          <span>{String(Math.round(bScopeLeftAbsDeg)).padStart(3, '0')}</span>
                          <span>{String(Math.round(bScopeCenterAbsDeg)).padStart(3, '0')}</span>
                          <span>{String(Math.round(bScopeRightAbsDeg)).padStart(3, '0')}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      width: 64,
                      border: `1px solid ${B_SCOPE_GREEN_DIM}77`,
                      background: 'rgba(0,0,0,0.38)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 6px',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ fontSize: 9, color: B_SCOPE_GREEN_DIM, letterSpacing: 1 }}>PWR</span>
                    <div
                      style={{
                        height: 132,
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(radarPowerClamped)}
                        onChange={(event) => {
                          const next = clamp(Number(event.currentTarget.value), 0, 100)
                          setEwRadar({
                            radarPower: next,
                            radarOn: next > 0,
                          })
                        }}
                        style={{
                          width: 118,
                          transform: 'rotate(-90deg)',
                          accentColor: B_SCOPE_GREEN,
                          cursor: 'pointer',
                        }}
                        aria-label="Adjust radar power"
                      />
                    </div>
                    <span style={{ fontSize: 10, color: B_SCOPE_GREEN_GLOW, letterSpacing: 0.5 }}>
                      {`${Math.round(radarPowerClamped)}%`}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    paddingLeft: 70,
                    paddingRight: 70,
                  }}
                >
                  <div
                    style={{
                      display: 'inline-flex',
                      border: `1px solid ${B_SCOPE_GREEN_DIM}77`,
                      background: 'rgba(0,0,0,0.35)',
                      borderRadius: 1,
                      overflow: 'hidden',
                    }}
                  >
                    {(['REL', 'ABS'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setBScopeBearingMode(mode)}
                        style={{
                          padding: '3px 10px',
                          border: 'none',
                          borderRight: mode === 'REL' ? `1px solid ${B_SCOPE_GREEN_DIM}55` : 'none',
                          background: bScopeBearingMode === mode ? 'rgba(68,255,102,0.18)' : 'transparent',
                          color: bScopeBearingMode === mode ? B_SCOPE_GREEN_GLOW : B_SCOPE_GREEN_DIM,
                          fontFamily: "'Consolas', 'Monaco', monospace",
                          fontSize: 10,
                          letterSpacing: 1,
                          cursor: 'pointer',
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
