import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import type { DewBeam, ShipState } from '@/state/types'
import {
  DEW_BEAM_VISUAL_LIFETIME_MS,
  DEW_SMOKE_TRAIL_MS,
} from '@/constants/dewBeam'

const FADE_IN_MS = 120
const FADE_OUT_MS = 240
const HOLD_MS = 600
const BEAM_LIFETIME_MS = DEW_BEAM_VISUAL_LIFETIME_MS

const CORE_RADIUS = 4
const INNER_GLOW_RADIUS = 20
const OUTER_GLOW_RADIUS = 70
const SEGMENTS = 3

const MAX_DEW_SMOKE_PARTICLES = 1400
const DEW_SMOKE_SPAWN_PER_SECOND = 720
const DEW_SMOKE_VELOCITY_DAMPING = 0.85
const DEW_SMOKE_TURBULENCE = 22

function beamIntensity(elapsedMs: number): number {
  if (elapsedMs < FADE_IN_MS) {
    const t = elapsedMs / FADE_IN_MS
    return t * t
  }
  if (elapsedMs < FADE_IN_MS + HOLD_MS) {
    return 1
  }
  const fadeElapsed = elapsedMs - FADE_IN_MS - HOLD_MS
  const t = 1 - fadeElapsed / FADE_OUT_MS
  return Math.max(0, t * t)
}

function flicker(elapsedMs: number): number {
  const f1 = Math.sin(elapsedMs * 0.47) * 0.12
  const f2 = Math.sin(elapsedMs * 1.13) * 0.08
  const f3 = Math.sin(elapsedMs * 2.71) * 0.06
  const spike = Math.random() < 0.08 ? (Math.random() * 0.25 - 0.12) : 0
  return 1 + f1 + f2 + f3 + spike
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

let dewSmokeTextureSingleton: THREE.CanvasTexture | null = null
function getDewSmokeTexture() {
  if (dewSmokeTextureSingleton) return dewSmokeTextureSingleton
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    dewSmokeTextureSingleton = new THREE.CanvasTexture(canvas)
    return dewSmokeTextureSingleton
  }
  const center = 32
  const gradient = ctx.createRadialGradient(center, center, 1, center, center, center)
  gradient.addColorStop(0, 'rgba(240,240,245,0.92)')
  gradient.addColorStop(0.45, 'rgba(200,200,210,0.45)')
  gradient.addColorStop(1, 'rgba(180,180,190,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  dewSmokeTextureSingleton = new THREE.CanvasTexture(canvas)
  dewSmokeTextureSingleton.needsUpdate = true
  return dewSmokeTextureSingleton
}

type DewSmokeParticle = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  birthMs: number
  lifeSeconds: number
  startSize: number
  endSize: number
  startAlpha: number
  colorR: number
  colorG: number
  colorB: number
}

const _dewStart = new THREE.Vector3()
const _dewEnd = new THREE.Vector3()
const _dewDir = new THREE.Vector3()
const _dewMid = new THREE.Vector3()
const _dewUp = new THREE.Vector3(0, 1, 0)
const _dewRight = new THREE.Vector3()
const _dewPerp = new THREE.Vector3()

function resolveDewEndpoint(
  shipId: string | undefined,
  fallback: [number, number, number],
  celestialId: string,
  shipsById: Record<string, ShipState>,
  out: THREE.Vector3,
): void {
  if (!shipId) {
    out.set(...fallback)
    return
  }
  const ship = shipsById[shipId]
  if (!ship || ship.currentCelestialId !== celestialId) {
    out.set(...fallback)
    return
  }
  out.set(...ship.position)
}

function DewBeamInstance({ beam }: { beam: DewBeam }) {
  const groupRef = useRef<THREE.Group>(null)
  const coreRef = useRef<THREE.Mesh>(null)
  const innerGlowRef = useRef<THREE.Mesh>(null)
  const outerGlowRef = useRef<THREE.Mesh>(null)
  const originSpriteRef = useRef<THREE.Sprite>(null)
  const hitSpriteRef = useRef<THREE.Sprite>(null)

  const coreMat = useRef<THREE.MeshBasicMaterial>(null)
  const innerMat = useRef<THREE.MeshBasicMaterial>(null)
  const outerMat = useRef<THREE.MeshBasicMaterial>(null)
  const originSpriteMat = useRef<THREE.SpriteMaterial>(null)
  const hitSpriteMat = useRef<THREE.SpriteMaterial>(null)

  const smokeGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  const smokeParticlesRef = useRef<DewSmokeParticle[]>([])
  const smokeSpawnAccRef = useRef(0)

  const smokePositions = useMemo(() => new Float32Array(MAX_DEW_SMOKE_PARTICLES * 3), [])
  const smokeColors = useMemo(() => new Float32Array(MAX_DEW_SMOKE_PARTICLES * 3), [])
  const smokeSizes = useMemo(() => new Float32Array(MAX_DEW_SMOKE_PARTICLES), [])
  const smokeAlphas = useMemo(() => new Float32Array(MAX_DEW_SMOKE_PARTICLES), [])
  const smokeUniforms = useMemo(
    () => ({
      uMap: { value: getDewSmokeTexture() },
    }),
    [],
  )

  const glowTexture = useMemo(() => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const center = size / 2
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.15, 'rgba(255,255,255,0.8)')
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.3)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    return tex
  }, [])

  useEffect(() => {
    const geo = smokeGeometryRef.current
    if (!geo) return
    for (const name of ['position', 'color', 'aSize', 'aAlpha'] as const) {
      const attr = geo.getAttribute(name)
      if (attr instanceof THREE.BufferAttribute) {
        attr.setUsage(THREE.DynamicDrawUsage)
      }
    }
  }, [])

  useFrame((_state, deltaSeconds) => {
    const now = performance.now()
    const elapsed = now - beam.firedAtMs
    const trailEndMs = beam.firedAtMs + BEAM_LIFETIME_MS + DEW_SMOKE_TRAIL_MS
    if (elapsed > BEAM_LIFETIME_MS + DEW_SMOKE_TRAIL_MS) return

    const dt = Math.min(deltaSeconds, 0.05)
    const beamActive = elapsed <= BEAM_LIFETIME_MS
    const shipsById = useGameStore.getState().shipsById

    if (beamActive) {
      resolveDewEndpoint(beam.originShipId, beam.originPosition, beam.currentCelestialId, shipsById, _dewStart)
      resolveDewEndpoint(beam.targetShipId, beam.targetPosition, beam.currentCelestialId, shipsById, _dewEnd)
      _dewDir.subVectors(_dewEnd, _dewStart)
      const len = _dewDir.length()

      if (groupRef.current) {
        groupRef.current.visible = true
        if (len > 1e-4) {
          _dewDir.multiplyScalar(1 / len)
          _dewMid.addVectors(_dewStart, _dewEnd).multiplyScalar(0.5)
          groupRef.current.position.copy(_dewMid)
          groupRef.current.quaternion.setFromUnitVectors(_dewUp, _dewDir)
        } else {
          groupRef.current.position.copy(_dewStart)
          groupRef.current.quaternion.identity()
        }
      }
      if (originSpriteRef.current) {
        originSpriteRef.current.visible = true
        originSpriteRef.current.position.copy(_dewStart)
      }
      if (hitSpriteRef.current) {
        hitSpriteRef.current.visible = true
        hitSpriteRef.current.position.copy(_dewEnd)
      }

      const baseIntensity = beamIntensity(elapsed)
      const fl = flicker(elapsed)
      const intensity = Math.max(0, Math.min(1.3, baseIntensity * fl))

      const radiusJitter = 1 + (Math.sin(elapsed * 1.9) * 0.15 + (Math.random() - 0.5) * 0.1) * baseIntensity
      const beamLen = Math.max(len, 1e-4)

      if (coreRef.current) {
        coreRef.current.scale.set(radiusJitter, beamLen, radiusJitter)
      }
      if (innerGlowRef.current) {
        const innerJitter = 1 + (Math.sin(elapsed * 0.83) * 0.12 + (Math.random() - 0.5) * 0.08) * baseIntensity
        innerGlowRef.current.scale.set(innerJitter, beamLen, innerJitter)
      }
      if (outerGlowRef.current) {
        const outerJitter = 1 + (Math.sin(elapsed * 0.37) * 0.18 + (Math.random() - 0.5) * 0.06) * baseIntensity
        outerGlowRef.current.scale.set(outerJitter, beamLen, outerJitter)
      }

      if (coreMat.current) {
        coreMat.current.opacity = intensity
        const colorFlicker = 0.85 + Math.random() * 0.15
        coreMat.current.color.setRGB(
          1.0 * colorFlicker,
          (0.25 + 0.6 * intensity) * colorFlicker,
          (0.15 + 0.1 * intensity) * colorFlicker,
        )
      }
      if (innerMat.current) {
        innerMat.current.opacity = intensity * 0.5
      }
      if (outerMat.current) {
        outerMat.current.opacity = intensity * 0.15
      }

      const spriteFlicker = 0.7 + Math.random() * 0.3
      const spriteScale = (150 + 250 * intensity) * spriteFlicker
      if (originSpriteRef.current && originSpriteMat.current) {
        originSpriteRef.current.scale.set(spriteScale, spriteScale, 1)
        originSpriteMat.current.opacity = intensity * 0.7
      }
      if (hitSpriteRef.current && hitSpriteMat.current) {
        const hitFlicker = 0.6 + Math.random() * 0.4
        const hitScale = spriteScale * 1.4 * hitFlicker
        hitSpriteRef.current.scale.set(hitScale, hitScale, 1)
        hitSpriteMat.current.opacity = intensity * 0.85
      }

      // ── spawn smoke along current beam segment (world space) ──
      const lifeSecondsLeft = (trailEndMs - now) / 1000
      if (lifeSecondsLeft > 0.04 && len > 1e-3) {
        const tangent = _dewDir
        if (Math.abs(tangent.y) > 0.92) {
          _dewRight.set(1, 0, 0)
        } else {
          _dewRight.set(0, 1, 0)
        }
        _dewPerp.crossVectors(_dewRight, tangent)
        if (_dewPerp.lengthSq() < 1e-10) {
          _dewPerp.set(0, 0, 1).cross(tangent)
        }
        _dewPerp.normalize()
        _dewRight.crossVectors(tangent, _dewPerp).normalize()

        smokeSpawnAccRef.current += DEW_SMOKE_SPAWN_PER_SECOND * dt
        let spawnBudget = Math.min(48, Math.floor(smokeSpawnAccRef.current))
        smokeSpawnAccRef.current -= spawnBudget
        const particles = smokeParticlesRef.current
        while (spawnBudget > 0 && particles.length < MAX_DEW_SMOKE_PARTICLES) {
          spawnBudget -= 1
          const t = Math.random()
          const ax = _dewStart.x + (_dewEnd.x - _dewStart.x) * t
          const ay = _dewStart.y + (_dewEnd.y - _dewStart.y) * t
          const az = _dewStart.z + (_dewEnd.z - _dewStart.z) * t
          const radial = (Math.random() * 2 - 1) * 14 + (Math.random() * 2 - 1) * 10
          const binormal = (Math.random() * 2 - 1) * 14 + (Math.random() * 2 - 1) * 10
          const px = ax + _dewPerp.x * radial + _dewRight.x * binormal + randomSigned(6)
          const py = ay + _dewPerp.y * radial + _dewRight.y * binormal + randomSigned(6)
          const pz = az + _dewPerp.z * radial + _dewRight.z * binormal + randomSigned(6)

          const particleLife = (trailEndMs - now) / 1000
          const startSize = 18 + Math.random() * 28
          const growth = 3.2 + Math.random() * 2.8
          const gray = 0.62 + Math.random() * 0.2

          particles.push({
            x: px,
            y: py,
            z: pz,
            vx: _dewPerp.x * randomSigned(1) * 8 + _dewRight.x * randomSigned(1) * 8 + randomSigned(DEW_SMOKE_TURBULENCE * 0.06),
            vy: _dewPerp.y * randomSigned(1) * 8 + _dewRight.y * randomSigned(1) * 8 + randomSigned(DEW_SMOKE_TURBULENCE * 0.06),
            vz: _dewPerp.z * randomSigned(1) * 8 + _dewRight.z * randomSigned(1) * 8 + randomSigned(DEW_SMOKE_TURBULENCE * 0.06),
            birthMs: now,
            lifeSeconds: Math.max(0.05, particleLife),
            startSize,
            endSize: startSize * growth,
            startAlpha: 0.38 + Math.random() * 0.35,
            colorR: gray * 0.95,
            colorG: gray,
            colorB: gray * 1.02,
          })
        }
      }
    } else {
      smokeSpawnAccRef.current = 0
      if (groupRef.current) groupRef.current.visible = false
      if (originSpriteRef.current) originSpriteRef.current.visible = false
      if (hitSpriteRef.current) hitSpriteRef.current.visible = false
    }

    // ── integrate smoke (world space, persists after beam) ──
    const damp = Math.pow(DEW_SMOKE_VELOCITY_DAMPING, dt * 60)
    const particles = smokeParticlesRef.current
    const nextParticles: DewSmokeParticle[] = []
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i]
      if (!p) continue
      const ageSec = (now - p.birthMs) / 1000
      if (ageSec >= p.lifeSeconds) continue

      p.vx += randomSigned(DEW_SMOKE_TURBULENCE) * dt
      p.vy += randomSigned(DEW_SMOKE_TURBULENCE) * dt
      p.vz += randomSigned(DEW_SMOKE_TURBULENCE) * dt
      p.vx *= damp
      p.vy *= damp
      p.vz *= damp
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      nextParticles.push(p)
    }
    smokeParticlesRef.current = nextParticles

    const activeCount = Math.min(nextParticles.length, MAX_DEW_SMOKE_PARTICLES)
    for (let i = 0; i < activeCount; i += 1) {
      const p = nextParticles[i]
      if (!p) continue
      const ageSec = (now - p.birthMs) / 1000
      const t = clamp01(ageSec / p.lifeSeconds)
      const fade = Math.pow(1 - t, 1.5)
      const size = lerp(p.startSize, p.endSize, t)
      const stride = i * 3
      smokePositions[stride] = p.x
      smokePositions[stride + 1] = p.y
      smokePositions[stride + 2] = p.z
      smokeColors[stride] = p.colorR
      smokeColors[stride + 1] = p.colorG
      smokeColors[stride + 2] = p.colorB
      smokeSizes[i] = size
      smokeAlphas[i] = p.startAlpha * fade
    }

    const geometry = smokeGeometryRef.current
    if (geometry) {
      geometry.setDrawRange(0, activeCount)
      const positionAttr = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
      const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
      const sizeAttr = geometry.getAttribute('aSize') as THREE.BufferAttribute | undefined
      const alphaAttr = geometry.getAttribute('aAlpha') as THREE.BufferAttribute | undefined
      if (positionAttr) positionAttr.needsUpdate = true
      if (colorAttr) colorAttr.needsUpdate = true
      if (sizeAttr) sizeAttr.needsUpdate = true
      if (alphaAttr) alphaAttr.needsUpdate = true
    }
  })

  return (
    <>
      {/* beam cylinders — unit height, scaled on Y each frame to live length */}
      <group ref={groupRef}>
        {/* bright core */}
        <mesh ref={coreRef}>
          <cylinderGeometry args={[CORE_RADIUS, CORE_RADIUS, 1, SEGMENTS, 1, true]} />
          <meshBasicMaterial
            ref={coreMat}
            color={0xff5522}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>

        {/* inner glow */}
        <mesh ref={innerGlowRef}>
          <cylinderGeometry args={[INNER_GLOW_RADIUS, INNER_GLOW_RADIUS, 1, SEGMENTS, 1, true]} />
          <meshBasicMaterial
            ref={innerMat}
            color={0xff3300}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>

        {/* outer glow halo */}
        <mesh ref={outerGlowRef}>
          <cylinderGeometry args={[OUTER_GLOW_RADIUS, OUTER_GLOW_RADIUS, 1, SEGMENTS, 1, true]} />
          <meshBasicMaterial
            ref={outerMat}
            color={0xff2200}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* origin flash sprite — world position updated in useFrame */}
      <sprite ref={originSpriteRef}>
        <spriteMaterial
          ref={originSpriteMat}
          map={glowTexture}
          color={0xff6633}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>

      {/* hit flash sprite */}
      <sprite ref={hitSpriteRef}>
        <spriteMaterial
          ref={hitSpriteMat}
          map={glowTexture}
          color={0xff4411}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </sprite>

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
          toneMapped={false}
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

export function DewBeamEffects() {
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const dewBeams = useGameStore((s) => s.dewBeams)
  const advanceDewBeams = useGameStore((s) => s.advanceDewBeams)

  useFrame(() => {
    advanceDewBeams()
  })

  const visibleBeams = useMemo(
    () => dewBeams.filter((b) => b.currentCelestialId === currentCelestialId),
    [currentCelestialId, dewBeams],
  )

  if (visibleBeams.length === 0) return null

  return (
    <>
      {visibleBeams.map((beam) => (
        <DewBeamInstance key={beam.id} beam={beam} />
      ))}
    </>
  )
}
