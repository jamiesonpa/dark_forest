import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import type { LaunchedCylinder } from '@/state/types'
import { TORPEDO_ACCEL_DURATION_SECONDS } from '@/systems/simulation/torpedoConstants'

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const THRUSTER_PARTICLE_COUNT = 74
const PARTICLE_INACTIVE_POSITION = 0
const PLAYER_MAX_SUBWARP_SPAWN_RATE = 120 * 25
const PLAYER_MAX_SUBWARP_LIFETIME_SCALE = 0.9
const PLAYER_MAX_SUBWARP_NOZZLE_RADIUS = 5.2 * 6
const PLAYER_MAX_SUBWARP_DECAY_RATE = 1.4
const PLAYER_MAX_SUBWARP_SPAWN_SIZE = 30
const SMOKE_PARTICLE_COUNT = 900
const SMOKE_SPAWN_RATE = 130
const SMOKE_MIN_LIFETIME_SECONDS = 5.5
const SMOKE_MAX_LIFETIME_SECONDS = 12
const SMOKE_START_SIZE = 30
const SMOKE_END_SIZE = 1000
const SMOKE_VELOCITY_DRAG = 0.35
const SMOKE_TURBULENCE_MIN = 10
const SMOKE_TURBULENCE_MAX = 26
const SMOKE_WOBBLE_FREQ_MIN = 0.8
const SMOKE_WOBBLE_FREQ_MAX = 2.2
const SMOKE_TURBULENCE_ACCEL = 7.5
const LAUNCH_PLUME_DURATION_SECONDS = 0.45
const LAUNCH_PLUME_SPAWN_RATE = 520
const LAUNCH_PLUME_MIN_SPEED = 80
const LAUNCH_PLUME_MAX_SPEED = 180
const TORPEDO_NOZZLE_GLOW_OPACITY = 0.72
const TORPEDO_NOZZLE_FLARE_OPACITY = 0.38

function createThrusterParticleData() {
  const positions = new Float32Array(THRUSTER_PARTICLE_COUNT * 3)
  const velocities = new Float32Array(THRUSTER_PARTICLE_COUNT * 3)
  const lifetimes = new Float32Array(THRUSTER_PARTICLE_COUNT)
  const maxLifetimes = new Float32Array(THRUSTER_PARTICLE_COUNT)
  const colors = new Float32Array(THRUSTER_PARTICLE_COUNT * 3)
  const sizes = new Float32Array(THRUSTER_PARTICLE_COUNT)
  const spawnSizes = new Float32Array(THRUSTER_PARTICLE_COUNT)
  const endSizeScales = new Float32Array(THRUSTER_PARTICLE_COUNT)

  return { positions, velocities, lifetimes, maxLifetimes, colors, sizes, spawnSizes, endSizeScales }
}

function createSmokeParticleData() {
  const positions = new Float32Array(SMOKE_PARTICLE_COUNT * 3)
  const velocities = new Float32Array(SMOKE_PARTICLE_COUNT * 3)
  const lifetimes = new Float32Array(SMOKE_PARTICLE_COUNT)
  const maxLifetimes = new Float32Array(SMOKE_PARTICLE_COUNT)
  const colors = new Float32Array(SMOKE_PARTICLE_COUNT * 3)
  const sizes = new Float32Array(SMOKE_PARTICLE_COUNT)
  const alphas = new Float32Array(SMOKE_PARTICLE_COUNT)
  const startAlphas = new Float32Array(SMOKE_PARTICLE_COUNT)
  const wobblePhases = new Float32Array(SMOKE_PARTICLE_COUNT)
  const wobbleFrequencies = new Float32Array(SMOKE_PARTICLE_COUNT)
  const turbulenceStrengths = new Float32Array(SMOKE_PARTICLE_COUNT)
  const sizeJitterPhases = new Float32Array(SMOKE_PARTICLE_COUNT)
  return {
    positions,
    velocities,
    lifetimes,
    maxLifetimes,
    colors,
    sizes,
    alphas,
    startAlphas,
    wobblePhases,
    wobbleFrequencies,
    turbulenceStrengths,
    sizeJitterPhases,
  }
}

function LaunchedCylinderMesh({ cylinder }: { cylinder: LaunchedCylinder }) {
  const thrusterPointsRef = useRef<THREE.Points | null>(null)
  const thrusterMaterialRef = useRef<THREE.PointsMaterial | null>(null)
  const smokePointsRef = useRef<THREE.Points | null>(null)
  const smokeMaterialRef = useRef<THREE.ShaderMaterial | null>(null)
  const launchAgeRef = useRef(0)
  const smokeSpawnRemainderRef = useRef(0)
  const thrusterParticleData = useMemo(() => createThrusterParticleData(), [])
  const smokeParticleData = useMemo(() => createSmokeParticleData(), [])
  const isAccelerating = cylinder.flightTimeSeconds <= TORPEDO_ACCEL_DURATION_SECONDS
  const directionVector = useMemo(
    () => new THREE.Vector3(cylinder.direction[0], cylinder.direction[1], cylinder.direction[2]).normalize(),
    [cylinder.direction]
  )
  const smokeParticleTexture = useMemo(() => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const center = size * 0.5
    const gradient = ctx.createRadialGradient(center, center, size * 0.05, center, center, center)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.9)')
    gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.45)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
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
  const smokeUniforms = useMemo(
    () => ({
      uMap: { value: smokeParticleTexture },
    }),
    [smokeParticleTexture]
  )
  const nozzleFlareTexture = useMemo(() => {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const center = size * 0.5
    const innerGlow = ctx.createRadialGradient(center, center, 0, center, center, center * 0.7)
    innerGlow.addColorStop(0, 'rgba(255, 242, 214, 0.95)')
    innerGlow.addColorStop(0.25, 'rgba(255, 176, 62, 0.72)')
    innerGlow.addColorStop(0.6, 'rgba(255, 118, 26, 0.18)')
    innerGlow.addColorStop(1, 'rgba(255, 92, 0, 0)')
    ctx.clearRect(0, 0, size, size)
    ctx.fillStyle = innerGlow
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
      smokeParticleTexture?.dispose()
      nozzleFlareTexture?.dispose()
    }
  }, [nozzleFlareTexture, smokeParticleTexture])

  const quaternion = useMemo(() => {
    const direction = new THREE.Vector3(
      cylinder.direction[0],
      cylinder.direction[1],
      cylinder.direction[2]
    )
    if (direction.lengthSq() < 0.000001) {
      direction.set(0, 0, 1)
    } else {
      direction.normalize()
    }
    return new THREE.Quaternion().setFromUnitVectors(WORLD_UP, direction)
  }, [cylinder.direction])

  const spawnSmokeParticle = (
    particleIndex: number,
    inLaunchPlumePhase: boolean,
    tailWorldX: number,
    tailWorldY: number,
    tailWorldZ: number,
    rightVector: THREE.Vector3,
    upVector: THREE.Vector3,
    smokeSpawnRadius: number
  ) => {
    const idx = particleIndex * 3
    const angle = Math.random() * Math.PI * 2
    const radialDistance = Math.sqrt(Math.random()) * smokeSpawnRadius
    const offsetX = rightVector.x * Math.cos(angle) * radialDistance + upVector.x * Math.sin(angle) * radialDistance
    const offsetY = rightVector.y * Math.cos(angle) * radialDistance + upVector.y * Math.sin(angle) * radialDistance
    const offsetZ = rightVector.z * Math.cos(angle) * radialDistance + upVector.z * Math.sin(angle) * radialDistance

    smokeParticleData.positions[idx] = tailWorldX + offsetX
    smokeParticleData.positions[idx + 1] = tailWorldY + offsetY
    smokeParticleData.positions[idx + 2] = tailWorldZ + offsetZ

    if (inLaunchPlumePhase) {
      const speed =
        LAUNCH_PLUME_MIN_SPEED + Math.random() * (LAUNCH_PLUME_MAX_SPEED - LAUNCH_PLUME_MIN_SPEED)
      const lateralViolence = 40 + Math.random() * 80
      const swirl = (Math.random() - 0.5) * 30
      smokeParticleData.velocities[idx] =
        -directionVector.x * speed
        + rightVector.x * ((Math.random() - 0.5) * lateralViolence)
        + upVector.x * ((Math.random() - 0.5) * lateralViolence)
        + swirl
      smokeParticleData.velocities[idx + 1] =
        -directionVector.y * speed
        + rightVector.y * ((Math.random() - 0.5) * lateralViolence)
        + upVector.y * ((Math.random() - 0.5) * lateralViolence)
        + swirl * 0.35
      smokeParticleData.velocities[idx + 2] =
        -directionVector.z * speed
        + rightVector.z * ((Math.random() - 0.5) * lateralViolence)
        + upVector.z * ((Math.random() - 0.5) * lateralViolence)
        + swirl
    } else {
      const backwardDrift = 8 + Math.random() * 10
      const randomDrift = 1.2 + Math.random() * 2.2
      smokeParticleData.velocities[idx] =
        cylinder.velocity[0] * 0.05 - directionVector.x * backwardDrift + (Math.random() - 0.5) * randomDrift
      smokeParticleData.velocities[idx + 1] =
        cylinder.velocity[1] * 0.05 - directionVector.y * backwardDrift + (Math.random() - 0.5) * randomDrift
      smokeParticleData.velocities[idx + 2] =
        cylinder.velocity[2] * 0.05 - directionVector.z * backwardDrift + (Math.random() - 0.5) * randomDrift
    }

    let life = SMOKE_MIN_LIFETIME_SECONDS + Math.random() * (SMOKE_MAX_LIFETIME_SECONDS - SMOKE_MIN_LIFETIME_SECONDS)
    if (inLaunchPlumePhase) {
      // Preheat launch plume so first render already has visible density.
      life *= 0.45 + Math.random() * 0.55
    }
    const startAlpha = inLaunchPlumePhase
      ? 0.72 + Math.random() * 0.24
      : 0.28 + Math.random() * 0.16
    smokeParticleData.lifetimes[particleIndex] = life
    smokeParticleData.maxLifetimes[particleIndex] = life
    smokeParticleData.startAlphas[particleIndex] = startAlpha
    smokeParticleData.alphas[particleIndex] = startAlpha
    smokeParticleData.wobblePhases[particleIndex] = Math.random() * Math.PI * 2
    smokeParticleData.wobbleFrequencies[particleIndex] =
      SMOKE_WOBBLE_FREQ_MIN + Math.random() * (SMOKE_WOBBLE_FREQ_MAX - SMOKE_WOBBLE_FREQ_MIN)
    smokeParticleData.turbulenceStrengths[particleIndex] = inLaunchPlumePhase
      ? SMOKE_TURBULENCE_MIN + Math.random() * (SMOKE_TURBULENCE_MAX - SMOKE_TURBULENCE_MIN)
      : SMOKE_TURBULENCE_MIN * 0.55 + Math.random() * (SMOKE_TURBULENCE_MAX * 0.65)
    smokeParticleData.sizeJitterPhases[particleIndex] = Math.random() * Math.PI * 2
  }

  useEffect(() => {
    const configurePoints = (points: THREE.Points | null) => {
      if (!points) return
      const positionAttr = points.geometry.getAttribute('position')
      const colorAttr = points.geometry.getAttribute('color')
      const sizeAttr = points.geometry.getAttribute('aSize')
      const alphaAttr = points.geometry.getAttribute('aAlpha')
      if (positionAttr instanceof THREE.BufferAttribute) {
        positionAttr.setUsage(THREE.DynamicDrawUsage)
      }
      if (colorAttr instanceof THREE.BufferAttribute) {
        colorAttr.setUsage(THREE.DynamicDrawUsage)
      }
      if (sizeAttr instanceof THREE.BufferAttribute) {
        sizeAttr.setUsage(THREE.DynamicDrawUsage)
      }
      if (alphaAttr instanceof THREE.BufferAttribute) {
        alphaAttr.setUsage(THREE.DynamicDrawUsage)
      }
    }
    const configureSizeShader = (material: THREE.PointsMaterial | null) => {
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

    configurePoints(thrusterPointsRef.current)
    configurePoints(smokePointsRef.current)
    configureSizeShader(thrusterMaterialRef.current)

    // Prewarm smoke so there is no visual delay right after launch.
    const tailWorldX = cylinder.position[0] - directionVector.x * cylinder.length * 0.52
    const tailWorldY = cylinder.position[1] - directionVector.y * cylinder.length * 0.52
    const tailWorldZ = cylinder.position[2] - directionVector.z * cylinder.length * 0.52
    const auxAxis = Math.abs(directionVector.y) > 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0)
    const rightVector = new THREE.Vector3().crossVectors(auxAxis, directionVector).normalize()
    const upVector = new THREE.Vector3().crossVectors(directionVector, rightVector).normalize()
    const smokeSpawnRadius = Math.max(0.3, cylinder.radius * 1.1)
    const prewarmCount = 36
    for (let i = 0; i < prewarmCount; i += 1) {
      spawnSmokeParticle(i, true, tailWorldX, tailWorldY, tailWorldZ, rightVector, upVector, smokeSpawnRadius)
    }
  }, [])

  useFrame((_state, deltaSeconds) => {
    const dt = Math.min(deltaSeconds, 0.05)
    launchAgeRef.current += dt
    const inLaunchPlumePhase = launchAgeRef.current <= LAUNCH_PLUME_DURATION_SECONDS
    const acceleratingNow = cylinder.flightTimeSeconds <= TORPEDO_ACCEL_DURATION_SECONDS
    const tailY = -cylinder.length * 0.52
    const nozzleRadius = Math.max(cylinder.radius * 0.7, PLAYER_MAX_SUBWARP_NOZZLE_RADIUS * 0.45)

    if (!acceleratingNow) {
      for (let i = 0; i < THRUSTER_PARTICLE_COUNT; i += 1) {
        const idx = i * 3
        thrusterParticleData.positions[idx] = PARTICLE_INACTIVE_POSITION
        thrusterParticleData.positions[idx + 1] = PARTICLE_INACTIVE_POSITION
        thrusterParticleData.positions[idx + 2] = PARTICLE_INACTIVE_POSITION
        thrusterParticleData.velocities[idx] = 0
        thrusterParticleData.velocities[idx + 1] = 0
        thrusterParticleData.velocities[idx + 2] = 0
        thrusterParticleData.lifetimes[i] = 0
        thrusterParticleData.maxLifetimes[i] = 0
        thrusterParticleData.colors[idx] = 0
        thrusterParticleData.colors[idx + 1] = 0
        thrusterParticleData.colors[idx + 2] = 0
        thrusterParticleData.sizes[i] = 0
        thrusterParticleData.spawnSizes[i] = 0
      }
      for (let i = 0; i < SMOKE_PARTICLE_COUNT; i += 1) {
        const idx = i * 3
        smokeParticleData.velocities[idx] = 0
        smokeParticleData.velocities[idx + 1] = 0
        smokeParticleData.velocities[idx + 2] = 0
        smokeParticleData.lifetimes[i] = 0
        smokeParticleData.maxLifetimes[i] = 0
        smokeParticleData.startAlphas[i] = 0
        smokeParticleData.alphas[i] = 0
        smokeParticleData.wobblePhases[i] = 0
        smokeParticleData.wobbleFrequencies[i] = 0
        smokeParticleData.turbulenceStrengths[i] = 0
        smokeParticleData.sizeJitterPhases[i] = 0
        smokeParticleData.colors[idx] = 0
        smokeParticleData.colors[idx + 1] = 0
        smokeParticleData.colors[idx + 2] = 0
        smokeParticleData.sizes[i] = 0
      }
      smokeSpawnRemainderRef.current = 0

      const thrusterPoints = thrusterPointsRef.current
      if (thrusterPoints) {
        const positionAttr = thrusterPoints.geometry.getAttribute('position')
        const colorAttr = thrusterPoints.geometry.getAttribute('color')
        const sizeAttr = thrusterPoints.geometry.getAttribute('aSize')
        if (positionAttr instanceof THREE.BufferAttribute) {
          positionAttr.needsUpdate = true
        }
        if (colorAttr instanceof THREE.BufferAttribute) {
          colorAttr.needsUpdate = true
        }
        if (sizeAttr instanceof THREE.BufferAttribute) {
          sizeAttr.needsUpdate = true
        }
      }

      const smokePoints = smokePointsRef.current
      if (smokePoints) {
        const positionAttr = smokePoints.geometry.getAttribute('position')
        const colorAttr = smokePoints.geometry.getAttribute('color')
        const sizeAttr = smokePoints.geometry.getAttribute('aSize')
        const alphaAttr = smokePoints.geometry.getAttribute('aAlpha')
        if (positionAttr instanceof THREE.BufferAttribute) {
          positionAttr.needsUpdate = true
        }
        if (colorAttr instanceof THREE.BufferAttribute) {
          colorAttr.needsUpdate = true
        }
        if (sizeAttr instanceof THREE.BufferAttribute) {
          sizeAttr.needsUpdate = true
        }
        if (alphaAttr instanceof THREE.BufferAttribute) {
          alphaAttr.needsUpdate = true
        }
      }
      if (thrusterMaterialRef.current) {
        thrusterMaterialRef.current.opacity = 0
      }
      return
    }
    if (thrusterMaterialRef.current) {
      thrusterMaterialRef.current.opacity = 0.95
    }

    for (let i = 0; i < THRUSTER_PARTICLE_COUNT; i += 1) {
      const idx = i * 3
      let life = thrusterParticleData.lifetimes[i] ?? 0
      life -= dt * PLAYER_MAX_SUBWARP_DECAY_RATE

      if (life <= 0) {
        if (Math.random() > PLAYER_MAX_SUBWARP_SPAWN_RATE * dt) {
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
        const radialDistance = Math.sqrt(Math.random()) * nozzleRadius * 0.7
        thrusterParticleData.positions[idx] = Math.cos(angle) * radialDistance
        thrusterParticleData.positions[idx + 1] = tailY
        thrusterParticleData.positions[idx + 2] = Math.sin(angle) * radialDistance

        const toAxisX = -(thrusterParticleData.positions[idx] ?? 0)
        const toAxisZ = -(thrusterParticleData.positions[idx + 2] ?? 0)
        const lateralDist = Math.max(0.001, Math.hypot(toAxisX, toAxisZ))
        const radialNormX = toAxisX / lateralDist
        const radialNormZ = toAxisZ / lateralDist
        const velocityJitter = 0.45 + Math.random() * 1.3
        const lateralJitter = 0.6 + Math.random() * 0.9
        const forwardJitter = 0.7 + Math.random() * 0.8
        const speedScale = 1.5
        const speedBase =
          (100 + 560 + Math.random() * 180) *
          (25 / 3) *
          velocityJitter *
          speedScale * 0.5
        const convergenceStrength = Math.tan(THREE.MathUtils.degToRad(10))
        const jitterX = (Math.random() - 0.5) * 0.08 * speedBase
        const jitterZ = (Math.random() - 0.5) * 0.08 * speedBase
        thrusterParticleData.velocities[idx] =
          radialNormX * speedBase * convergenceStrength * lateralJitter + jitterX
        thrusterParticleData.velocities[idx + 2] =
          radialNormZ * speedBase * convergenceStrength * lateralJitter + jitterZ
        thrusterParticleData.velocities[idx + 1] = -speedBase * forwardJitter

        life = (0.18 + Math.random() * 0.55) * PLAYER_MAX_SUBWARP_LIFETIME_SCALE / 24
        thrusterParticleData.maxLifetimes[i] = life
        thrusterParticleData.spawnSizes[i] = PLAYER_MAX_SUBWARP_SPAWN_SIZE
        thrusterParticleData.endSizeScales[i] = 0.4 + Math.random() * 0.2
      } else {
        const velX = thrusterParticleData.velocities[idx] ?? 0
        const velY = thrusterParticleData.velocities[idx + 1] ?? 0
        const velZ = thrusterParticleData.velocities[idx + 2] ?? 0
        thrusterParticleData.positions[idx] = (thrusterParticleData.positions[idx] ?? 0) + velX * dt
        thrusterParticleData.positions[idx + 1] = (thrusterParticleData.positions[idx + 1] ?? 0) + velY * dt
        thrusterParticleData.positions[idx + 2] = (thrusterParticleData.positions[idx + 2] ?? 0) + velZ * dt

        const spreadDamping = Math.max(0, 1 - dt * 0.35)
        thrusterParticleData.velocities[idx] = velX * spreadDamping
        thrusterParticleData.velocities[idx + 2] = velZ * spreadDamping
      }

      thrusterParticleData.lifetimes[i] = life
      const maxLife = thrusterParticleData.maxLifetimes[i] ?? 0
      if (life > 0 && maxLife > 0) {
        const ageRatio = 1 - THREE.MathUtils.clamp(life / maxLife, 0, 1)
        thrusterParticleData.colors[idx] = THREE.MathUtils.lerp(0.35, 1.0, ageRatio)
        thrusterParticleData.colors[idx + 1] = THREE.MathUtils.lerp(0.7, 0.45, ageRatio)
        thrusterParticleData.colors[idx + 2] = THREE.MathUtils.lerp(1.0, 0.08, ageRatio)
        const spawnSize = thrusterParticleData.spawnSizes[i] ?? PLAYER_MAX_SUBWARP_SPAWN_SIZE
        const endScale = thrusterParticleData.endSizeScales[i] ?? 0.5
        thrusterParticleData.sizes[i] = spawnSize * THREE.MathUtils.lerp(1, endScale, ageRatio)
      } else {
        thrusterParticleData.colors[idx] = 0
        thrusterParticleData.colors[idx + 1] = 0
        thrusterParticleData.colors[idx + 2] = 0
        thrusterParticleData.sizes[i] = 0
      }
    }

    const thrusterPoints = thrusterPointsRef.current
    if (thrusterPoints) {
      const positionAttr = thrusterPoints.geometry.getAttribute('position')
      const colorAttr = thrusterPoints.geometry.getAttribute('color')
      const sizeAttr = thrusterPoints.geometry.getAttribute('aSize')
      if (positionAttr instanceof THREE.BufferAttribute) {
        positionAttr.needsUpdate = true
      }
      if (colorAttr instanceof THREE.BufferAttribute) {
        colorAttr.needsUpdate = true
      }
      if (sizeAttr instanceof THREE.BufferAttribute) {
        sizeAttr.needsUpdate = true
      }
    }

    const tailWorldX = cylinder.position[0] - directionVector.x * cylinder.length * 0.52
    const tailWorldY = cylinder.position[1] - directionVector.y * cylinder.length * 0.52
    const tailWorldZ = cylinder.position[2] - directionVector.z * cylinder.length * 0.52
    const auxAxis = Math.abs(directionVector.y) > 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0)
    const rightVector = new THREE.Vector3().crossVectors(auxAxis, directionVector).normalize()
    const upVector = new THREE.Vector3().crossVectors(directionVector, rightVector).normalize()
    const smokeSpawnRadius = Math.max(0.3, cylinder.radius * 1.1)
    const spawnRate = inLaunchPlumePhase ? LAUNCH_PLUME_SPAWN_RATE : SMOKE_SPAWN_RATE
    smokeSpawnRemainderRef.current += spawnRate * dt
    let guaranteedSpawnCount = Math.floor(smokeSpawnRemainderRef.current)
    smokeSpawnRemainderRef.current -= guaranteedSpawnCount

    for (let i = 0; i < SMOKE_PARTICLE_COUNT; i += 1) {
      const idx = i * 3
      let life = smokeParticleData.lifetimes[i] ?? 0
      life -= dt

      if (life <= 0) {
        const shouldSpawn = guaranteedSpawnCount > 0
        if (!shouldSpawn) {
          smokeParticleData.alphas[i] = 0
          smokeParticleData.colors[idx] = 0
          smokeParticleData.colors[idx + 1] = 0
          smokeParticleData.colors[idx + 2] = 0
          smokeParticleData.sizes[i] = 0
          continue
        }
        guaranteedSpawnCount -= 1
        spawnSmokeParticle(i, inLaunchPlumePhase, tailWorldX, tailWorldY, tailWorldZ, rightVector, upVector, smokeSpawnRadius)
        life = smokeParticleData.lifetimes[i] ?? 0
      }

      const velX = smokeParticleData.velocities[idx] ?? 0
      const velY = smokeParticleData.velocities[idx + 1] ?? 0
      const velZ = smokeParticleData.velocities[idx + 2] ?? 0
      const wobblePhase = smokeParticleData.wobblePhases[i] ?? 0
      const wobbleFreq = smokeParticleData.wobbleFrequencies[i] ?? SMOKE_WOBBLE_FREQ_MIN
      const turbulence = smokeParticleData.turbulenceStrengths[i] ?? SMOKE_TURBULENCE_MIN
      const wobbleTime = launchAgeRef.current * wobbleFreq + wobblePhase
      const lifeRatio = (smokeParticleData.maxLifetimes[i] ?? 0) > 0
        ? THREE.MathUtils.clamp(life / (smokeParticleData.maxLifetimes[i] ?? 1), 0, 1)
        : 0
      const ageRatioForTurbulence = 1 - lifeRatio
      const turbulenceEnvelope = 0.35 + ageRatioForTurbulence * 1.5
      const jitterX = Math.sin(wobbleTime) * turbulence * turbulenceEnvelope
      const jitterY = Math.cos(wobbleTime * 1.35 + 0.9) * turbulence * 0.55 * turbulenceEnvelope
      const jitterZ = Math.sin(wobbleTime * 0.8 + 1.7) * turbulence * turbulenceEnvelope
      const nextVelX = velX + jitterX * dt * SMOKE_TURBULENCE_ACCEL
      const nextVelY = velY + jitterY * dt * SMOKE_TURBULENCE_ACCEL
      const nextVelZ = velZ + jitterZ * dt * SMOKE_TURBULENCE_ACCEL
      smokeParticleData.positions[idx] = (smokeParticleData.positions[idx] ?? 0) + nextVelX * dt
      smokeParticleData.positions[idx + 1] = (smokeParticleData.positions[idx + 1] ?? 0) + nextVelY * dt
      smokeParticleData.positions[idx + 2] = (smokeParticleData.positions[idx + 2] ?? 0) + nextVelZ * dt
      const smokeVelocityDamping = Math.exp(-SMOKE_VELOCITY_DRAG * dt)
      smokeParticleData.velocities[idx] = nextVelX * smokeVelocityDamping
      smokeParticleData.velocities[idx + 1] = nextVelY * smokeVelocityDamping
      smokeParticleData.velocities[idx + 2] = nextVelZ * smokeVelocityDamping

      smokeParticleData.lifetimes[i] = life
      const maxLife = smokeParticleData.maxLifetimes[i] ?? 0
      if (life > 0 && maxLife > 0) {
        const ageRatio = 1 - THREE.MathUtils.clamp(life / maxLife, 0, 1)
        const smokeBrightness = ageRatio <= 0.25
          ? THREE.MathUtils.lerp(1.0, 0.45, ageRatio / 0.25)
          : THREE.MathUtils.lerp(0.45, 0.2, (ageRatio - 0.25) / 0.75)
        smokeParticleData.colors[idx] = smokeBrightness
        smokeParticleData.colors[idx + 1] = smokeBrightness
        smokeParticleData.colors[idx + 2] = smokeBrightness
        const billowGrowth = Math.pow(ageRatio, 1.35)
        const sizeJitter = 0.88 + Math.sin(wobbleTime * 0.65 + (smokeParticleData.sizeJitterPhases[i] ?? 0)) * 0.12
        smokeParticleData.sizes[i] =
          THREE.MathUtils.lerp(SMOKE_START_SIZE, SMOKE_END_SIZE, billowGrowth) * Math.max(0.72, sizeJitter)
        const fade = Math.pow(1 - ageRatio, 1.35)
        smokeParticleData.alphas[i] = (smokeParticleData.startAlphas[i] ?? 0) * fade
      } else {
        smokeParticleData.alphas[i] = 0
        smokeParticleData.colors[idx] = 0
        smokeParticleData.colors[idx + 1] = 0
        smokeParticleData.colors[idx + 2] = 0
        smokeParticleData.sizes[i] = 0
      }
    }

    const smokePoints = smokePointsRef.current
    if (smokePoints) {
      const positionAttr = smokePoints.geometry.getAttribute('position')
      const colorAttr = smokePoints.geometry.getAttribute('color')
      const sizeAttr = smokePoints.geometry.getAttribute('aSize')
      const alphaAttr = smokePoints.geometry.getAttribute('aAlpha')
      if (positionAttr instanceof THREE.BufferAttribute) {
        positionAttr.needsUpdate = true
      }
      if (colorAttr instanceof THREE.BufferAttribute) {
        colorAttr.needsUpdate = true
      }
      if (sizeAttr instanceof THREE.BufferAttribute) {
        sizeAttr.needsUpdate = true
      }
      if (alphaAttr instanceof THREE.BufferAttribute) {
        alphaAttr.needsUpdate = true
      }
    }
  })

  return (
    <>
      <group position={cylinder.position} quaternion={quaternion}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[cylinder.radius, cylinder.radius, cylinder.length, 16, 1, false]} />
          <meshStandardMaterial color={0xffaa33} emissive={0x442200} roughness={0.45} metalness={0.1} />
        </mesh>
        <points ref={thrusterPointsRef} frustumCulled={false}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[thrusterParticleData.positions, 3]} />
            <bufferAttribute attach="attributes-color" args={[thrusterParticleData.colors, 3]} />
            <bufferAttribute attach="attributes-aSize" args={[thrusterParticleData.sizes, 1]} />
          </bufferGeometry>
          <pointsMaterial
            ref={thrusterMaterialRef}
            size={PLAYER_MAX_SUBWARP_SPAWN_SIZE}
            sizeAttenuation
            vertexColors
            transparent
            opacity={0.95}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </points>
        {isAccelerating && (
          <>
            <mesh position={[0, -cylinder.length * 0.54, 0]}>
              <sphereGeometry args={[Math.max(0.08, cylinder.radius * 0.22), 12, 12]} />
              <meshStandardMaterial
                color={0xffae52}
                emissive={0xff6a1c}
                emissiveIntensity={2.4}
                roughness={1}
                metalness={0}
                transparent
                opacity={TORPEDO_NOZZLE_GLOW_OPACITY}
                depthWrite={false}
              />
            </mesh>
            <sprite
              position={[0, -cylinder.length * 0.56, 0]}
              scale={[Math.max(1.25, cylinder.radius * 2.8), Math.max(1.25, cylinder.radius * 2.8), 1]}
            >
              <spriteMaterial
                map={nozzleFlareTexture ?? undefined}
                color={0xffb46a}
                transparent
                opacity={TORPEDO_NOZZLE_FLARE_OPACITY}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </sprite>
          </>
        )}
      </group>
      <points ref={smokePointsRef} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[smokeParticleData.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[smokeParticleData.colors, 3]} />
          <bufferAttribute attach="attributes-aSize" args={[smokeParticleData.sizes, 1]} />
          <bufferAttribute attach="attributes-aAlpha" args={[smokeParticleData.alphas, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={smokeMaterialRef}
          uniforms={smokeUniforms}
          transparent
          blending={THREE.NormalBlending}
          depthWrite={false}
          vertexShader={`
            attribute float aSize;
            attribute float aAlpha;
            attribute vec3 color;
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
              vColor = color;
              vAlpha = aAlpha;
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              gl_PointSize = aSize * (300.0 / max(1.0, -mvPosition.z));
              gl_Position = projectionMatrix * mvPosition;
            }
          `}
          fragmentShader={`
            uniform sampler2D uMap;
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
              vec4 smokeSample = texture2D(uMap, gl_PointCoord);
              float alpha = smokeSample.a * vAlpha;
              if (alpha < 0.01) discard;
              gl_FragColor = vec4(vColor, alpha);
            }
          `}
        />
      </points>
    </>
  )
}

export function LaunchedCylinders() {
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const launchedCylinders = useGameStore((s) => s.launchedCylinders)
  const advanceLaunchedCylinders = useGameStore((s) => s.advanceLaunchedCylinders)

  useFrame((_state, deltaSeconds) => {
    advanceLaunchedCylinders(deltaSeconds)
  })

  const visibleCylinders = useMemo(
    () => launchedCylinders.filter((cylinder) => cylinder.currentCelestialId === currentCelestialId),
    [currentCelestialId, launchedCylinders]
  )

  if (visibleCylinders.length === 0) return null

  return (
    <>
      {visibleCylinders.map((cylinder) => (
        <LaunchedCylinderMesh key={cylinder.id} cylinder={cylinder} />
      ))}
    </>
  )
}
