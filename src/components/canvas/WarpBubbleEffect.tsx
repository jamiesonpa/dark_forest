import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ShipState } from '@/state/types'
import { useGameStore } from '@/state/gameStore'

const APEX_Z = 2600
const BUBBLE_LENGTH = 11500
const MAX_RADIUS = 2700
const SHELL_RADIUS_MULTIPLIER = 1.03
const SHELL_MIN_OPACITY = 0.03
const SHELL_MAX_OPACITY = 0.26
const SHELL_COAST_OPACITY = 0.12
const SHELL_TEX_SIZE = 512
const SHELL_TEX_PAN_MAX = 0.72
const SHELL_TEX_PAN_ACCEL_SMOOTH = 4.2
const SHELL_TEX_PAN_DECEL_SMOOTH = 2.6
const COASTING_EPSILON = 0.005
const SPEED_SMOOTH_ACCEL = 2.5
const SPEED_SMOOTH_DECEL = 2.1
const WARP_MID_PAN_BOOST = 2.4
const SHELL_OPACITY_LERP_ACTIVE = 2.1
const SHELL_OPACITY_LERP_COAST = 1.6
const STAR_TEX_SIZE = 1024
const STAR_DOT_COUNT = 900
const STAR_SHELL_SCALE = 1.01

function easeInOutCubic(t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

function fract(value: number) {
  return value - Math.floor(value)
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function fade(t: number) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function hash2(x: number, y: number): [number, number] {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
  const m = Math.sin(x * 269.5 + y * 183.3) * 43758.5453123
  return [fract(n), fract(m)]
}

function perlinLikeNoise(x: number, y: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const xf = x - x0
  const yf = y - y0
  const sampleGrad = (ix: number, iy: number) => {
    const [rx, ry] = hash2(ix, iy)
    const angle = rx * Math.PI * 2
    const gx = Math.cos(angle)
    const gy = Math.sin(angle)
    const dx = x - ix
    const dy = y - iy
    return (gx * dx + gy * dy) * (0.6 + ry * 0.8)
  }
  const n00 = sampleGrad(x0, y0)
  const n10 = sampleGrad(x0 + 1, y0)
  const n01 = sampleGrad(x0, y0 + 1)
  const n11 = sampleGrad(x0 + 1, y0 + 1)
  const u = fade(xf)
  const v = fade(yf)
  return mix(mix(n00, n10, u), mix(n01, n11, u), v)
}

function fbmPerlin(x: number, y: number) {
  let frequency = 1
  let amplitude = 1
  let total = 0
  let normalizer = 0
  for (let i = 0; i < 4; i += 1) {
    total += perlinLikeNoise(x * frequency, y * frequency) * amplitude
    normalizer += amplitude
    frequency *= 2
    amplitude *= 0.5
  }
  return total / Math.max(0.000001, normalizer)
}

function worleyNoise(x: number, y: number, cellScale: number) {
  const px = x * cellScale
  const py = y * cellScale
  const cellX = Math.floor(px)
  const cellY = Math.floor(py)
  let minDist = Number.POSITIVE_INFINITY
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const ix = cellX + ox
      const iy = cellY + oy
      const [jx, jy] = hash2(ix, iy)
      const fx = ix + jx
      const fy = iy + jy
      const dx = fx - px
      const dy = fy - py
      const dist = Math.hypot(dx, dy)
      if (dist < minDist) minDist = dist
    }
  }
  return Math.min(1, minDist * 1.6)
}

function seamlessSample2D(
  u: number,
  v: number,
  sample: (sx: number, sy: number) => number
) {
  const a = sample(u, v)
  const b = sample(u - 1, v)
  const c = sample(u, v - 1)
  const d = sample(u - 1, v - 1)
  const ux = THREE.MathUtils.clamp(u, 0, 1)
  const vy = THREE.MathUtils.clamp(v, 0, 1)
  const ab = mix(a, b, ux)
  const cd = mix(c, d, ux)
  return mix(ab, cd, vy)
}

function featherHorizontalSeam(
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number,
  featherColumns: number
) {
  const columns = Math.max(1, Math.min(featherColumns, Math.floor(width / 2)))
  for (let y = 0; y < height; y += 1) {
    for (let i = 0; i < columns; i += 1) {
      const leftX = i
      const rightX = width - 1 - i
      const leftIdx = (y * width + leftX) * 4
      const rightIdx = (y * width + rightX) * 4
      const t = (i + 1) / (columns + 1)
      const leftWeight = 1 - t
      const rightWeight = t

      for (let c = 0; c < 4; c += 1) {
        const left = rgbaData[leftIdx + c]
        const right = rgbaData[rightIdx + c]
        const blended = Math.round(left * leftWeight + right * rightWeight)
        rgbaData[leftIdx + c] = blended
        rgbaData[rightIdx + c] = blended
      }
    }
  }
}

function createWarpShellTextures(
  textureSize: number,
  repeatX: number,
  repeatY: number,
  seedOffset: number
) {
  const colorCanvas = document.createElement('canvas')
  const alphaCanvas = document.createElement('canvas')
  colorCanvas.width = textureSize
  colorCanvas.height = textureSize
  alphaCanvas.width = textureSize
  alphaCanvas.height = textureSize
  const colorCtx = colorCanvas.getContext('2d')
  const alphaCtx = alphaCanvas.getContext('2d')
  if (!colorCtx || !alphaCtx) return null

  const colorImage = colorCtx.createImageData(textureSize, textureSize)
  const alphaImage = alphaCtx.createImageData(textureSize, textureSize)
  const colorData = colorImage.data
  const alphaData = alphaImage.data

  for (let y = 0; y < textureSize; y += 1) {
    for (let x = 0; x < textureSize; x += 1) {
      const nx = x / textureSize
      const ny = y / textureSize
      const voronoi = 1 - seamlessSample2D(nx, ny, (sx, sy) =>
        worleyNoise(sx + seedOffset, sy + seedOffset * 0.37, 9 + seedOffset * 2.2)
      )
      const perlin = 0.5 + 0.5 * seamlessSample2D(nx, ny, (sx, sy) =>
        fbmPerlin((sx + seedOffset * 0.21) * 7.2, (sy + seedOffset * 0.19) * 7.2)
      )
      const mixed = Math.pow(THREE.MathUtils.clamp(voronoi * 0.64 + perlin * 0.36, 0, 1), 1.15)
      const bw = Math.round(mixed * 255)
      const inv = 255 - bw
      const idx = (y * textureSize + x) * 4
      colorData[idx] = bw
      colorData[idx + 1] = bw
      colorData[idx + 2] = bw
      colorData[idx + 3] = 255
      alphaData[idx] = inv
      alphaData[idx + 1] = inv
      alphaData[idx + 2] = inv
      alphaData[idx + 3] = 255
    }
  }

  // Extra seam feathering helps remove the last faint lathe seam caused by
  // UV interpolation/filtering at u=0/1.
  featherHorizontalSeam(colorData, textureSize, textureSize, 10)
  featherHorizontalSeam(alphaData, textureSize, textureSize, 10)

  colorCtx.putImageData(colorImage, 0, 0)
  alphaCtx.putImageData(alphaImage, 0, 0)

  const colorTexture = new THREE.CanvasTexture(colorCanvas)
  const alphaTexture = new THREE.CanvasTexture(alphaCanvas)
  ;[colorTexture, alphaTexture].forEach((tex) => {
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeatX, repeatY)
    tex.center.set(0.5, 0.5)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true
  })
  return { colorTexture, alphaTexture }
}

function createStarDotsTexture(textureSize: number) {
  const canvas = document.createElement('canvas')
  canvas.width = textureSize
  canvas.height = textureSize
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.clearRect(0, 0, textureSize, textureSize)
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = 'rgba(255,255,255,1)'
  for (let i = 0; i < STAR_DOT_COUNT; i += 1) {
    const x = Math.floor(Math.random() * (textureSize - 2))
    const y = Math.floor(Math.random() * (textureSize - 2))
    // Hard-edged pixel stars: mostly 1x1 opaque, rare 2x2 for tiny variance.
    const dotSize = Math.random() < 0.08 ? 2 : 1
    ctx.fillRect(x, y, dotSize, dotSize)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1, 1)
  texture.center.set(0.5, 0.5)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

interface WarpBubbleEffectProps {
  ship: ShipState
  active: boolean
}

export function WarpBubbleEffect({ ship, active }: WarpBubbleEffectProps) {
  const warpReferenceSpeed = useGameStore((s) => s.warpReferenceSpeed)
  const warpTravelProgress = useGameStore((s) => s.warpTravelProgress)
  const shellMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const secondaryShellMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const starShellMaterialRef = useRef<THREE.MeshBasicMaterial>(null)
  const speedNormRef = useRef(0)
  const shellPanSpeedRef = useRef(0)

  const shellProfile = useMemo(() => {
    const samples = 48
    const points: THREE.Vector2[] = []
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples
      const radius = MAX_RADIUS * SHELL_RADIUS_MULTIPLIER * Math.sqrt(t)
      const axis = APEX_Z - t * BUBBLE_LENGTH
      points.push(new THREE.Vector2(radius, axis))
    }
    return points
  }, [])

  const shellTextures = useMemo(
    () => createWarpShellTextures(SHELL_TEX_SIZE, 1, 1, 0.11),
    []
  )
  const secondaryShellTextures = useMemo(
    () => createWarpShellTextures(SHELL_TEX_SIZE, 2, 2, 0.67),
    []
  )
  const starDotsTexture = useMemo(
    () => createStarDotsTexture(STAR_TEX_SIZE),
    []
  )

  useEffect(() => {
    if (!shellTextures) return
    return () => {
      shellTextures.colorTexture.dispose()
      shellTextures.alphaTexture.dispose()
    }
  }, [shellTextures])

  useEffect(() => {
    if (!secondaryShellTextures) return
    return () => {
      secondaryShellTextures.colorTexture.dispose()
      secondaryShellTextures.alphaTexture.dispose()
    }
  }, [secondaryShellTextures])

  useEffect(() => {
    if (!starDotsTexture) return
    return () => {
      starDotsTexture.dispose()
    }
  }, [starDotsTexture])

  useFrame((_, dt) => {
    const shellMaterial = shellMaterialRef.current
    const secondaryShellMaterial = secondaryShellMaterialRef.current
    const starShellMaterial = starShellMaterialRef.current
    if (!shellMaterial || !secondaryShellMaterial || !starShellMaterial) return

    const rawSpeedNorm = active && warpReferenceSpeed > 0
      ? THREE.MathUtils.clamp(ship.actualSpeed / warpReferenceSpeed, 0, 1)
      : 0
    const smoothing =
      rawSpeedNorm < speedNormRef.current
        ? SPEED_SMOOTH_DECEL
        : SPEED_SMOOTH_ACCEL
    speedNormRef.current = THREE.MathUtils.lerp(speedNormRef.current, rawSpeedNorm, dt * smoothing)
    const smoothSpeedNorm = speedNormRef.current
    const coasting = !active && smoothSpeedNorm > COASTING_EPSILON
    const clampedProgress = THREE.MathUtils.clamp(warpTravelProgress, 0, 1)
    const bellCurve = 4 * clampedProgress * (1 - clampedProgress)
    const easedSpeedNorm = easeInOutCubic(smoothSpeedNorm)
    const shellTargetOpacity = active
      ? SHELL_MIN_OPACITY + (SHELL_MAX_OPACITY - SHELL_MIN_OPACITY) * easedSpeedNorm
      : SHELL_COAST_OPACITY * easeInOutCubic(Math.pow(smoothSpeedNorm, 0.85))
    if (shellTextures) {
      const panNorm = Math.pow(THREE.MathUtils.clamp(smoothSpeedNorm, 0, 1), 1.12)
      const warpPanBoost = active ? 1 + WARP_MID_PAN_BOOST * bellCurve : 1
      const targetPanSpeed = (active || coasting) ? panNorm * SHELL_TEX_PAN_MAX * warpPanBoost : 0
      const panSmoothing = targetPanSpeed < shellPanSpeedRef.current
        ? SHELL_TEX_PAN_DECEL_SMOOTH
        : SHELL_TEX_PAN_ACCEL_SMOOTH
      shellPanSpeedRef.current = THREE.MathUtils.lerp(
        shellPanSpeedRef.current,
        targetPanSpeed,
        dt * panSmoothing
      )
      shellTextures.colorTexture.offset.y = fract(shellTextures.colorTexture.offset.y - dt * shellPanSpeedRef.current)
      shellTextures.alphaTexture.offset.y = shellTextures.colorTexture.offset.y
      shellTextures.colorTexture.offset.x = fract(shellTextures.colorTexture.offset.x + dt * shellPanSpeedRef.current * 0.09)
      shellTextures.alphaTexture.offset.x = shellTextures.colorTexture.offset.x
    }
    if (secondaryShellTextures && shellTextures) {
      secondaryShellTextures.colorTexture.offset.x = shellTextures.colorTexture.offset.x
      secondaryShellTextures.colorTexture.offset.y = shellTextures.colorTexture.offset.y
      secondaryShellTextures.alphaTexture.offset.x = shellTextures.alphaTexture.offset.x
      secondaryShellTextures.alphaTexture.offset.y = shellTextures.alphaTexture.offset.y
    }
    if (starDotsTexture && shellTextures) {
      // Star layer should read as front-to-back motion only.
      starDotsTexture.offset.x = 0
      starDotsTexture.offset.y = shellTextures.colorTexture.offset.y
      const stretchY = THREE.MathUtils.lerp(1, 0.05, bellCurve)
      starDotsTexture.repeat.set(1, stretchY)
    }
    if (!active && !coasting) {
      shellMaterial.opacity = THREE.MathUtils.lerp(shellMaterial.opacity, 0, dt * 8)
      secondaryShellMaterial.opacity = THREE.MathUtils.lerp(secondaryShellMaterial.opacity, 0, dt * 8)
      starShellMaterial.opacity = THREE.MathUtils.lerp(starShellMaterial.opacity, 0, dt * 8)
      speedNormRef.current = 0
      shellPanSpeedRef.current = THREE.MathUtils.lerp(shellPanSpeedRef.current, 0, dt * 8)
      return
    }

    shellMaterial.opacity = THREE.MathUtils.lerp(
      shellMaterial.opacity,
      THREE.MathUtils.clamp(shellTargetOpacity * 1.1, 0, 1),
      dt * (active ? SHELL_OPACITY_LERP_ACTIVE : SHELL_OPACITY_LERP_COAST)
    )
    secondaryShellMaterial.opacity = THREE.MathUtils.lerp(
      secondaryShellMaterial.opacity,
      THREE.MathUtils.clamp(shellTargetOpacity * 1.1, 0, 1),
      dt * (active ? SHELL_OPACITY_LERP_ACTIVE : SHELL_OPACITY_LERP_COAST)
    )
    starShellMaterial.opacity = THREE.MathUtils.lerp(
      starShellMaterial.opacity,
      THREE.MathUtils.clamp(shellTargetOpacity * 1.35, 0, 1),
      dt * (active ? SHELL_OPACITY_LERP_ACTIVE : SHELL_OPACITY_LERP_COAST)
    )
  })

  return (
    <>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        frustumCulled={false}
        renderOrder={8}
        userData={{ ignoreSunOcclusion: true }}
      >
        <latheGeometry args={[shellProfile, 72]} />
        <meshBasicMaterial
          ref={shellMaterialRef}
          color={0x58a8ff}
          map={shellTextures?.colorTexture}
          alphaMap={shellTextures?.alphaTexture}
          transparent
          opacity={0}
          alphaTest={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        frustumCulled={false}
        renderOrder={8}
        userData={{ ignoreSunOcclusion: true }}
      >
        <latheGeometry args={[shellProfile, 72]} />
        <meshBasicMaterial
          ref={secondaryShellMaterialRef}
          color={0xb0b6c2}
          map={secondaryShellTextures?.colorTexture}
          alphaMap={secondaryShellTextures?.alphaTexture}
          transparent
          opacity={0}
          alphaTest={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        scale={[STAR_SHELL_SCALE, STAR_SHELL_SCALE, STAR_SHELL_SCALE]}
        frustumCulled={false}
        renderOrder={9}
        userData={{ ignoreSunOcclusion: true }}
      >
        <latheGeometry args={[shellProfile, 72]} />
        <meshBasicMaterial
          ref={starShellMaterialRef}
          color={0xffffff}
          map={starDotsTexture ?? undefined}
          alphaMap={starDotsTexture ?? undefined}
          transparent
          opacity={0}
          alphaTest={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </>
  )
}
