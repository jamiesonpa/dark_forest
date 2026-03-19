import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import type { TorpedoExplosion } from '@/state/types'

const DEBRIS_COUNT = 192
const SMOKE_MAX_PARTICLES = 18000
const SMOKE_DRAG = 0.95
const SMOKE_UPWARD_DRIFT = 10
const SHIP_DESTRUCTION_SMOKE_DRAG = 0.18
const EXPLOSION_FLASH_PEAK_SECONDS = 0.16
const EXPLOSION_LENS_MAX_SCALE = 5200 // doubled size
const EXPLOSION_CORE_MAX_SCALE = 1640 // doubled size
const EXPLOSION_LIFETIME_SECONDS = 7.2
const LENS_FADE_IN_SECONDS = 0.035
const LENS_PEAK_HOLD_SECONDS = 0.06
const LENS_FADE_OUT_SECONDS = 0.44
const SHIP_DESTRUCTION_OVERALL_SIZE_MULTIPLIER = 1 / 3
const SHIP_DESTRUCTION_LENS_SMALL_PHASE_SECONDS = 2
const SHIP_DESTRUCTION_LENS_EXPAND_PHASE_SECONDS = 5
const SHIP_DESTRUCTION_LENS_FINAL_SCALE_MULTIPLIER = 5 / 3
const SHIP_DESTRUCTION_LENS_SMALL_SCALE_MULTIPLIER = SHIP_DESTRUCTION_LENS_FINAL_SCALE_MULTIPLIER * 0.42
const SHIP_DESTRUCTION_LENS_EXTRA_SIZE_REDUCTION = 0.5
const SHIP_DESTRUCTION_DEBRIS_BURST_RADIUS_MULTIPLIER = 3
const SHIP_DESTRUCTION_DEBRIS_BURST_SPEED_MULTIPLIER = 3
const SHIP_DESTRUCTION_DEBRIS_TRAVEL_DISTANCE_MULTIPLIER = 5
const SHIP_DESTRUCTION_SECOND_WAVE_DELAY_SECONDS = 2
const SHIP_DESTRUCTION_SECOND_WAVE_SPEED_MULTIPLIER = 2
const SHIP_DESTRUCTION_SECOND_WAVE_DISTANCE_MULTIPLIER = 2
const SHIP_DESTRUCTION_SMOKE_BURST_RADIUS_MULTIPLIER = 3
const SHIP_DESTRUCTION_SMOKE_BURST_SPEED_MULTIPLIER = 3
const SHIP_DESTRUCTION_SMOKE_TRAIL_LIFE_MULTIPLIER = 2.8
const SHIP_DESTRUCTION_SMOKE_SIZE_MULTIPLIER = 2.2
const SHIP_DESTRUCTION_SMOKE_MAX_SIZE_MULTIPLIER = 3
const SHIP_DESTRUCTION_SMOKE_TRAIL_SPAWN_BIAS = 0.4
const SHIP_DESTRUCTION_SMOKE_ORIGIN_SPHERE_SCALE = 0.2
const SHIP_DESTRUCTION_TRAIL_VELOCITY_INHERIT = 0.18
const SHIP_DESTRUCTION_TRAIL_EMISSION_RATE_PER_FRAGMENT = 6
const SHIP_DESTRUCTION_HORIZON_STREAK_WIDTH_MULTIPLIER = 4.2
const SHIP_DESTRUCTION_HORIZON_STREAK_HEIGHT_MULTIPLIER = 0.055
const SHIP_DESTRUCTION_HORIZON_STREAK_OUTER_WIDTH_MULTIPLIER = 6.5
const SHIP_DESTRUCTION_HORIZON_STREAK_OUTER_HEIGHT_MULTIPLIER = 0.03

type SmokeParticle = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  staticTrail: boolean
  ageSeconds: number
  lifeSeconds: number
  sizeStart: number
  sizeEnd: number
  alphaStart: number
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function smoothstep01(value: number) {
  const t = clamp01(value)
  return t * t * (3 - 2 * t)
}

function fastLensPulse(ageSeconds: number, durationMultiplier = 1) {
  const safeDuration = Math.max(0.1, durationMultiplier)
  const fadeInSeconds = LENS_FADE_IN_SECONDS * safeDuration
  const peakHoldSeconds = LENS_PEAK_HOLD_SECONDS * safeDuration
  const fadeOutSeconds = LENS_FADE_OUT_SECONDS * safeDuration
  const inT = clamp01(ageSeconds / fadeInSeconds)
  const outStart = fadeInSeconds + peakHoldSeconds
  const outT = clamp01((ageSeconds - outStart) / fadeOutSeconds)
  return Math.pow(inT, 0.45) * Math.pow(1 - outT, 1.55)
}

function shipDestructionFlickerFactor(ageSeconds: number) {
  const flickerWindowSeconds = 0.9
  if (ageSeconds >= flickerWindowSeconds) return 1
  const ramp = clamp01(ageSeconds / flickerWindowSeconds)
  const rawFlicker = 0.35 + 0.65 * Math.abs(Math.sin(ageSeconds * 75) * Math.cos(ageSeconds * 29))
  return THREE.MathUtils.lerp(rawFlicker, 1, ramp)
}

function getLensPulseDurationMultiplier(totalSeconds: number) {
  const baseSeconds = LENS_FADE_IN_SECONDS + LENS_PEAK_HOLD_SECONDS + LENS_FADE_OUT_SECONDS
  return Math.max(0.1, totalSeconds / Math.max(0.001, baseSeconds))
}

function lerpHexColor(fromHex: number, toHex: number, t: number) {
  return new THREE.Color(fromHex).lerp(new THREE.Color(toHex), clamp01(t)).getHex()
}

function createLensFlareTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }
  const center = canvas.width / 2
  const gradient = ctx.createRadialGradient(center, center, 2, center, center, center)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.2, 'rgba(255,238,208,0.95)')
  gradient.addColorStop(0.5, 'rgba(255,170,94,0.52)')
  gradient.addColorStop(1, 'rgba(255,130,70,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function createLensRingTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }
  const center = canvas.width / 2
  const outer = center
  const inner = center * 0.5
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const ring = ctx.createRadialGradient(center, center, inner, center, center, outer)
  ring.addColorStop(0, 'rgba(255,255,255,0)')
  ring.addColorStop(0.35, 'rgba(255,236,210,0.25)')
  ring.addColorStop(0.52, 'rgba(255,220,180,0.9)')
  ring.addColorStop(0.68, 'rgba(255,175,125,0.45)')
  ring.addColorStop(1, 'rgba(255,130,90,0)')
  ctx.fillStyle = ring
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function createSmokeTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }
  const center = canvas.width / 2
  const gradient = ctx.createRadialGradient(center, center, 1, center, center, center)
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)')
  gradient.addColorStop(0.38, 'rgba(255,255,255,0.72)')
  gradient.addColorStop(0.75, 'rgba(255,255,255,0.2)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function ExplosionInstance({ explosion }: { explosion: TorpedoExplosion }) {
  const isShipDestruction = explosion.kind === 'ship-destruction'
  const debrisSizeMultiplier = isShipDestruction ? 5 * SHIP_DESTRUCTION_OVERALL_SIZE_MULTIPLIER : 1
  const debrisLifeMultiplier = isShipDestruction ? 5 : 1
  const smokeSizeMultiplier = isShipDestruction
    ? 5 * SHIP_DESTRUCTION_OVERALL_SIZE_MULTIPLIER * SHIP_DESTRUCTION_SMOKE_SIZE_MULTIPLIER
    : 1
  const smokeLifeMultiplier = isShipDestruction
    ? 5 * SHIP_DESTRUCTION_SMOKE_TRAIL_LIFE_MULTIPLIER
    : 1
  const lensFlareTexture = useMemo(() => createLensFlareTexture(), [])
  const lensRingTexture = useMemo(() => createLensRingTexture(), [])
  const smokeTexture = useMemo(() => createSmokeTexture(), [])
  const smokeUniforms = useMemo(() => ({ uMap: { value: smokeTexture } }), [smokeTexture])

  const debrisGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const smokeGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const debrisPositions = useMemo(() => new Float32Array(DEBRIS_COUNT * 3), [])
  const debrisVelocities = useMemo(() => new Float32Array(DEBRIS_COUNT * 3), [])
  const debrisColors = useMemo(() => new Float32Array(DEBRIS_COUNT * 3), [])
  const debrisSizes = useMemo(() => new Float32Array(DEBRIS_COUNT), [])
  const debrisAlphas = useMemo(() => new Float32Array(DEBRIS_COUNT), [])
  const debrisLife = useMemo(() => new Float32Array(DEBRIS_COUNT), [])
  const debrisMaxLife = useMemo(() => new Float32Array(DEBRIS_COUNT), [])

  const smokeParticlesRef = useRef<SmokeParticle[]>([])
  const smokePositions = useMemo(() => new Float32Array(SMOKE_MAX_PARTICLES * 3), [])
  const smokeColors = useMemo(() => new Float32Array(SMOKE_MAX_PARTICLES * 3), [])
  const smokeSizes = useMemo(() => new Float32Array(SMOKE_MAX_PARTICLES), [])
  const smokeAlphas = useMemo(() => new Float32Array(SMOKE_MAX_PARTICLES), [])
  const secondWaveActivatedRef = useRef(!isShipDestruction)
  const firstWaveCount = isShipDestruction ? Math.floor(DEBRIS_COUNT / 2) : DEBRIS_COUNT
  const debrisPhaseDelaySeconds = isShipDestruction
    ? SHIP_DESTRUCTION_LENS_SMALL_PHASE_SECONDS
    : 0

  useEffect(() => {
    // Seed debris with an isotropic burst.
    for (let i = 0; i < DEBRIS_COUNT; i += 1) {
      const stride = i * 3
      if (isShipDestruction && i >= firstWaveCount) {
        debrisPositions[stride] = 0
        debrisPositions[stride + 1] = 0
        debrisPositions[stride + 2] = 0
        debrisVelocities[stride] = 0
        debrisVelocities[stride + 1] = 0
        debrisVelocities[stride + 2] = 0
        debrisColors[stride] = 0
        debrisColors[stride + 1] = 0
        debrisColors[stride + 2] = 0
        debrisSizes[i] = 0
        debrisLife[i] = 0
        debrisMaxLife[i] = 0
        debrisAlphas[i] = 0
        continue
      }
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize()
      const burstRadiusMultiplier = isShipDestruction
        ? SHIP_DESTRUCTION_DEBRIS_BURST_RADIUS_MULTIPLIER
        : 1
      const burstSpeedMultiplier = isShipDestruction
        ? SHIP_DESTRUCTION_DEBRIS_BURST_SPEED_MULTIPLIER
        : 1
      const travelDistanceMultiplier = isShipDestruction
        ? SHIP_DESTRUCTION_DEBRIS_TRAVEL_DISTANCE_MULTIPLIER
        : 1
      const speed = (180 + Math.random() * 620) * burstSpeedMultiplier * travelDistanceMultiplier
      debrisPositions[stride] = (Math.random() * 2 - 1) * 8 * burstRadiusMultiplier
      debrisPositions[stride + 1] = (Math.random() * 2 - 1) * 8 * burstRadiusMultiplier
      debrisPositions[stride + 2] = (Math.random() * 2 - 1) * 8 * burstRadiusMultiplier
      debrisVelocities[stride] = dir.x * speed
      debrisVelocities[stride + 1] = dir.y * speed
      debrisVelocities[stride + 2] = dir.z * speed
      debrisColors[stride] = 1
      debrisColors[stride + 1] = 0.72 + Math.random() * 0.22
      debrisColors[stride + 2] = 0.36 + Math.random() * 0.2
      debrisSizes[i] = (24 + Math.random() * 28) * debrisSizeMultiplier
      const life = (0.55 + Math.random() * 0.6) * debrisLifeMultiplier
      debrisLife[i] = life
      debrisMaxLife[i] = life
      debrisAlphas[i] = 1
    }
    secondWaveActivatedRef.current = !isShipDestruction
    return () => {
      lensFlareTexture.dispose()
      lensRingTexture.dispose()
      smokeTexture.dispose()
    }
  }, [
    debrisColors,
    debrisLife,
    debrisMaxLife,
    debrisPositions,
    debrisAlphas,
    debrisSizes,
    debrisVelocities,
    debrisLifeMultiplier,
    debrisSizeMultiplier,
    lensFlareTexture,
    lensRingTexture,
    smokeLifeMultiplier,
    smokeSizeMultiplier,
    firstWaveCount,
    isShipDestruction,
    smokeTexture,
  ])

  useFrame((_state, deltaSeconds) => {
    const dt = Math.min(deltaSeconds, 0.05)
    const debrisPhaseActive = explosion.flightTimeSeconds >= debrisPhaseDelaySeconds
    if (!debrisPhaseActive) {
      return
    }
    if (
      isShipDestruction
      && !secondWaveActivatedRef.current
      && explosion.flightTimeSeconds >= debrisPhaseDelaySeconds + SHIP_DESTRUCTION_SECOND_WAVE_DELAY_SECONDS
    ) {
      for (let i = firstWaveCount; i < DEBRIS_COUNT; i += 1) {
        const stride = i * 3
        const dir = new THREE.Vector3(
          Math.random() * 2 - 1,
          Math.random() * 2 - 1,
          Math.random() * 2 - 1
        ).normalize()
        const speed =
          (180 + Math.random() * 620)
          * SHIP_DESTRUCTION_DEBRIS_BURST_SPEED_MULTIPLIER
          * SHIP_DESTRUCTION_DEBRIS_TRAVEL_DISTANCE_MULTIPLIER
          * SHIP_DESTRUCTION_SECOND_WAVE_SPEED_MULTIPLIER
        debrisPositions[stride] = (Math.random() * 2 - 1) * 8 * SHIP_DESTRUCTION_DEBRIS_BURST_RADIUS_MULTIPLIER
        debrisPositions[stride + 1] = (Math.random() * 2 - 1) * 8 * SHIP_DESTRUCTION_DEBRIS_BURST_RADIUS_MULTIPLIER
        debrisPositions[stride + 2] = (Math.random() * 2 - 1) * 8 * SHIP_DESTRUCTION_DEBRIS_BURST_RADIUS_MULTIPLIER
        debrisVelocities[stride] = dir.x * speed
        debrisVelocities[stride + 1] = dir.y * speed
        debrisVelocities[stride + 2] = dir.z * speed
        debrisColors[stride] = 1
        debrisColors[stride + 1] = 0.72 + Math.random() * 0.22
        debrisColors[stride + 2] = 0.36 + Math.random() * 0.2
        debrisSizes[i] = (24 + Math.random() * 28) * debrisSizeMultiplier
        const life =
          (0.55 + Math.random() * 0.6)
          * debrisLifeMultiplier
          * SHIP_DESTRUCTION_SECOND_WAVE_DISTANCE_MULTIPLIER
        debrisLife[i] = life
        debrisMaxLife[i] = life
        debrisAlphas[i] = 1
      }
      secondWaveActivatedRef.current = true
    }
    const debrisDrag = Math.exp(-0.85 * dt)

    for (let i = 0; i < DEBRIS_COUNT; i += 1) {
      const life = debrisLife[i] ?? 0
      if (life <= 0) {
        debrisSizes[i] = 0
        debrisAlphas[i] = 0
        continue
      }
      const nextLife = Math.max(0, life - dt)
      debrisLife[i] = nextLife
      const stride = i * 3
      const vx = (debrisVelocities[stride] ?? 0) * debrisDrag
      const vy = ((debrisVelocities[stride + 1] ?? 0) - 28 * dt) * debrisDrag
      const vz = (debrisVelocities[stride + 2] ?? 0) * debrisDrag
      debrisVelocities[stride] = vx
      debrisVelocities[stride + 1] = vy
      debrisVelocities[stride + 2] = vz
      debrisPositions[stride] = (debrisPositions[stride] ?? 0) + vx * dt
      debrisPositions[stride + 1] = (debrisPositions[stride + 1] ?? 0) + vy * dt
      debrisPositions[stride + 2] = (debrisPositions[stride + 2] ?? 0) + vz * dt
      const t = 1 - nextLife / Math.max(0.001, debrisMaxLife[i] ?? 1)
      debrisSizes[i] = (24 + (debrisSizes[i] ?? 24) * 0.2) * (1 - t)
      debrisAlphas[i] = Math.pow(Math.max(0, 1 - t), 2.1)

      const shouldSpawnSmoke = isShipDestruction
        ? Math.random() < Math.min(1, dt * SHIP_DESTRUCTION_TRAIL_EMISSION_RATE_PER_FRAGMENT)
        : Math.random() < 0.45
      if (nextLife > 0 && shouldSpawnSmoke) {
        if (smokeParticlesRef.current.length >= SMOKE_MAX_PARTICLES) {
          continue
        }
        const smokeBurstRadiusMultiplier = isShipDestruction
          ? SHIP_DESTRUCTION_SMOKE_BURST_RADIUS_MULTIPLIER
          : 1
        const smokeBurstSpeedMultiplier = isShipDestruction
          ? SHIP_DESTRUCTION_SMOKE_BURST_SPEED_MULTIPLIER
          : 1
        const smokeSpawnBias = isShipDestruction ? SHIP_DESTRUCTION_SMOKE_TRAIL_SPAWN_BIAS : 1
        const smokeOriginSphereScale = isShipDestruction ? SHIP_DESTRUCTION_SMOKE_ORIGIN_SPHERE_SCALE : 1
        const trailVelocityInherit = isShipDestruction ? SHIP_DESTRUCTION_TRAIL_VELOCITY_INHERIT : 0.12
        const lifetimeSeconds = Math.max(0.2, explosion.lifetimeSeconds ?? EXPLOSION_LIFETIME_SECONDS)
        const remainingExplosionLife = Math.max(0, lifetimeSeconds - explosion.flightTimeSeconds)
        const smokeLifeForFragment = isShipDestruction
          ? Math.max(
            remainingExplosionLife,
            (0.8 + Math.random() * 1.7) * smokeLifeMultiplier
          )
          : (0.8 + Math.random() * 1.7) * smokeLifeMultiplier
        const sx =
          (debrisPositions[stride] ?? 0)
          * smokeSpawnBias
          * smokeBurstRadiusMultiplier
          * smokeOriginSphereScale
        const sy =
          (debrisPositions[stride + 1] ?? 0)
          * smokeSpawnBias
          * smokeBurstRadiusMultiplier
          * smokeOriginSphereScale
        const sz =
          (debrisPositions[stride + 2] ?? 0)
          * smokeSpawnBias
          * smokeBurstRadiusMultiplier
          * smokeOriginSphereScale
        smokeParticlesRef.current.push({
          x: sx,
          y: sy,
          z: sz,
          vx: (vx * trailVelocityInherit + (Math.random() * 2 - 1) * 12) * smokeBurstSpeedMultiplier,
          vy: (vy * trailVelocityInherit + (Math.random() * 2 - 1) * 12) * smokeBurstSpeedMultiplier,
          vz: (vz * trailVelocityInherit + (Math.random() * 2 - 1) * 12) * smokeBurstSpeedMultiplier,
          staticTrail: isShipDestruction,
          ageSeconds: 0,
          lifeSeconds: smokeLifeForFragment,
          sizeStart: (26 + Math.random() * 18) * smokeSizeMultiplier,
          sizeEnd: (120 + Math.random() * 180)
            * smokeSizeMultiplier
            * (isShipDestruction ? SHIP_DESTRUCTION_SMOKE_MAX_SIZE_MULTIPLIER : 1),
          alphaStart: 0.42 + Math.random() * 0.3,
        })
      }
    }

    const debrisGeometry = debrisGeometryRef.current
    if (debrisGeometry) {
      const pos = debrisGeometry.getAttribute('position') as THREE.BufferAttribute | undefined
      const size = debrisGeometry.getAttribute('aSize') as THREE.BufferAttribute | undefined
      const alpha = debrisGeometry.getAttribute('aAlpha') as THREE.BufferAttribute | undefined
      if (pos) pos.needsUpdate = true
      if (size) size.needsUpdate = true
      if (alpha) alpha.needsUpdate = true
    }

    const smokeParticles = smokeParticlesRef.current
    const smokeDrag = isShipDestruction ? SHIP_DESTRUCTION_SMOKE_DRAG : SMOKE_DRAG
    const smokeDamping = Math.exp(-smokeDrag * dt)
    const survivors: SmokeParticle[] = []
    for (let i = 0; i < smokeParticles.length; i += 1) {
      const p = smokeParticles[i]
      if (!p) continue
      p.ageSeconds += dt
      if (p.ageSeconds >= p.lifeSeconds) continue
      if (!p.staticTrail) {
        p.vx *= smokeDamping
        p.vy = p.vy * smokeDamping + SMOKE_UPWARD_DRIFT * dt
        p.vz *= smokeDamping
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.z += p.vz * dt
      }
      survivors.push(p)
    }
    smokeParticlesRef.current = survivors

    const activeCount = Math.min(survivors.length, SMOKE_MAX_PARTICLES)
    for (let i = 0; i < activeCount; i += 1) {
      const p = survivors[i]
      if (!p) continue
      const t = clamp01(p.ageSeconds / p.lifeSeconds)
      const fadeExponent = isShipDestruction ? 0.9 : 1.45
      const fade = Math.pow(1 - t, fadeExponent)
      // Keep diffusion growth active across the full particle lifetime.
      const diffusionT = Math.pow(t, 1.25)
      const size = p.sizeStart + (p.sizeEnd - p.sizeStart) * diffusionT
      const stride = i * 3
      smokePositions[stride] = p.x
      smokePositions[stride + 1] = p.y
      smokePositions[stride + 2] = p.z
      const startGray = isShipDestruction ? 0.92 : 0.75
      const endGray = isShipDestruction ? 0.22 : 0.33
      const colorT = isShipDestruction ? Math.pow(t, 0.55) : diffusionT
      const gray = THREE.MathUtils.lerp(startGray, endGray, colorT)
      smokeColors[stride] = gray
      smokeColors[stride + 1] = gray * 0.98
      smokeColors[stride + 2] = gray * THREE.MathUtils.lerp(1, 0.82, colorT)
      smokeSizes[i] = size
      smokeAlphas[i] = p.alphaStart * fade
    }

    const smokeGeometry = smokeGeometryRef.current
    if (smokeGeometry) {
      smokeGeometry.setDrawRange(0, activeCount)
      const pos = smokeGeometry.getAttribute('position') as THREE.BufferAttribute | undefined
      const color = smokeGeometry.getAttribute('color') as THREE.BufferAttribute | undefined
      const size = smokeGeometry.getAttribute('aSize') as THREE.BufferAttribute | undefined
      const alpha = smokeGeometry.getAttribute('aAlpha') as THREE.BufferAttribute | undefined
      if (pos) pos.needsUpdate = true
      if (color) color.needsUpdate = true
      if (size) size.needsUpdate = true
      if (alpha) alpha.needsUpdate = true
    }
  })

  const sizeMultiplier = Math.max(0.2, explosion.sizeMultiplier ?? 1)
  const glowMultiplier = Math.max(0.2, explosion.glowMultiplier ?? 1)
  const lifetimeSeconds = Math.max(0.2, explosion.lifetimeSeconds ?? EXPLOSION_LIFETIME_SECONDS)
  const lensAndGlowScaleMultiplier = isShipDestruction ? 5 : 1
  const lensDurationMultiplier = isShipDestruction
    ? getLensPulseDurationMultiplier(
      SHIP_DESTRUCTION_LENS_SMALL_PHASE_SECONDS + SHIP_DESTRUCTION_LENS_EXPAND_PHASE_SECONDS
    )
    : 1
  const initialFlicker = isShipDestruction ? shipDestructionFlickerFactor(explosion.flightTimeSeconds) : 1
  const destructionExpandT = isShipDestruction
    ? smoothstep01(
      (explosion.flightTimeSeconds - SHIP_DESTRUCTION_LENS_SMALL_PHASE_SECONDS)
      / SHIP_DESTRUCTION_LENS_EXPAND_PHASE_SECONDS
    )
    : 1
  const lensScalePhaseMultiplier = isShipDestruction
    ? THREE.MathUtils.lerp(
      SHIP_DESTRUCTION_LENS_SMALL_SCALE_MULTIPLIER,
      SHIP_DESTRUCTION_LENS_FINAL_SCALE_MULTIPLIER,
      destructionExpandT
    )
    : 1
  const adjustedLensScaleMultiplier =
    lensAndGlowScaleMultiplier
    * lensScalePhaseMultiplier
    * (isShipDestruction ? SHIP_DESTRUCTION_LENS_EXTRA_SIZE_REDUCTION : 1)
    * (isShipDestruction ? SHIP_DESTRUCTION_OVERALL_SIZE_MULTIPLIER : 1)
  const coolToWarmBlend = isShipDestruction ? destructionExpandT : 1
  const emissiveColor = isShipDestruction
    ? lerpHexColor(0x9fd8ff, 0xffa04a, coolToWarmBlend)
    : 0xffa04a
  const flareCoreColor = isShipDestruction
    ? lerpHexColor(0xe6f6ff, 0xffe4b8, coolToWarmBlend)
    : 0xffe4b8
  const flareHaloColor = isShipDestruction
    ? lerpHexColor(0x9fd8ff, 0xffb067, coolToWarmBlend)
    : 0xffb067
  const flareMainColor = isShipDestruction
    ? lerpHexColor(0xc8eaff, 0xffca8a, coolToWarmBlend)
    : 0xffca8a
  const flareRingColor = isShipDestruction
    ? lerpHexColor(0xe6f6ff, 0xffe7cb, coolToWarmBlend)
    : 0xffe7cb
  const flareHotCoreColor = isShipDestruction
    ? lerpHexColor(0xf4fbff, 0xffffff, coolToWarmBlend)
    : 0xffffff
  const flareOuterRingColor = isShipDestruction
    ? lerpHexColor(0xaadfff, 0xffb478, coolToWarmBlend)
    : 0xffb478
  const horizonStreakColor = isShipDestruction
    ? lerpHexColor(0xc9ebff, 0xffc28f, coolToWarmBlend)
    : flareMainColor
  const horizonOuterStreakColor = isShipDestruction
    ? lerpHexColor(0xa4deff, 0xffa96d, coolToWarmBlend)
    : flareHaloColor
  const debrisPhaseActive = explosion.flightTimeSeconds >= debrisPhaseDelaySeconds
  const lifeT = clamp01(explosion.flightTimeSeconds / lifetimeSeconds)
  const flashT = clamp01(explosion.flightTimeSeconds / EXPLOSION_FLASH_PEAK_SECONDS)
  const flashFade = Math.pow(1 - flashT, 2.8)
  const longFade = Math.pow(1 - lifeT, 1.35)
  const lensPulse = fastLensPulse(explosion.flightTimeSeconds, lensDurationMultiplier) * initialFlicker
  const coreScale =
    (240 + EXPLOSION_CORE_MAX_SCALE * Math.pow(Math.min(1, explosion.flightTimeSeconds / 0.22), 0.82))
    * sizeMultiplier
    * adjustedLensScaleMultiplier
  const lensScale =
    EXPLOSION_LENS_MAX_SCALE
    * Math.max(0, 1 - explosion.flightTimeSeconds * (isShipDestruction ? 0.18 : 3.8))
    * sizeMultiplier
    * adjustedLensScaleMultiplier
  const haloScale = coreScale * 1.8
  const horizonStreakPulse = isShipDestruction
    ? lensPulse * Math.pow(Math.max(0, 1 - lifeT), 0.5)
    : 0
  const horizonStreakScaleX = lensScale * SHIP_DESTRUCTION_HORIZON_STREAK_WIDTH_MULTIPLIER
  const horizonStreakScaleY = coreScale * SHIP_DESTRUCTION_HORIZON_STREAK_HEIGHT_MULTIPLIER
  const horizonOuterStreakScaleX = lensScale * SHIP_DESTRUCTION_HORIZON_STREAK_OUTER_WIDTH_MULTIPLIER
  const horizonOuterStreakScaleY = coreScale * SHIP_DESTRUCTION_HORIZON_STREAK_OUTER_HEIGHT_MULTIPLIER

  return (
    <>
      <group position={explosion.position} renderOrder={20}>
        <mesh>
          <sphereGeometry args={[36, 14, 14]} />
          <meshStandardMaterial
            color={0xfff0cf}
            emissive={emissiveColor}
            emissiveIntensity={
              (6.5 * flashFade + 0.75 * longFade)
              * glowMultiplier
              * adjustedLensScaleMultiplier
              * initialFlicker
            }
            roughness={0.5}
            metalness={0}
            transparent
            opacity={0.72 * flashFade}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
        <sprite scale={[coreScale, coreScale, 1]}>
          <spriteMaterial
            map={lensFlareTexture}
            color={flareCoreColor}
            transparent
            opacity={1.45 * lensPulse * glowMultiplier}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <sprite scale={[haloScale, haloScale, 1]}>
          <spriteMaterial
            map={lensFlareTexture}
            color={flareHaloColor}
            transparent
            opacity={0.78 * lensPulse * glowMultiplier}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <sprite scale={[lensScale, lensScale, 1]}>
          <spriteMaterial
            map={lensFlareTexture}
            color={flareMainColor}
            transparent
            opacity={0.88 * lensPulse * glowMultiplier}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <sprite scale={[lensScale * 0.72, lensScale * 0.72, 1]}>
          <spriteMaterial
            map={lensRingTexture}
            color={flareRingColor}
            transparent
            opacity={1.05 * lensPulse * glowMultiplier}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <sprite scale={[lensScale * 0.38, lensScale * 0.38, 1]}>
          <spriteMaterial
            map={lensFlareTexture}
            color={flareHotCoreColor}
            transparent
            opacity={1.35 * lensPulse * glowMultiplier}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <sprite scale={[lensScale * 1.12, lensScale * 1.12, 1]}>
          <spriteMaterial
            map={lensRingTexture}
            color={flareOuterRingColor}
            transparent
            opacity={0.52 * lensPulse * glowMultiplier}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        {isShipDestruction && (
          <>
            <sprite scale={[horizonStreakScaleX, horizonStreakScaleY, 1]}>
              <spriteMaterial
                map={lensFlareTexture}
                color={horizonStreakColor}
                transparent
                opacity={0.85 * horizonStreakPulse * glowMultiplier}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </sprite>
            <sprite scale={[horizonOuterStreakScaleX, horizonOuterStreakScaleY, 1]}>
              <spriteMaterial
                map={lensFlareTexture}
                color={horizonOuterStreakColor}
                transparent
                opacity={0.45 * horizonStreakPulse * glowMultiplier}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                toneMapped={false}
              />
            </sprite>
          </>
        )}

        {debrisPhaseActive && (
        <points frustumCulled={false}>
          <bufferGeometry ref={debrisGeometryRef}>
            <bufferAttribute attach="attributes-position" args={[debrisPositions, 3]} />
            <bufferAttribute attach="attributes-color" args={[debrisColors, 3]} />
            <bufferAttribute attach="attributes-aSize" args={[debrisSizes, 1]} />
            <bufferAttribute attach="attributes-aAlpha" args={[debrisAlphas, 1]} />
          </bufferGeometry>
          <shaderMaterial
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
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
                gl_PointSize = aSize * (350.0 / max(1.0, -mvPosition.z));
                gl_Position = projectionMatrix * mvPosition;
              }
            `}
            fragmentShader={`
              varying vec3 vColor;
              varying float vAlpha;
              void main() {
                vec2 uv = gl_PointCoord - vec2(0.5);
                float d = length(uv);
                float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
                if (alpha < 0.01) discard;
                gl_FragColor = vec4(vColor, alpha);
              }
            `}
          />
        </points>
        )}
      </group>

      {debrisPhaseActive && (
      <group position={explosion.position}>
        <points frustumCulled={false} renderOrder={19}>
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
                vec4 s = texture2D(uMap, gl_PointCoord);
                float alpha = s.a * vAlpha;
                if (alpha < 0.01) discard;
                gl_FragColor = vec4(vColor, alpha);
              }
            `}
          />
        </points>
      </group>
      )}
    </>
  )
}

export function TorpedoExplosions() {
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const torpedoExplosions = useGameStore((s) => s.torpedoExplosions)
  const remoteTorpedoExplosions = useGameStore((s) => s.remoteTorpedoExplosions)
  const advanceTorpedoExplosions = useGameStore((s) => s.advanceTorpedoExplosions)

  useFrame((_state, deltaSeconds) => {
    advanceTorpedoExplosions(deltaSeconds)
  })

  const visibleExplosions = useMemo(
    () => [...torpedoExplosions, ...remoteTorpedoExplosions]
      .filter((explosion) => explosion.currentCelestialId === currentCelestialId),
    [currentCelestialId, torpedoExplosions, remoteTorpedoExplosions]
  )

  if (visibleExplosions.length === 0) return null

  return (
    <>
      {visibleExplosions.map((explosion) => (
        <ExplosionInstance key={explosion.id} explosion={explosion} />
      ))}
    </>
  )
}

