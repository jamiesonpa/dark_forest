import { useRef, useEffect, useMemo } from 'react'
import { useLoader, useFrame } from '@react-three/fiber'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import * as THREE from 'three'
import type { ShipState } from '@/state/types'
import { useGameStore } from '@/state/gameStore'
import { WarpBubbleEffect } from './WarpBubbleEffect'

const RAVEN_OBJ = '/models/caldari_battleship_Raven.obj'
const RAVEN_TEX = '/models/raven_tex.png'
export const PLAYER_SHIP_HULL_OBJECT_NAME = 'player-ship-hull'
export const PLAYER_SHIP_PIVOT_ANCHOR_NAME = 'player-ship-pivot-anchor'
export const getPlayerPivotAnchorName = (playerId: string) => `${PLAYER_SHIP_PIVOT_ANCHOR_NAME}-${playerId}`
export const getPlayerHullObjectName = (playerId: string) => `${PLAYER_SHIP_HULL_OBJECT_NAME}-${playerId}`
const MAX_SUBWARP_SPEED = 215
const MWD_SPEED = 800
const THRUSTER_PARTICLE_COUNT = 74
const THRUSTER_EMITTERS: ReadonlyArray<{ position: [number, number, number]; radiusScale: number }> = [
  { position: [0, -26, -279], radiusScale: 1 },
  { position: [-84, 0, -295], radiusScale: 0.5 },
  { position: [82, 0, -295], radiusScale: 0.5 },
]
const THRUST_CAPACITOR_EPSILON = 0.0001
const PARTICLE_INACTIVE_POSITION = 0
const REMOTE_POSITION_LERP_SPEED = 12
const REMOTE_ROTATION_LERP_SPEED = 10
const SHIELD_WIREFRAME_BASE_OPACITY = 0.3
const SHIELD_SURFACE_BASE_OPACITY = 0.15
const SHIELD_SURFACE_BASE_COLOR = new THREE.Color(0x3f8cff)
const SHIELD_WIREFRAME_BASE_COLOR = new THREE.Color(0x66bbff)
const SHIELD_VISIBILITY_EPSILON = 0.0005
const SHIELD_SURFACE_BASE_EMISSIVE_INTENSITY = 0.7
const SHIELD_WIREFRAME_BASE_EMISSIVE_INTENSITY = 1.5
/** Layer 1: visible to IRST camera only (main camera uses 0 + 2). */
const IRST_ONLY_LAYER = 1
const IRST_THERMAL_WIREFRAME_OPACITY = 0.92
const THERMAL_OUTLINE_TEMP_MIN = 220
const THERMAL_OUTLINE_TEMP_MAX = 360
const THERMAL_OUTLINE_EMISSIVE_MIN = 0.4
const THERMAL_OUTLINE_EMISSIVE_MAX = 16
/** Below this speed (m/s) counts as “still” for IRST hull glow. */
const THERMAL_OUTLINE_STILL_SPEED_EPS = 0.35
/** Still + no shields: emissive vs full-motion outline (lower = colder “dead ship” on IRST). */
const THERMAL_OUTLINE_BARE_STILL_EMISSIVE_SCALE = 0.001
/** Same state: wireframe opacity multiplier (stacks with emissive for a very faint trace). */
const THERMAL_OUTLINE_BARE_STILL_OPACITY_SCALE = 0.14

function shortestAngleDeltaDeg(fromDeg: number, toDeg: number) {
  return ((toDeg - fromDeg + 540) % 360) - 180
}

function createThrusterParticleData() {
  const positions = new Float32Array(THRUSTER_PARTICLE_COUNT * 3)
  const velocities = new Float32Array(THRUSTER_PARTICLE_COUNT * 3)
  const lifetimes = new Float32Array(THRUSTER_PARTICLE_COUNT)
  const maxLifetimes = new Float32Array(THRUSTER_PARTICLE_COUNT)
  const colors = new Float32Array(THRUSTER_PARTICLE_COUNT * 3)
  const sizes = new Float32Array(THRUSTER_PARTICLE_COUNT)
  const spawnSizes = new Float32Array(THRUSTER_PARTICLE_COUNT)
  const endSizeScales = new Float32Array(THRUSTER_PARTICLE_COUNT)

  for (let i = 0; i < THRUSTER_PARTICLE_COUNT; i += 1) {
    const idx = i * 3
    positions[idx] = PARTICLE_INACTIVE_POSITION
    positions[idx + 1] = PARTICLE_INACTIVE_POSITION
    positions[idx + 2] = PARTICLE_INACTIVE_POSITION
    velocities[idx] = 0
    velocities[idx + 1] = 0
    velocities[idx + 2] = 0
    lifetimes[i] = 0
    maxLifetimes[i] = 0
    colors[idx] = 0
    colors[idx + 1] = 0
    colors[idx + 2] = 0
    sizes[i] = 0
    spawnSizes[i] = 0
    endSizeScales[i] = 0.5
  }

  return { positions, velocities, lifetimes, maxLifetimes, colors, sizes, spawnSizes, endSizeScales }
}

interface PlayerShipProps {
  ship: ShipState
  isLocal: boolean
  playerId: string
}

export function PlayerShip({ ship, isLocal, playerId }: PlayerShipProps) {
  const warpState = useGameStore((s) => s.warpState)
  const setPlayerShipBoundingLength = useGameStore((s) => s.setPlayerShipBoundingLength)
  const groupRef = useRef<THREE.Group>(null)
  const targetPositionRef = useRef(new THREE.Vector3(ship.position[0], ship.position[1], ship.position[2]))
  const renderPositionRef = useRef(new THREE.Vector3(ship.position[0], ship.position[1], ship.position[2]))
  const targetHeadingRef = useRef(ship.actualHeading)
  const targetInclinationRef = useRef(ship.actualInclination)
  const targetRollRef = useRef(ship.rollAngle)
  const renderHeadingRef = useRef(ship.actualHeading)
  const renderInclinationRef = useRef(ship.actualInclination)
  const renderRollRef = useRef(ship.rollAngle)
  const thrusterPointsRefs = useRef<Array<THREE.Points | null>>([])
  const thrusterMaterialRefs = useRef<Array<THREE.PointsMaterial | null>>([])
  const warpDistortionPointsRefs = useRef<Array<THREE.Points | null>>([])
  const warpDistortionMaterialRefs = useRef<Array<THREE.PointsMaterial | null>>([])
  const shieldWireframeMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const shieldSurfaceMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const irstThermalOutlineMaterialRef = useRef<THREE.MeshStandardMaterial | null>(null)
  const obj = useLoader(OBJLoader, RAVEN_OBJ)
  const hullTexture = useLoader(THREE.TextureLoader, RAVEN_TEX)
  const shipCenterOffset = useMemo<[number, number, number]>(() => {
    const box = new THREE.Box3().setFromObject(obj)
    const center = new THREE.Vector3()
    box.getCenter(center)
    return [-center.x, -center.y, -center.z]
  }, [obj])
  const centeredObj = useMemo(() => {
    const clone = obj.clone(true)
    clone.name = PLAYER_SHIP_HULL_OBJECT_NAME
    clone.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      if (!child.geometry) return
      child.geometry = child.geometry.clone()
      child.geometry.translate(shipCenterOffset[0], shipCenterOffset[1], shipCenterOffset[2])
      child.geometry.computeBoundingBox()
      child.geometry.computeBoundingSphere()
    })
    return clone
  }, [obj, shipCenterOffset])
  const visualOriginCorrection = useMemo<[number, number, number]>(() => {
    centeredObj.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(centeredObj)
    const center = new THREE.Vector3()
    box.getCenter(center)
    return [-center.x, -center.y, -center.z]
  }, [centeredObj])
  const hullBoundingLength = useMemo(() => {
    centeredObj.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(centeredObj)
    const size = new THREE.Vector3()
    box.getSize(size)
    return Math.max(1, size.z)
  }, [centeredObj])
  const thrusterEmitters = useMemo(
    () =>
      THRUSTER_EMITTERS.map((emitter) => ({
        ...emitter,
        position: [
          emitter.position[0] + shipCenterOffset[0],
          emitter.position[1] + shipCenterOffset[1],
          emitter.position[2] + shipCenterOffset[2],
        ] as [number, number, number],
      })),
    [shipCenterOffset]
  )
  const engineLightPositions = useMemo<[number, number, number][]>(() => {
    return [
      [0 + shipCenterOffset[0], 0 + shipCenterOffset[1], -200 + shipCenterOffset[2]],
      [0 + shipCenterOffset[0], 0 + shipCenterOffset[1], -210 + shipCenterOffset[2]],
    ]
  }, [shipCenterOffset])

  const thrusterParticleDataList = useMemo(() => THRUSTER_EMITTERS.map(() => createThrusterParticleData()), [])
  const warpDistortionParticleDataList = useMemo(() => THRUSTER_EMITTERS.map(() => createThrusterParticleData()), [])
  const thrusterParticleTexture = useMemo(() => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const center = size * 0.5
    const gradient = ctx.createRadialGradient(center, center, size * 0.08, center, center, center)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)')
    gradient.addColorStop(0.28, 'rgba(255, 255, 255, 0.95)')
    gradient.addColorStop(0.62, 'rgba(255, 255, 255, 0.36)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)')

    ctx.clearRect(0, 0, size, size)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    const texture = new THREE.CanvasTexture(canvas)
    texture.generateMipmaps = true
    texture.minFilter = THREE.LinearMipMapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    return texture
  }, [])

  useEffect(() => {
    return () => {
      thrusterParticleTexture?.dispose()
    }
  }, [thrusterParticleTexture])

  useEffect(() => {
    if (!isLocal) return
    setPlayerShipBoundingLength(hullBoundingLength)
  }, [hullBoundingLength, isLocal, setPlayerShipBoundingLength])

  useEffect(() => {
    targetPositionRef.current.set(ship.position[0], ship.position[1], ship.position[2])
    targetHeadingRef.current = ship.actualHeading
    targetInclinationRef.current = ship.actualInclination
    targetRollRef.current = ship.rollAngle

    if (isLocal) {
      renderPositionRef.current.copy(targetPositionRef.current)
      renderHeadingRef.current = targetHeadingRef.current
      renderInclinationRef.current = targetInclinationRef.current
      renderRollRef.current = targetRollRef.current
    }
  }, [
    ship.position,
    ship.actualHeading,
    ship.actualInclination,
    ship.rollAngle,
    isLocal,
  ])

  const configuredHullTexture = useMemo(() => {
    hullTexture.colorSpace = THREE.SRGBColorSpace
    hullTexture.flipY = true
    hullTexture.wrapS = THREE.ClampToEdgeWrapping
    hullTexture.wrapT = THREE.ClampToEdgeWrapping
    hullTexture.needsUpdate = true
    return hullTexture
  }, [hullTexture])
  const shieldSurfaceObj = useMemo(() => {
    const overlay = centeredObj.clone(true)
    const shieldSurfaceMaterial = new THREE.MeshStandardMaterial({
      color: SHIELD_SURFACE_BASE_COLOR,
      emissive: SHIELD_SURFACE_BASE_COLOR,
      emissiveIntensity: SHIELD_SURFACE_BASE_EMISSIVE_INTENSITY,
      metalness: 0,
      roughness: 1,
      transparent: true,
      opacity: SHIELD_SURFACE_BASE_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    })

    overlay.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.castShadow = false
      child.receiveShadow = false
      child.material = shieldSurfaceMaterial
      child.renderOrder = 3
    })

    overlay.name = 'player-ship-shield-surface'
    return overlay
  }, [centeredObj])

  const shieldWireframeObj = useMemo(() => {
    const overlay = centeredObj.clone(true)
    const shieldWireframeMaterial = new THREE.MeshStandardMaterial({
      color: SHIELD_WIREFRAME_BASE_COLOR,
      emissive: SHIELD_WIREFRAME_BASE_COLOR,
      emissiveIntensity: SHIELD_WIREFRAME_BASE_EMISSIVE_INTENSITY,
      metalness: 0,
      roughness: 1,
      transparent: true,
      opacity: SHIELD_WIREFRAME_BASE_OPACITY,
      wireframe: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })

    overlay.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.castShadow = false
      child.receiveShadow = false
      child.material = shieldWireframeMaterial
      child.renderOrder = 4
    })

    overlay.name = 'player-ship-shield-wireframe'
    return overlay
  }, [centeredObj])

  const irstThermalOutlineObj = useMemo(() => {
    const overlay = centeredObj.clone(true)
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: THERMAL_OUTLINE_EMISSIVE_MIN,
      metalness: 0,
      roughness: 1,
      wireframe: true,
      transparent: true,
      opacity: IRST_THERMAL_WIREFRAME_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    overlay.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.castShadow = false
      child.receiveShadow = false
      child.material = mat
      child.renderOrder = 5
      child.layers.set(IRST_ONLY_LAYER)
    })
    overlay.name = 'player-ship-irst-thermal-outline'
    return overlay
  }, [centeredObj])

  useEffect(() => {
    irstThermalOutlineObj.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        irstThermalOutlineMaterialRef.current = child.material
      }
    })
    return () => {
      irstThermalOutlineMaterialRef.current?.dispose()
      irstThermalOutlineMaterialRef.current = null
    }
  }, [irstThermalOutlineObj])

  useEffect(() => {
    shieldSurfaceObj.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        shieldSurfaceMaterialRef.current = child.material
      }
    })
    return () => {
      shieldSurfaceMaterialRef.current?.dispose()
      shieldSurfaceMaterialRef.current = null
    }
  }, [shieldSurfaceObj])

  useEffect(() => {
    shieldWireframeObj.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        shieldWireframeMaterialRef.current = child.material
      }
    })
    return () => {
      shieldWireframeMaterialRef.current?.dispose()
      shieldWireframeMaterialRef.current = null
    }
  }, [shieldWireframeObj])

  useEffect(() => {
    const configureParticleMaterial = (material: THREE.PointsMaterial | null) => {
      if (!material) return
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = `attribute float aSize;\n${shader.vertexShader}`
          .replace('gl_PointSize = size;', 'gl_PointSize = aSize;')
          .replace(
            'gl_PointSize = size * ( scale / - mvPosition.z );',
            'gl_PointSize = aSize * ( scale / - mvPosition.z );'
          )
      }
      material.needsUpdate = true
    }

    thrusterPointsRefs.current.forEach((points) => {
      const positionAttr = points?.geometry.getAttribute('position')
      const colorAttr = points?.geometry.getAttribute('color')
      const sizeAttr = points?.geometry.getAttribute('aSize')
      if (positionAttr instanceof THREE.BufferAttribute) {
        positionAttr.setUsage(THREE.DynamicDrawUsage)
      }
      if (colorAttr instanceof THREE.BufferAttribute) {
        colorAttr.setUsage(THREE.DynamicDrawUsage)
      }
      if (sizeAttr instanceof THREE.BufferAttribute) {
        sizeAttr.setUsage(THREE.DynamicDrawUsage)
      }
    })
    warpDistortionPointsRefs.current.forEach((points) => {
      const positionAttr = points?.geometry.getAttribute('position')
      const colorAttr = points?.geometry.getAttribute('color')
      const sizeAttr = points?.geometry.getAttribute('aSize')
      if (positionAttr instanceof THREE.BufferAttribute) {
        positionAttr.setUsage(THREE.DynamicDrawUsage)
      }
      if (colorAttr instanceof THREE.BufferAttribute) {
        colorAttr.setUsage(THREE.DynamicDrawUsage)
      }
      if (sizeAttr instanceof THREE.BufferAttribute) {
        sizeAttr.setUsage(THREE.DynamicDrawUsage)
      }
    })

    thrusterMaterialRefs.current.forEach((material) => {
      configureParticleMaterial(material)
    })
    warpDistortionMaterialRefs.current.forEach((material) => {
      configureParticleMaterial(material)
    })
  }, [])

  useFrame((_state, delta) => {
    if (!groupRef.current) return
    let shield = Math.min(ship.shieldOnlineLevel, ship.shield)
    let shieldMax = ship.shieldMax
    if (isLocal) {
      const localShip = useGameStore.getState().ship
      renderPositionRef.current.set(
        localShip.position[0],
        localShip.position[1],
        localShip.position[2]
      )
      renderHeadingRef.current = localShip.actualHeading
      renderInclinationRef.current = localShip.actualInclination
      renderRollRef.current = localShip.rollAngle
      shield = Math.min(localShip.shieldOnlineLevel, localShip.shield)
      shieldMax = localShip.shieldMax
    } else {
      const posAlpha = 1 - Math.exp(-REMOTE_POSITION_LERP_SPEED * delta)
      const rotAlpha = 1 - Math.exp(-REMOTE_ROTATION_LERP_SPEED * delta)

      renderPositionRef.current.lerp(targetPositionRef.current, posAlpha)
      renderHeadingRef.current += shortestAngleDeltaDeg(renderHeadingRef.current, targetHeadingRef.current) * rotAlpha
      renderInclinationRef.current = THREE.MathUtils.lerp(
        renderInclinationRef.current,
        targetInclinationRef.current,
        rotAlpha
      )
      renderRollRef.current = THREE.MathUtils.lerp(renderRollRef.current, targetRollRef.current, rotAlpha)
    }

    groupRef.current.position.copy(renderPositionRef.current)

    const yaw = THREE.MathUtils.degToRad(renderHeadingRef.current)
    const pitch = THREE.MathUtils.degToRad(renderInclinationRef.current)
    const roll = THREE.MathUtils.degToRad(renderRollRef.current)
    groupRef.current.rotation.set(-pitch, -yaw, roll, 'YXZ')

    const shieldPct = shieldMax > 0 ? THREE.MathUtils.clamp(shield / shieldMax, 0, 1) : 0
    const shieldVisible = ship.shieldsUp && shieldPct > SHIELD_VISIBILITY_EPSILON
    shieldSurfaceObj.visible = shieldVisible
    shieldWireframeObj.visible = shieldVisible
    if (shieldSurfaceMaterialRef.current) {
      shieldSurfaceMaterialRef.current.opacity = SHIELD_SURFACE_BASE_OPACITY * shieldPct
      shieldSurfaceMaterialRef.current.emissiveIntensity =
        SHIELD_SURFACE_BASE_EMISSIVE_INTENSITY * shieldPct
    }
    if (shieldWireframeMaterialRef.current) {
      shieldWireframeMaterialRef.current.opacity = SHIELD_WIREFRAME_BASE_OPACITY * shieldPct
      shieldWireframeMaterialRef.current.emissiveIntensity =
        SHIELD_WIREFRAME_BASE_EMISSIVE_INTENSITY * shieldPct
    }

    const hasCapacitorForThrust = ship.capacitor > THRUST_CAPACITOR_EPSILON
    const isMwdActive = ship.mwdActive && hasCapacitorForThrust
    const mwdDistortionIntensity = 0.5
    const mwdLifetimeMultiplier = 0.5
    const requestedSpeed = hasCapacitorForThrust ? (isMwdActive ? MWD_SPEED : ship.targetSpeed) : 0
    const requestedMax = isMwdActive ? MWD_SPEED : MAX_SUBWARP_SPEED
    const requestedSpeedRatio = THREE.MathUtils.clamp(requestedSpeed / Math.max(1, requestedMax), 0, 1)
    const spawnRate = isMwdActive
      ? THREE.MathUtils.lerp(40, 190, requestedSpeedRatio) * 25
      : THREE.MathUtils.lerp(8, 120, requestedSpeedRatio) * 25
    const lifetimeScale = isMwdActive
      ? THREE.MathUtils.lerp(0.28, 0.55, requestedSpeedRatio) * mwdLifetimeMultiplier
      : THREE.MathUtils.lerp(0.38, 0.9, requestedSpeedRatio)
    const nozzleRadius = isMwdActive
      ? THREE.MathUtils.lerp(2.0, 3.6, requestedSpeedRatio) * 6
      : THREE.MathUtils.lerp(1.4, 5.2, requestedSpeedRatio) * 6
    const decayRate = isMwdActive
      ? THREE.MathUtils.lerp(6.2, 3.4, requestedSpeedRatio)
      : THREE.MathUtils.lerp(4.5, 1.4, requestedSpeedRatio)
    const spawnParticleSize = isMwdActive
      ? THREE.MathUtils.lerp(20, 44, requestedSpeedRatio)
      : THREE.MathUtils.lerp(12, 30, requestedSpeedRatio)
    const distortionSpawnRate = isMwdActive
      ? THREE.MathUtils.lerp(36, 130, requestedSpeedRatio) * 25 * mwdDistortionIntensity
      : 0
    const distortionNozzleRadius = THREE.MathUtils.lerp(2.4, 5.5, requestedSpeedRatio) * 8
    const distortionSpawnSize = THREE.MathUtils.lerp(26, 68, requestedSpeedRatio) * mwdDistortionIntensity
    const distortionDecayRate = isMwdActive ? THREE.MathUtils.lerp(2.8, 1.7, requestedSpeedRatio) : 9.5
    const distortionLifetimeScale = THREE.MathUtils.lerp(0.35, 0.72, requestedSpeedRatio) * mwdLifetimeMultiplier
    const dt = Math.min(delta, 0.05)

    thrusterEmitters.forEach((emitter, emitterIndex) => {
      const thrusterParticleData = thrusterParticleDataList[emitterIndex]
      if (!thrusterParticleData) return

      for (let i = 0; i < THRUSTER_PARTICLE_COUNT; i += 1) {
        const idx = i * 3
        let life = thrusterParticleData.lifetimes[i] ?? 0
        life -= dt * decayRate

        if (life <= 0) {
          if (Math.random() > spawnRate * dt) {
            thrusterParticleData.positions[idx] = PARTICLE_INACTIVE_POSITION
            thrusterParticleData.positions[idx + 1] = PARTICLE_INACTIVE_POSITION
            thrusterParticleData.positions[idx + 2] = PARTICLE_INACTIVE_POSITION
            thrusterParticleData.lifetimes[i] = 0
            thrusterParticleData.maxLifetimes[i] = 0
            thrusterParticleData.colors[idx] = 0
            thrusterParticleData.colors[idx + 1] = 0
            thrusterParticleData.colors[idx + 2] = 0
            thrusterParticleData.sizes[i] = 0
            thrusterParticleData.spawnSizes[i] = 0
            continue
          }

          const angle = Math.random() * Math.PI * 2
          const radialDistance = Math.sqrt(Math.random()) * nozzleRadius * 0.7 * emitter.radiusScale
          thrusterParticleData.positions[idx] =
            emitter.position[0] + Math.cos(angle) * radialDistance
          thrusterParticleData.positions[idx + 1] =
            emitter.position[1] + Math.sin(angle) * radialDistance * 0.7
          thrusterParticleData.positions[idx + 2] =
            emitter.position[2] - Math.random() * 3

          const toAxisX = emitter.position[0] - (thrusterParticleData.positions[idx] ?? 0)
          const toAxisY = emitter.position[1] - (thrusterParticleData.positions[idx + 1] ?? 0)
          const lateralDist = Math.max(0.001, Math.hypot(toAxisX, toAxisY))
          const radialNormX = toAxisX / lateralDist
          const radialNormY = toAxisY / lateralDist

          if (isMwdActive) {
            const warpScale = THREE.MathUtils.lerp(1.6, 2.4, requestedSpeedRatio)
            const forwardSpeed = (640 + requestedSpeedRatio * 980 + Math.random() * 240) * (25 / 3) * 0.5 * warpScale
            const swirlSpeed = (20 + Math.random() * 60) * warpScale
            const convergencePull = (240 + Math.random() * 340) * warpScale
            const tangentX = -radialNormY
            const tangentY = radialNormX
            const jitterX = (Math.random() - 0.5) * 0.04 * forwardSpeed
            const jitterY = (Math.random() - 0.5) * 0.04 * forwardSpeed

            thrusterParticleData.velocities[idx] =
              tangentX * swirlSpeed + radialNormX * convergencePull + jitterX
            thrusterParticleData.velocities[idx + 1] =
              tangentY * swirlSpeed * 0.72 + radialNormY * convergencePull * 0.72 + jitterY
            thrusterParticleData.velocities[idx + 2] = -forwardSpeed
          } else {
            const velocityJitter = 0.45 + Math.random() * 1.3
            const lateralJitter = 0.6 + Math.random() * 0.9
            const forwardJitter = 0.7 + Math.random() * 0.8
            const speedScale = THREE.MathUtils.lerp(0.5, 1.5, requestedSpeedRatio)
            const speedBase =
              (100 + requestedSpeedRatio * 560 + Math.random() * 180) *
              (25 / 3) *
              velocityJitter *
              speedScale * 0.5
            const convergenceHalfAngleDeg = THREE.MathUtils.lerp(0, 10, requestedSpeedRatio)
            const convergenceStrength = Math.tan(THREE.MathUtils.degToRad(convergenceHalfAngleDeg))
            const jitterX = (Math.random() - 0.5) * 0.08 * speedBase
            const jitterY = (Math.random() - 0.5) * 0.08 * speedBase
            thrusterParticleData.velocities[idx] =
              radialNormX * speedBase * convergenceStrength * lateralJitter + jitterX
            thrusterParticleData.velocities[idx + 1] =
              radialNormY * speedBase * convergenceStrength * 0.7 * lateralJitter + jitterY
            thrusterParticleData.velocities[idx + 2] = -speedBase * forwardJitter
          }

          // Keep particles alive in real-time seconds; dividing by 90 caused strobing/twinkling.
          life = (0.18 + Math.random() * 0.55) * lifetimeScale / 24
          thrusterParticleData.maxLifetimes[i] = life
          thrusterParticleData.spawnSizes[i] = spawnParticleSize
          thrusterParticleData.endSizeScales[i] = isMwdActive
            ? 0.25 + Math.random() * 0.2
            : 0.4 + Math.random() * 0.2
        } else {
          const velX = thrusterParticleData.velocities[idx] ?? 0
          const velY = thrusterParticleData.velocities[idx + 1] ?? 0
          const velZ = thrusterParticleData.velocities[idx + 2] ?? 0
          thrusterParticleData.positions[idx] = (thrusterParticleData.positions[idx] ?? 0) + velX * dt
          thrusterParticleData.positions[idx + 1] = (thrusterParticleData.positions[idx + 1] ?? 0) + velY * dt
          thrusterParticleData.positions[idx + 2] = (thrusterParticleData.positions[idx + 2] ?? 0) + velZ * dt
          const spreadDamping = Math.max(0, 1 - dt * (isMwdActive ? 1.4 : 0.35))
          thrusterParticleData.velocities[idx] = velX * spreadDamping
          thrusterParticleData.velocities[idx + 1] = velY * spreadDamping
        }

        thrusterParticleData.lifetimes[i] = life
        const maxLife = thrusterParticleData.maxLifetimes[i] ?? 0
        if (life > 0 && maxLife > 0) {
          const ageRatio = 1 - THREE.MathUtils.clamp(life / maxLife, 0, 1)
          if (isMwdActive) {
            // Microwarp look: violet core shifting to electric blue/cyan bloom.
            thrusterParticleData.colors[idx] = THREE.MathUtils.lerp(0.72, 0.18, ageRatio)
            thrusterParticleData.colors[idx + 1] = THREE.MathUtils.lerp(0.28, 0.9, ageRatio)
            thrusterParticleData.colors[idx + 2] = THREE.MathUtils.lerp(1.0, 1.0, ageRatio)
          } else {
            // Subwarp look: cool blue at spawn to warm orange near fade-out.
            thrusterParticleData.colors[idx] = THREE.MathUtils.lerp(0.35, 1.0, ageRatio)
            thrusterParticleData.colors[idx + 1] = THREE.MathUtils.lerp(0.7, 0.45, ageRatio)
            thrusterParticleData.colors[idx + 2] = THREE.MathUtils.lerp(1.0, 0.08, ageRatio)
          }
          const spawnSize = thrusterParticleData.spawnSizes[i] ?? spawnParticleSize
          const endScale = thrusterParticleData.endSizeScales[i] ?? 0.5
          if (isMwdActive) {
            const pulse = 1 + Math.sin(ageRatio * Math.PI) * 0.1
            thrusterParticleData.sizes[i] =
              spawnSize * THREE.MathUtils.lerp(1, endScale, ageRatio) * pulse
          } else {
            thrusterParticleData.sizes[i] = spawnSize * THREE.MathUtils.lerp(1, endScale, ageRatio)
          }
        } else {
          thrusterParticleData.colors[idx] = 0
          thrusterParticleData.colors[idx + 1] = 0
          thrusterParticleData.colors[idx + 2] = 0
          thrusterParticleData.sizes[i] = 0
        }
      }
    })
    thrusterEmitters.forEach((emitter, emitterIndex) => {
      const distortionData = warpDistortionParticleDataList[emitterIndex]
      if (!distortionData) return

      for (let i = 0; i < THRUSTER_PARTICLE_COUNT; i += 1) {
        const idx = i * 3
        let life = distortionData.lifetimes[i] ?? 0
        life -= dt * distortionDecayRate

        if (life <= 0) {
          if (!isMwdActive || Math.random() > distortionSpawnRate * dt) {
            distortionData.positions[idx] = PARTICLE_INACTIVE_POSITION
            distortionData.positions[idx + 1] = PARTICLE_INACTIVE_POSITION
            distortionData.positions[idx + 2] = PARTICLE_INACTIVE_POSITION
            distortionData.lifetimes[i] = 0
            distortionData.maxLifetimes[i] = 0
            distortionData.colors[idx] = 0
            distortionData.colors[idx + 1] = 0
            distortionData.colors[idx + 2] = 0
            distortionData.sizes[i] = 0
            distortionData.spawnSizes[i] = 0
            continue
          }

          const angle = Math.random() * Math.PI * 2
          const radialDistance = Math.sqrt(Math.random()) * distortionNozzleRadius * emitter.radiusScale
          const spawnX = emitter.position[0] + Math.cos(angle) * radialDistance
          const spawnY = emitter.position[1] + Math.sin(angle) * radialDistance * 0.76
          const spawnZ = emitter.position[2] - Math.random() * 4
          distortionData.positions[idx] = spawnX
          distortionData.positions[idx + 1] = spawnY
          distortionData.positions[idx + 2] = spawnZ

          const toAxisX = emitter.position[0] - spawnX
          const toAxisY = emitter.position[1] - spawnY
          const lateralDist = Math.max(0.001, Math.hypot(toAxisX, toAxisY))
          const radialNormX = toAxisX / lateralDist
          const radialNormY = toAxisY / lateralDist
          const tangentX = -radialNormY
          const tangentY = radialNormX
          const swirlSpeed = 44 + Math.random() * 90
          const convergenceSpeed = 120 + Math.random() * 160
          const backwardSpeed = 290 + requestedSpeedRatio * 560 + Math.random() * 220
          const jitterX = (Math.random() - 0.5) * backwardSpeed * 0.05
          const jitterY = (Math.random() - 0.5) * backwardSpeed * 0.05

          distortionData.velocities[idx] = tangentX * swirlSpeed + radialNormX * convergenceSpeed + jitterX
          distortionData.velocities[idx + 1] = tangentY * swirlSpeed * 0.72 + radialNormY * convergenceSpeed * 0.72 + jitterY
          distortionData.velocities[idx + 2] = -backwardSpeed

          life = (0.12 + Math.random() * 0.24) * distortionLifetimeScale / 20
          distortionData.maxLifetimes[i] = life
          distortionData.spawnSizes[i] = distortionSpawnSize * (0.7 + Math.random() * 0.6)
          distortionData.endSizeScales[i] = 1.8 + Math.random() * 1.5
        } else {
          const velX = distortionData.velocities[idx] ?? 0
          const velY = distortionData.velocities[idx + 1] ?? 0
          const velZ = distortionData.velocities[idx + 2] ?? 0
          distortionData.positions[idx] = (distortionData.positions[idx] ?? 0) + velX * dt
          distortionData.positions[idx + 1] = (distortionData.positions[idx + 1] ?? 0) + velY * dt
          distortionData.positions[idx + 2] = (distortionData.positions[idx + 2] ?? 0) + velZ * dt
          const spreadDamping = Math.max(0, 1 - dt * 1.2)
          distortionData.velocities[idx] = velX * spreadDamping
          distortionData.velocities[idx + 1] = velY * spreadDamping
        }

        distortionData.lifetimes[i] = life
        const maxLife = distortionData.maxLifetimes[i] ?? 0
        if (life > 0 && maxLife > 0) {
          const ageRatio = 1 - THREE.MathUtils.clamp(life / maxLife, 0, 1)
          const pulse = 0.7 + Math.sin(ageRatio * Math.PI) * 0.35
          distortionData.colors[idx] = THREE.MathUtils.lerp(0.25, 0.05, ageRatio) * pulse
          distortionData.colors[idx + 1] = THREE.MathUtils.lerp(0.62, 0.18, ageRatio) * pulse
          distortionData.colors[idx + 2] = THREE.MathUtils.lerp(1.0, 0.92, ageRatio) * pulse
          const spawnSize = distortionData.spawnSizes[i] ?? distortionSpawnSize
          const endScale = distortionData.endSizeScales[i] ?? 2
          distortionData.sizes[i] = spawnSize * THREE.MathUtils.lerp(0.75, endScale, ageRatio)
        } else {
          distortionData.colors[idx] = 0
          distortionData.colors[idx + 1] = 0
          distortionData.colors[idx + 2] = 0
          distortionData.sizes[i] = 0
        }
      }
    })

    thrusterPointsRefs.current.forEach((points) => {
      const positionAttr = points?.geometry.getAttribute('position')
      const colorAttr = points?.geometry.getAttribute('color')
      const sizeAttr = points?.geometry.getAttribute('aSize')
      if (positionAttr instanceof THREE.BufferAttribute) {
        positionAttr.needsUpdate = true
      }
      if (colorAttr instanceof THREE.BufferAttribute) {
        colorAttr.needsUpdate = true
      }
      if (sizeAttr instanceof THREE.BufferAttribute) {
        sizeAttr.needsUpdate = true
      }
    })
    warpDistortionPointsRefs.current.forEach((points) => {
      const positionAttr = points?.geometry.getAttribute('position')
      const colorAttr = points?.geometry.getAttribute('color')
      const sizeAttr = points?.geometry.getAttribute('aSize')
      if (positionAttr instanceof THREE.BufferAttribute) {
        positionAttr.needsUpdate = true
      }
      if (colorAttr instanceof THREE.BufferAttribute) {
        colorAttr.needsUpdate = true
      }
      if (sizeAttr instanceof THREE.BufferAttribute) {
        sizeAttr.needsUpdate = true
      }
    })

    thrusterMaterialRefs.current.forEach((material) => {
      if (!material) return
      material.opacity = isMwdActive
        ? THREE.MathUtils.lerp(0.35, 0.95, requestedSpeedRatio)
        : THREE.MathUtils.lerp(0.08, 0.78, requestedSpeedRatio)
    })
    warpDistortionMaterialRefs.current.forEach((material) => {
      if (!material) return
      material.opacity = isMwdActive
        ? THREE.MathUtils.lerp(0.14, 0.34, requestedSpeedRatio) * mwdDistortionIntensity
        : 0
    })

    const gs = useGameStore.getState()
    const showIrstThermal = gs.irstCameraOn && gs.ship.irstSpectrumMode === 'IR'
    irstThermalOutlineObj.visible = showIrstThermal
    if (irstThermalOutlineMaterialRef.current && showIrstThermal) {
      const sensorsShip = isLocal ? gs.ship : ship
      const thermal = sensorsShip.thermalSignature
      const t = THREE.MathUtils.clamp(
        (thermal - THERMAL_OUTLINE_TEMP_MIN) / (THERMAL_OUTLINE_TEMP_MAX - THERMAL_OUTLINE_TEMP_MIN),
        0,
        1
      )
      const baseEmissive = THREE.MathUtils.lerp(
        THERMAL_OUTLINE_EMISSIVE_MIN,
        THERMAL_OUTLINE_EMISSIVE_MAX,
        t
      )
      const bareStill =
        !sensorsShip.shieldsUp && sensorsShip.actualSpeed <= THERMAL_OUTLINE_STILL_SPEED_EPS
      const mat = irstThermalOutlineMaterialRef.current
      if (bareStill) {
        mat.emissiveIntensity = baseEmissive * THERMAL_OUTLINE_BARE_STILL_EMISSIVE_SCALE
        mat.opacity = IRST_THERMAL_WIREFRAME_OPACITY * THERMAL_OUTLINE_BARE_STILL_OPACITY_SCALE
      } else {
        mat.emissiveIntensity = baseEmissive
        mat.opacity = IRST_THERMAL_WIREFRAME_OPACITY
      }
    }
  })

  useEffect(() => {
    if (!centeredObj) return
    const hullMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: configuredHullTexture,
      metalness: 0.7,
      roughness: 0.4,
      emissive: 0x111111,
      emissiveIntensity: 0.2,
    })
    const exhaustMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      metalness: 0.5,
      roughness: 0.5,
      emissive: 0xff6600,
      emissiveIntensity: 0.4,
    })

    function isInExhaustGroup(mesh: THREE.Object3D): boolean {
      let p: THREE.Object3D | null = mesh.parent
      while (p) {
        if (p.name?.toLowerCase().includes('exhaust')) return true
        p = p.parent
      }
      return false
    }

    centeredObj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mesh = child as THREE.Mesh
        if (mesh.geometry) mesh.geometry.computeVertexNormals()
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.material = isInExhaustGroup(child) ? exhaustMaterial : hullMaterial
      }
    })

    return () => {
      hullMaterial.dispose()
      exhaustMaterial.dispose()
    }
  }, [centeredObj, configuredHullTexture])

  if (!centeredObj) return null
  const warpBubblePhase =
    isLocal
      ? ship.inWarpTransit
        ? 'transit'
        : warpState === 'landing'
          ? 'arrival'
          : 'inactive'
      : 'inactive'
  return (
    <group ref={groupRef}>
      <group name={isLocal ? getPlayerPivotAnchorName(playerId) : undefined} position={[0, 0, 0]} />
      {isLocal && <WarpBubbleEffect ship={ship} phase={warpBubblePhase} />}
      <group position={visualOriginCorrection}>
        <primitive object={centeredObj} name={getPlayerHullObjectName(playerId)} scale={1} />
        <primitive object={irstThermalOutlineObj} scale={1.005} renderOrder={5} />
        {ship.shieldsUp && (
          <>
            <primitive object={shieldSurfaceObj} scale={1.006} renderOrder={3} />
            <primitive object={shieldWireframeObj} scale={1.008} renderOrder={4} />
          </>
        )}
        {thrusterEmitters.map((_, index) => {
          const thrusterParticleData = thrusterParticleDataList[index]
          if (!thrusterParticleData) return null

          return (
            <points
              key={`thruster-emitter-${index}`}
              ref={(node) => {
                thrusterPointsRefs.current[index] = node
              }}
              frustumCulled={false}
              renderOrder={3}
            >
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[thrusterParticleData.positions, 3]}
                />
                <bufferAttribute
                  attach="attributes-color"
                  args={[thrusterParticleData.colors, 3]}
                />
                <bufferAttribute
                  attach="attributes-aSize"
                  args={[thrusterParticleData.sizes, 1]}
                />
              </bufferGeometry>
              <pointsMaterial
                ref={(node) => {
                  thrusterMaterialRefs.current[index] = node
                }}
                color={0xffffff}
                vertexColors
                size={20}
                sizeAttenuation
                map={thrusterParticleTexture ?? undefined}
                alphaMap={thrusterParticleTexture ?? undefined}
                alphaTest={0.02}
                transparent
                opacity={0.4}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </points>
          )
        })}
        {thrusterEmitters.map((_, index) => {
          const distortionData = warpDistortionParticleDataList[index]
          if (!distortionData) return null

          return (
            <points
              key={`warp-distortion-emitter-${index}`}
              ref={(node) => {
                warpDistortionPointsRefs.current[index] = node
              }}
              frustumCulled={false}
              renderOrder={2}
            >
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[distortionData.positions, 3]}
                />
                <bufferAttribute
                  attach="attributes-color"
                  args={[distortionData.colors, 3]}
                />
                <bufferAttribute
                  attach="attributes-aSize"
                  args={[distortionData.sizes, 1]}
                />
              </bufferGeometry>
              <pointsMaterial
                ref={(node) => {
                  warpDistortionMaterialRefs.current[index] = node
                }}
                color={0xffffff}
                vertexColors
                size={34}
                sizeAttenuation
                map={thrusterParticleTexture ?? undefined}
                alphaMap={thrusterParticleTexture ?? undefined}
                alphaTest={0.01}
                transparent
                opacity={0}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </points>
          )
        })}
        <pointLight position={engineLightPositions[0]} color={0xff6600} intensity={30} distance={400} />
        <pointLight position={engineLightPositions[1]} color={0x4488ff} intensity={15} distance={300} />
      </group>
    </group>
  )
}
