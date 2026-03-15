import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ShipState } from '@/state/types'
import { useGameStore } from '@/state/gameStore'

const PARTICLE_COUNT = 900
const APEX_Z = 2600
const BUBBLE_LENGTH = 11500
const MAX_RADIUS = 2700
const Y_SCALE = 0.82
const BASE_FLOW = 1.5
const SPEED_FLOW_MULT = 0.00035
const MAX_SPEED_RATIO = 5
const MAX_SIZE_MULTIPLIER = 40
const SPEED_SMOOTH_ACCEL = 2.5
const SPEED_SMOOTH_DECEL = 5.5
const TAIL_FADE_START_U = 0.62
const TAIL_FADE_END_U = 0.9
const TAIL_CUTOFF_U = 0.92
const MIN_VISIBLE_FRACTION = 0.3

type ParticleState = {
  u: Float32Array
  theta: Float32Array
  spin: Float32Array
  size: Float32Array
  alpha: Float32Array
  tintR: Float32Array
  tintG: Float32Array
  tintB: Float32Array
}

function createParticleState() {
  const u = new Float32Array(PARTICLE_COUNT)
  const theta = new Float32Array(PARTICLE_COUNT)
  const spin = new Float32Array(PARTICLE_COUNT)
  const size = new Float32Array(PARTICLE_COUNT)
  const alpha = new Float32Array(PARTICLE_COUNT)
  const tintR = new Float32Array(PARTICLE_COUNT)
  const tintG = new Float32Array(PARTICLE_COUNT)
  const tintB = new Float32Array(PARTICLE_COUNT)

  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    u[i] = Math.random()
    theta[i] = Math.random() * Math.PI * 2
    spin[i] = (Math.random() - 0.5) * 0.5
    size[i] = 2.2 + Math.random() * 3.8
    alpha[i] = 0.25 + Math.random() * 0.55
    const paletteRoll = Math.random()
    if (paletteRoll < 0.34) {
      // Neutral white
      tintR[i] = 1
      tintG[i] = 1
      tintB[i] = 1
    } else if (paletteRoll < 0.67) {
      // Pale blue
      tintR[i] = 0.72
      tintG[i] = 0.86
      tintB[i] = 1
    } else {
      // Cool grey
      tintR[i] = 0.72
      tintG[i] = 0.76
      tintB[i] = 0.82
    }
  }

  return { u, theta, spin, size, alpha, tintR, tintG, tintB }
}

interface WarpBubbleEffectProps {
  ship: ShipState
  active: boolean
}

export function WarpBubbleEffect({ ship, active }: WarpBubbleEffectProps) {
  const warpReferenceSpeed = useGameStore((s) => s.warpReferenceSpeed)
  const pointsRef = useRef<THREE.Points>(null)
  const materialRef = useRef<THREE.PointsMaterial>(null)
  const positionsRef = useRef<Float32Array>(new Float32Array(PARTICLE_COUNT * 3))
  const colorsRef = useRef<Float32Array>(new Float32Array(PARTICLE_COUNT * 3))
  const sizesRef = useRef<Float32Array>(new Float32Array(PARTICLE_COUNT))
  const particleRef = useRef<ParticleState>(createParticleState())
  const speedNormRef = useRef(0)
  const initializedRef = useRef(false)

  const particleTexture = useMemo(() => {
    const size = 96
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const center = size * 0.5
    const gradient = ctx.createRadialGradient(center, center, size * 0.08, center, center, center)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.25, 'rgba(160,210,255,0.88)')
    gradient.addColorStop(0.7, 'rgba(110,170,255,0.24)')
    gradient.addColorStop(1, 'rgba(90,140,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    const tex = new THREE.CanvasTexture(canvas)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    return tex
  }, [])

  useEffect(() => {
    if (!particleTexture) return
    return () => {
      particleTexture.dispose()
    }
  }, [particleTexture])

  useEffect(() => {
    const material = materialRef.current
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
  }, [])

  useFrame((_, dt) => {
    const points = pointsRef.current
    const material = materialRef.current
    if (!points || !material) return

    const particle = particleRef.current
    const positions = positionsRef.current
    const colors = colorsRef.current
    const sizes = sizesRef.current

    const rawSpeedNorm = warpReferenceSpeed > 0
      ? THREE.MathUtils.clamp(ship.actualSpeed / warpReferenceSpeed, 0, 1)
      : 0
    const smoothing =
      rawSpeedNorm < speedNormRef.current
        ? SPEED_SMOOTH_DECEL
        : SPEED_SMOOTH_ACCEL
    speedNormRef.current = THREE.MathUtils.lerp(speedNormRef.current, rawSpeedNorm, dt * smoothing)
    if (rawSpeedNorm < 0.02) {
      // Prevent lingering trail when ship speed has effectively reached zero.
      speedNormRef.current = rawSpeedNorm
    }
    const smoothSpeedNorm = speedNormRef.current
    const sizeMultiplier = THREE.MathUtils.lerp(1, MAX_SIZE_MULTIPLIER, smoothSpeedNorm)
    const speedRatio = Math.min(MAX_SPEED_RATIO, Math.max(0, ship.actualSpeed * SPEED_FLOW_MULT))
    const flow = (BASE_FLOW + speedRatio * 1.05) * smoothSpeedNorm
    const visibleFraction =
      MIN_VISIBLE_FRACTION + (1 - MIN_VISIBLE_FRACTION) * Math.pow(smoothSpeedNorm, 0.65)
    const visibleCount = Math.floor(PARTICLE_COUNT * visibleFraction)

    if (!active) {
      material.opacity = THREE.MathUtils.lerp(material.opacity, 0, dt * 4)
      speedNormRef.current = THREE.MathUtils.lerp(speedNormRef.current, 0, dt * 7)
      return
    }

    const targetOpacity = 0.04 + 0.72 * Math.pow(smoothSpeedNorm, 0.78)
    material.opacity = THREE.MathUtils.lerp(material.opacity, targetOpacity, dt * 6)

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const idx = i * 3
      if (i >= visibleCount) {
        colors[idx] = 0
        colors[idx + 1] = 0
        colors[idx + 2] = 0
        sizes[i] = 0
        continue
      }
      let u = particle.u[i] + dt * flow * (0.75 + particle.alpha[i] * 0.45)
      if (u > 1) {
        u -= 1
        particle.theta[i] = Math.random() * Math.PI * 2
        particle.spin[i] = (Math.random() - 0.5) * 0.5
        particle.alpha[i] = 0.25 + Math.random() * 0.55
        particle.size[i] = 2.2 + Math.random() * 3.8
        const paletteRoll = Math.random()
        if (paletteRoll < 0.34) {
          particle.tintR[i] = 1
          particle.tintG[i] = 1
          particle.tintB[i] = 1
        } else if (paletteRoll < 0.67) {
          particle.tintR[i] = 0.72
          particle.tintG[i] = 0.86
          particle.tintB[i] = 1
        } else {
          particle.tintR[i] = 0.72
          particle.tintG[i] = 0.76
          particle.tintB[i] = 0.82
        }
      }
      particle.u[i] = u
      particle.theta[i] += particle.spin[i] * dt * (0.5 + speedRatio * 0.55)

      const theta = particle.theta[i]
      const radius = MAX_RADIUS * Math.sqrt(Math.max(0, u))
      const z = APEX_Z - u * BUBBLE_LENGTH
      const x = Math.cos(theta) * radius
      const y = Math.sin(theta) * radius * Y_SCALE

      positions[idx] = x
      positions[idx + 1] = y
      positions[idx + 2] = z

      const fadeHead = THREE.MathUtils.smoothstep(u, 0, 0.22)
      const fadeTail = 1 - THREE.MathUtils.smoothstep(u, TAIL_FADE_START_U, TAIL_FADE_END_U)
      const intensity = Math.max(0.08, fadeHead * fadeTail)
      if (u >= TAIL_CUTOFF_U) {
        colors[idx] = 0
        colors[idx + 1] = 0
        colors[idx + 2] = 0
        sizes[i] = 0
        continue
      }
      colors[idx] = particle.tintR[i] * intensity
      colors[idx + 1] = particle.tintG[i] * intensity
      colors[idx + 2] = particle.tintB[i] * intensity
      sizes[i] = particle.size[i] * sizeMultiplier * (0.85 + intensity * 1.4)
    }

    const posAttr = points.geometry.getAttribute('position')
    const colorAttr = points.geometry.getAttribute('color')
    const sizeAttr = points.geometry.getAttribute('aSize')
    if (posAttr instanceof THREE.BufferAttribute) posAttr.needsUpdate = true
    if (colorAttr instanceof THREE.BufferAttribute) colorAttr.needsUpdate = true
    if (sizeAttr instanceof THREE.BufferAttribute) sizeAttr.needsUpdate = true

    if (!initializedRef.current) {
      initializedRef.current = true
      points.geometry.computeBoundingSphere()
    }
  })

  return (
    <points ref={pointsRef} frustumCulled={false} renderOrder={9}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positionsRef.current, 3]} />
        <bufferAttribute attach="attributes-color" args={[colorsRef.current, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizesRef.current, 1]} />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        color={0xffffff}
        vertexColors
        size={4}
        sizeAttenuation
        map={particleTexture ?? undefined}
        alphaMap={particleTexture ?? undefined}
        alphaTest={0.01}
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  )
}
