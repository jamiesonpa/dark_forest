import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import type { LaunchedFlare } from '@/state/types'

const FLARE_RADIUS = 6
const FLARE_EMISSIVE_INTENSITY = 14
const FLARE_CORE_SCALE = 72
const FLARE_HALO_SCALE = 130
const MAX_SMOKE_PARTICLES = 3200
const SMOKE_BURST_PARTICLE_COUNT = 44
const SMOKE_START_RATE_PER_SECOND = 95
const SMOKE_END_RATE_PER_SECOND = 22
const SMOKE_REFERENCE_LIFETIME_SECONDS = 3
const SMOKE_VELOCITY_DAMPING = 1.2
const SMOKE_UPWARD_DRIFT_PER_SECOND = 8

type SmokeParticle = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  ageSeconds: number
  lifeSeconds: number
  startSize: number
  endSize: number
  startAlpha: number
  colorR: number
  colorG: number
  colorB: number
}

function createLensFlareTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  const center = 64
  const gradient = ctx.createRadialGradient(center, center, 2, center, center, center)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.85)')
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.3)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function createSmokeParticleTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  const center = 32
  const gradient = ctx.createRadialGradient(center, center, 1, center, center, center)
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.6)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function randomSigned(magnitude: number) {
  return (Math.random() * 2 - 1) * magnitude
}

export function LaunchedFlares() {
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const launchedFlares = useGameStore((s) => s.launchedFlares)
  const advanceLaunchedFlares = useGameStore((s) => s.advanceLaunchedFlares)
  const lensFlareTexture = useMemo(() => createLensFlareTexture(), [])
  const smokeTexture = useMemo(() => createSmokeParticleTexture(), [])
  const smokeGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const smokeParticlesRef = useRef<SmokeParticle[]>([])
  const activeParticleCountRef = useRef(0)
  const seenFlareIdsRef = useRef(new Set<string>())
  const flareSpawnAccumulatorRef = useRef<Record<string, number>>({})
  const smokePositions = useMemo(() => new Float32Array(MAX_SMOKE_PARTICLES * 3), [])
  const smokeColors = useMemo(() => new Float32Array(MAX_SMOKE_PARTICLES * 3), [])
  const smokeSizes = useMemo(() => new Float32Array(MAX_SMOKE_PARTICLES), [])
  const smokeAlphas = useMemo(() => new Float32Array(MAX_SMOKE_PARTICLES), [])
  const smokeUniforms = useMemo(
    () => ({
      uMap: { value: smokeTexture },
    }),
    [smokeTexture]
  )

  const spawnSmokeParticles = (flare: LaunchedFlare, count: number) => {
    if (count <= 0) return
    const particles = smokeParticlesRef.current
    const flareSpeed = Math.hypot(flare.velocity[0], flare.velocity[1], flare.velocity[2])
    const speedScale = flareSpeed > 0.001 ? 1 / flareSpeed : 0
    const dirX = flare.velocity[0] * speedScale
    const dirY = flare.velocity[1] * speedScale
    const dirZ = flare.velocity[2] * speedScale
    const cappedCount = Math.min(count, MAX_SMOKE_PARTICLES)

    for (let i = 0; i < cappedCount; i += 1) {
      if (particles.length >= MAX_SMOKE_PARTICLES) {
        particles.shift()
      }

      const startSize = (8 + Math.random() * 8) * 3
      const growthScale = 2.2 + Math.random() * 2.1
      const toRearVelocity = 50 + Math.random() * 70
      const inheritFactor = 0.13 + Math.random() * 0.17
      const gray = 0.78 + Math.random() * 0.22

      particles.push({
        x: flare.position[0] + randomSigned(7),
        y: flare.position[1] + randomSigned(7),
        z: flare.position[2] + randomSigned(7),
        vx: flare.velocity[0] * inheritFactor - dirX * toRearVelocity + randomSigned(24),
        vy: flare.velocity[1] * inheritFactor - dirY * toRearVelocity + randomSigned(24),
        vz: flare.velocity[2] * inheritFactor - dirZ * toRearVelocity + randomSigned(24),
        ageSeconds: 0,
        lifeSeconds: 0.8 + Math.random() * 1.25,
        startSize,
        endSize: startSize * growthScale,
        startAlpha: 0.48 + Math.random() * 0.42,
        colorR: gray,
        colorG: gray,
        colorB: gray,
      })
    }
  }

  useEffect(() => {
    return () => {
      lensFlareTexture.dispose()
      smokeTexture.dispose()
    }
  }, [lensFlareTexture, smokeTexture])

  useFrame((_state, deltaSeconds) => {
    advanceLaunchedFlares(deltaSeconds)

    const latestState = useGameStore.getState()
    const activeFlares = latestState.launchedFlares.filter(
      (flare) => flare.currentCelestialId === latestState.currentCelestialId
    )
    const activeFlareIds = new Set(activeFlares.map((flare) => flare.id))

    for (const flare of activeFlares) {
      if (!seenFlareIdsRef.current.has(flare.id)) {
        seenFlareIdsRef.current.add(flare.id)
        flareSpawnAccumulatorRef.current[flare.id] = 0
        // Dense impulse right at ejection.
        spawnSmokeParticles(flare, SMOKE_BURST_PARTICLE_COUNT)
      }

      const normalizedAge = clamp01(flare.flightTimeSeconds / SMOKE_REFERENCE_LIFETIME_SECONDS)
      const spawnRate = lerp(
        SMOKE_START_RATE_PER_SECOND,
        SMOKE_END_RATE_PER_SECOND,
        normalizedAge
      )
      const prevAccumulator = flareSpawnAccumulatorRef.current[flare.id] ?? 0
      const nextAccumulator = prevAccumulator + spawnRate * deltaSeconds
      const spawnCount = Math.floor(nextAccumulator)
      flareSpawnAccumulatorRef.current[flare.id] = nextAccumulator - spawnCount
      spawnSmokeParticles(flare, spawnCount)
    }

    for (const flareId of seenFlareIdsRef.current) {
      if (!activeFlareIds.has(flareId)) {
        delete flareSpawnAccumulatorRef.current[flareId]
      }
    }
    seenFlareIdsRef.current = activeFlareIds

    const damping = Math.exp(-SMOKE_VELOCITY_DAMPING * deltaSeconds)
    const particles = smokeParticlesRef.current
    const nextParticles: SmokeParticle[] = []
    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i]
      if (!particle) continue
      const nextAge = particle.ageSeconds + deltaSeconds
      if (nextAge >= particle.lifeSeconds) {
        continue
      }

      particle.ageSeconds = nextAge
      particle.vx *= damping
      particle.vy = particle.vy * damping + SMOKE_UPWARD_DRIFT_PER_SECOND * deltaSeconds
      particle.vz *= damping
      particle.x += particle.vx * deltaSeconds
      particle.y += particle.vy * deltaSeconds
      particle.z += particle.vz * deltaSeconds
      nextParticles.push(particle)
    }
    smokeParticlesRef.current = nextParticles

    const activeCount = Math.min(nextParticles.length, MAX_SMOKE_PARTICLES)
    activeParticleCountRef.current = activeCount
    for (let i = 0; i < activeCount; i += 1) {
      const particle = nextParticles[i]
      if (!particle) continue
      const t = clamp01(particle.ageSeconds / particle.lifeSeconds)
      const fade = Math.pow(1 - t, 1.55)
      const size = lerp(particle.startSize, particle.endSize, t)
      const stride = i * 3
      smokePositions[stride] = particle.x
      smokePositions[stride + 1] = particle.y
      smokePositions[stride + 2] = particle.z
      smokeColors[stride] = particle.colorR
      smokeColors[stride + 1] = particle.colorG
      smokeColors[stride + 2] = particle.colorB
      smokeSizes[i] = size
      smokeAlphas[i] = particle.startAlpha * fade
    }

    const geometry = smokeGeometryRef.current
    if (!geometry) return
    geometry.setDrawRange(0, activeCount)
    const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
    const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    const sizeAttr = geometry.getAttribute('aSize') as THREE.BufferAttribute | undefined
    const alphaAttr = geometry.getAttribute('aAlpha') as THREE.BufferAttribute | undefined
    if (positionAttr) positionAttr.needsUpdate = true
    if (colorAttr) colorAttr.needsUpdate = true
    if (sizeAttr) sizeAttr.needsUpdate = true
    if (alphaAttr) alphaAttr.needsUpdate = true
  })

  const visibleFlares = useMemo(
    () => launchedFlares.filter((flare) => flare.currentCelestialId === currentCelestialId),
    [currentCelestialId, launchedFlares]
  )

  return (
    <>
      <points frustumCulled={false}>
        <bufferGeometry ref={smokeGeometryRef}>
          <bufferAttribute attach="attributes-position" args={[smokePositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[smokeColors, 3]} />
          <bufferAttribute attach="attributes-aSize" args={[smokeSizes, 1]} />
          <bufferAttribute attach="attributes-aAlpha" args={[smokeAlphas, 1]} />
        </bufferGeometry>
        <shaderMaterial
          uniforms={smokeUniforms}
          transparent
          depthWrite={false}
          blending={THREE.NormalBlending}
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
      {visibleFlares.map((flare) => (
        <group key={flare.id} position={flare.position}>
          <mesh>
            <sphereGeometry args={[FLARE_RADIUS, 8, 8]} />
            <meshStandardMaterial
              color={0xffffff}
              emissive={0xffffff}
              emissiveIntensity={FLARE_EMISSIVE_INTENSITY}
              roughness={0.05}
              metalness={0}
              toneMapped={false}
            />
          </mesh>
          <sprite scale={[FLARE_CORE_SCALE, FLARE_CORE_SCALE, 1]}>
            <spriteMaterial
              map={lensFlareTexture}
              color={0xffffff}
              transparent
              opacity={0.95}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </sprite>
          <sprite scale={[FLARE_HALO_SCALE, FLARE_HALO_SCALE, 1]}>
            <spriteMaterial
              map={lensFlareTexture}
              color={0xffffff}
              transparent
              opacity={0.55}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </sprite>
        </group>
      ))}
    </>
  )
}
