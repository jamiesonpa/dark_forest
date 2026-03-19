import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import type { DewBeam } from '@/state/types'

const FADE_IN_MS = 120
const FADE_OUT_MS = 240
const HOLD_MS = 600
const BEAM_LIFETIME_MS = FADE_IN_MS + HOLD_MS + FADE_OUT_MS

const CORE_RADIUS = 4
const INNER_GLOW_RADIUS = 20
const OUTER_GLOW_RADIUS = 70
const SEGMENTS = 3

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

function DewBeamInstance({ beam }: { beam: DewBeam }) {
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

  const { position, quaternion, length } = useMemo(() => {
    const start = new THREE.Vector3(...beam.originPosition)
    const end = new THREE.Vector3(...beam.targetPosition)
    const dir = new THREE.Vector3().subVectors(end, start)
    const len = dir.length()
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5)
    const quat = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const normalized = dir.clone().normalize()
    quat.setFromUnitVectors(up, normalized)
    return { position: mid, quaternion: quat, length: len }
  }, [beam.originPosition, beam.targetPosition])

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

  useFrame(() => {
    const elapsed = performance.now() - beam.firedAtMs
    if (elapsed > BEAM_LIFETIME_MS) return

    const baseIntensity = beamIntensity(elapsed)
    const fl = flicker(elapsed)
    const intensity = Math.max(0, Math.min(1.3, baseIntensity * fl))

    const radiusJitter = 1 + (Math.sin(elapsed * 1.9) * 0.15 + (Math.random() - 0.5) * 0.1) * baseIntensity

    if (coreRef.current) {
      coreRef.current.scale.set(radiusJitter, 1, radiusJitter)
    }
    if (innerGlowRef.current) {
      const innerJitter = 1 + (Math.sin(elapsed * 0.83) * 0.12 + (Math.random() - 0.5) * 0.08) * baseIntensity
      innerGlowRef.current.scale.set(innerJitter, 1, innerJitter)
    }
    if (outerGlowRef.current) {
      const outerJitter = 1 + (Math.sin(elapsed * 0.37) * 0.18 + (Math.random() - 0.5) * 0.06) * baseIntensity
      outerGlowRef.current.scale.set(outerJitter, 1, outerJitter)
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
  })

  return (
    <>
      {/* beam cylinders */}
      <group position={position} quaternion={quaternion}>
        {/* bright core */}
        <mesh ref={coreRef}>
          <cylinderGeometry args={[CORE_RADIUS, CORE_RADIUS, length, SEGMENTS, 1, true]} />
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
          <cylinderGeometry args={[INNER_GLOW_RADIUS, INNER_GLOW_RADIUS, length, SEGMENTS, 1, true]} />
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
          <cylinderGeometry args={[OUTER_GLOW_RADIUS, OUTER_GLOW_RADIUS, length, SEGMENTS, 1, true]} />
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

      {/* origin flash sprite */}
      <sprite ref={originSpriteRef} position={beam.originPosition}>
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
      <sprite ref={hitSpriteRef} position={beam.targetPosition}>
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
