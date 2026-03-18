import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import type { TorpedoExplosion } from '@/state/types'

const DEBRIS_COUNT = 96
const SMOKE_MAX_PARTICLES = 2200
const SMOKE_DRAG = 0.95
const SMOKE_UPWARD_DRIFT = 10
const EXPLOSION_FLASH_PEAK_SECONDS = 0.16
const EXPLOSION_LENS_MAX_SCALE = 5200 // doubled size
const EXPLOSION_CORE_MAX_SCALE = 1640 // doubled size
const EXPLOSION_LIFETIME_SECONDS = 7.2
const LENS_FADE_IN_SECONDS = 0.035
const LENS_PEAK_HOLD_SECONDS = 0.06
const LENS_FADE_OUT_SECONDS = 0.44

type SmokeParticle = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  ageSeconds: number
  lifeSeconds: number
  sizeStart: number
  sizeEnd: number
  alphaStart: number
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function fastLensPulse(ageSeconds: number) {
  const inT = clamp01(ageSeconds / LENS_FADE_IN_SECONDS)
  const outStart = LENS_FADE_IN_SECONDS + LENS_PEAK_HOLD_SECONDS
  const outT = clamp01((ageSeconds - outStart) / LENS_FADE_OUT_SECONDS)
  return Math.pow(inT, 0.45) * Math.pow(1 - outT, 1.55)
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

  useEffect(() => {
    // Seed debris with an isotropic burst.
    for (let i = 0; i < DEBRIS_COUNT; i += 1) {
      const stride = i * 3
      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1
      ).normalize()
      const speed = 180 + Math.random() * 620
      debrisPositions[stride] = (Math.random() * 2 - 1) * 8
      debrisPositions[stride + 1] = (Math.random() * 2 - 1) * 8
      debrisPositions[stride + 2] = (Math.random() * 2 - 1) * 8
      debrisVelocities[stride] = dir.x * speed
      debrisVelocities[stride + 1] = dir.y * speed
      debrisVelocities[stride + 2] = dir.z * speed
      debrisColors[stride] = 1
      debrisColors[stride + 1] = 0.72 + Math.random() * 0.22
      debrisColors[stride + 2] = 0.36 + Math.random() * 0.2
      debrisSizes[i] = 24 + Math.random() * 28
      const life = 0.55 + Math.random() * 0.6
      debrisLife[i] = life
      debrisMaxLife[i] = life
      debrisAlphas[i] = 1
    }
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
    lensFlareTexture,
    lensRingTexture,
    smokeTexture,
  ])

  useFrame((_state, deltaSeconds) => {
    const dt = Math.min(deltaSeconds, 0.05)
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

      if (nextLife > 0 && Math.random() < 0.45) {
        if (smokeParticlesRef.current.length >= SMOKE_MAX_PARTICLES) {
          smokeParticlesRef.current.shift()
        }
        smokeParticlesRef.current.push({
          x: debrisPositions[stride] ?? 0,
          y: debrisPositions[stride + 1] ?? 0,
          z: debrisPositions[stride + 2] ?? 0,
          vx: vx * 0.12 + (Math.random() * 2 - 1) * 12,
          vy: vy * 0.12 + (Math.random() * 2 - 1) * 12,
          vz: vz * 0.12 + (Math.random() * 2 - 1) * 12,
          ageSeconds: 0,
          lifeSeconds: 0.8 + Math.random() * 1.7,
          sizeStart: 26 + Math.random() * 18,
          sizeEnd: 120 + Math.random() * 180,
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
    const smokeDamping = Math.exp(-SMOKE_DRAG * dt)
    const survivors: SmokeParticle[] = []
    for (let i = 0; i < smokeParticles.length; i += 1) {
      const p = smokeParticles[i]
      if (!p) continue
      p.ageSeconds += dt
      if (p.ageSeconds >= p.lifeSeconds) continue
      p.vx *= smokeDamping
      p.vy = p.vy * smokeDamping + SMOKE_UPWARD_DRIFT * dt
      p.vz *= smokeDamping
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      survivors.push(p)
    }
    smokeParticlesRef.current = survivors

    const activeCount = Math.min(survivors.length, SMOKE_MAX_PARTICLES)
    for (let i = 0; i < activeCount; i += 1) {
      const p = survivors[i]
      if (!p) continue
      const t = clamp01(p.ageSeconds / p.lifeSeconds)
      const fade = Math.pow(1 - t, 1.45)
      const size = p.sizeStart + (p.sizeEnd - p.sizeStart) * t
      const stride = i * 3
      smokePositions[stride] = p.x
      smokePositions[stride + 1] = p.y
      smokePositions[stride + 2] = p.z
      const gray = 0.75 - 0.42 * t
      smokeColors[stride] = gray
      smokeColors[stride + 1] = gray
      smokeColors[stride + 2] = gray * 0.95
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

  const lifeT = clamp01(explosion.flightTimeSeconds / EXPLOSION_LIFETIME_SECONDS)
  const flashT = clamp01(explosion.flightTimeSeconds / EXPLOSION_FLASH_PEAK_SECONDS)
  const flashFade = Math.pow(1 - flashT, 2.8)
  const longFade = Math.pow(1 - lifeT, 1.35)
  const lensPulse = fastLensPulse(explosion.flightTimeSeconds)
  const coreScale = 240 + EXPLOSION_CORE_MAX_SCALE * Math.pow(Math.min(1, explosion.flightTimeSeconds / 0.22), 0.82)
  const lensScale = EXPLOSION_LENS_MAX_SCALE * Math.max(0, 1 - explosion.flightTimeSeconds * 3.8)
  const haloScale = coreScale * 1.8

  return (
    <>
      <group position={explosion.position} renderOrder={20}>
        <mesh>
          <sphereGeometry args={[36, 14, 14]} />
          <meshStandardMaterial
            color={0xfff0cf}
            emissive={0xffa04a}
            emissiveIntensity={6.5 * flashFade + 0.75 * longFade}
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
            color={0xffe4b8}
            transparent
            opacity={1.45 * lensPulse}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <sprite scale={[haloScale, haloScale, 1]}>
          <spriteMaterial
            map={lensFlareTexture}
            color={0xffb067}
            transparent
            opacity={0.78 * lensPulse}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <sprite scale={[lensScale, lensScale, 1]}>
          <spriteMaterial
            map={lensFlareTexture}
            color={0xffca8a}
            transparent
            opacity={0.88 * lensPulse}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <sprite scale={[lensScale * 0.72, lensScale * 0.72, 1]}>
          <spriteMaterial
            map={lensRingTexture}
            color={0xffe7cb}
            transparent
            opacity={1.05 * lensPulse}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <sprite scale={[lensScale * 0.38, lensScale * 0.38, 1]}>
          <spriteMaterial
            map={lensFlareTexture}
            color={0xffffff}
            transparent
            opacity={1.35 * lensPulse}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>
        <sprite scale={[lensScale * 1.12, lensScale * 1.12, 1]}>
          <spriteMaterial
            map={lensRingTexture}
            color={0xffb478}
            transparent
            opacity={0.52 * lensPulse}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </sprite>

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
      </group>

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

