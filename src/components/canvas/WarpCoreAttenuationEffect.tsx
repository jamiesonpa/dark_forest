import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const PARTICLE_COUNT = 10
/** Tight shell around ship-local origin (hull center). */
const SHELL_R_MIN = 6
const SHELL_R_MAX = 42
const NOISE_TEX_SIZE = 256
/** Scales `aSize` and screen `gl_PointSize` clamp together (5× prior × 5×). */
const PARTICLE_POINT_SIZE_SCALE = 25
const POINT_SIZE_CLAMP_MIN = 5 * PARTICLE_POINT_SIZE_SCALE
const POINT_SIZE_CLAMP_MAX = 96 * PARTICLE_POINT_SIZE_SCALE

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

/** Gradient-style Perlin (2D). */
function perlinLikeNoise2D(x: number, y: number) {
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

function fbmPerlin2D(x: number, y: number) {
  let frequency = 1
  let amplitude = 1
  let total = 0
  let normalizer = 0
  for (let i = 0; i < 5; i += 1) {
    total += perlinLikeNoise2D(x * frequency, y * frequency) * amplitude
    normalizer += amplitude
    frequency *= 2
    amplitude *= 0.52
  }
  return total / Math.max(1e-6, normalizer)
}

function createProceduralPerlinNoiseTexture(size: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    return tex
  }
  const imageData = ctx.createImageData(size, size)
  const data = imageData.data
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const nx = i / size
      const ny = j / size
      const raw = fbmPerlin2D(nx * 6.2, ny * 6.2) * 0.55 + 0.5
      const wispy = Math.pow(THREE.MathUtils.clamp(raw, 0, 1), 1.35)
      const g = Math.floor(wispy * 255)
      const idx = (j * size + i) * 4
      data[idx] = g
      data[idx + 1] = g
      data[idx + 2] = g
      data[idx + 3] = 255
    }
  }
  ctx.putImageData(imageData, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

let sharedNoiseTexture: THREE.CanvasTexture | null = null

function getSharedWarpAttenuationNoiseTexture(): THREE.CanvasTexture {
  if (!sharedNoiseTexture) {
    sharedNoiseTexture = createProceduralPerlinNoiseTexture(NOISE_TEX_SIZE)
  }
  return sharedNoiseTexture
}

function strHash01(s: string) {
  let h = 5381
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (Math.abs(h) % 10000) / 10000
}

function seeded01(seed: number, salt: number) {
  const x = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

const vertexShader = `
uniform float uTime;
attribute float aSize;
attribute vec3 aSeed;
attribute float aFadePhase;
attribute float aFadeSpeed;
attribute float aRotatePhase;
attribute float aRotateSpeed;
varying vec2 vNoiseUv;
varying float vPulse;
varying float vOpacityMod;
varying float vRotAngle;

void main() {
  vec3 pos = position;
  vec3 dir = normalize(pos + vec3(0.0001));
  float t = uTime;
  float pulse = 0.5 + 0.5 * sin(t * 1.05 + aSeed.x * 18.0);
  pos *= 1.0 + 0.012 * sin(t * 0.88 + aSeed.y * 14.0);
  pos += dir * pulse * 4.5;
  pos += vec3(
    sin(t * 0.61 + aSeed.x * 9.0),
    cos(t * 0.57 + aSeed.y * 11.0),
    sin(t * 0.69 + aSeed.z * 7.0)
  ) * 4.5;
  vNoiseUv = pos.xy * 0.0038 + pos.z * 0.0028 + t * 0.038;
  vPulse = pulse;
  float fadeRaw = sin(t * aFadeSpeed + aFadePhase) * 0.5 + 0.5;
  vOpacityMod = fadeRaw * fadeRaw * (3.0 - 2.0 * fadeRaw);
  vRotAngle = t * aRotateSpeed + aRotatePhase;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float s = aSize * (1.0 + 0.32 * pulse) * (300.0 / max(-mvPosition.z, 1.0));
  gl_PointSize = clamp(s, ${POINT_SIZE_CLAMP_MIN}.0, ${POINT_SIZE_CLAMP_MAX}.0);
}
`

const fragmentShader = /* glsl */ `
uniform sampler2D uNoiseMap;
uniform float uTime;
varying vec2 vNoiseUv;
varying float vPulse;
varying float vOpacityMod;
varying float vRotAngle;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float co = cos(vRotAngle);
  float si = sin(vRotAngle);
  vec2 gv = vec2(co * uv.x - si * uv.y, si * uv.x + co * uv.y);
  float d = clamp(length(gv) * 2.0, 0.0, 1.0);
  // Wide soft vignette: full strength near center, long ease to transparent at rim
  float edgeVig = smoothstep(1.0, 0.26, d);
  edgeVig = edgeVig * edgeVig * (3.0 - 2.0 * edgeVig);
  vec2 sampleUv = gv + 0.5;
  float n = texture2D(uNoiseMap, sampleUv * 0.55 + vNoiseUv).r;
  float n2 = texture2D(uNoiseMap, sampleUv.yx * 0.62 + vNoiseUv * 1.25 + uTime * 0.048).r;
  float mist = pow(max(edgeVig * n * n2, 0.0), 0.82);
  // Cumulative ~2.25× more transparent vs original (two ×1.5 steps)
  float alpha = mist * (0.2 + 0.18 * vPulse) * vOpacityMod / 2.25;
  vec3 col = vec3(0.32, 0.74, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`

type WarpCoreAttenuationEffectProps = {
  /** Stabilizes random layout per ship instance. */
  playerId: string
}

export function WarpCoreAttenuationEffect({ playerId }: WarpCoreAttenuationEffectProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const baseSeed = useMemo(() => strHash01(playerId) * 1000, [playerId])

  const { positions, sizes, seeds, fadePhases, fadeSpeeds, rotatePhases, rotateSpeeds } = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    const sizes = new Float32Array(PARTICLE_COUNT)
    const seeds = new Float32Array(PARTICLE_COUNT * 3)
    const fadePhases = new Float32Array(PARTICLE_COUNT)
    const fadeSpeeds = new Float32Array(PARTICLE_COUNT)
    const rotatePhases = new Float32Array(PARTICLE_COUNT)
    const rotateSpeeds = new Float32Array(PARTICLE_COUNT)
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const u = seeded01(baseSeed, i * 17 + 1)
      const v = seeded01(baseSeed, i * 17 + 2)
      const w = seeded01(baseSeed, i * 17 + 3)
      const theta = u * Math.PI * 2
      const phi = Math.acos(2 * v - 1)
      const r = SHELL_R_MIN + w * (SHELL_R_MAX - SHELL_R_MIN)
      const sp = Math.sin(phi)
      positions[i * 3] = r * sp * Math.cos(theta)
      positions[i * 3 + 1] = r * sp * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)
      const sizeHalfOrDouble = seeded01(baseSeed, i * 83 + 13) < 0.5 ? 0.5 : 2.0
      sizes[i] =
        (18 + seeded01(baseSeed, i * 31 + 4) * 38) * PARTICLE_POINT_SIZE_SCALE * sizeHalfOrDouble
      seeds[i * 3] = seeded01(baseSeed, i * 41 + 5) * 40
      seeds[i * 3 + 1] = seeded01(baseSeed, i * 41 + 6) * 40
      seeds[i * 3 + 2] = seeded01(baseSeed, i * 41 + 7) * 40
      fadePhases[i] = seeded01(baseSeed, i * 53 + 8) * Math.PI * 2
      fadeSpeeds[i] = 0.38 + seeded01(baseSeed, i * 59 + 9) * 0.85
      rotatePhases[i] = seeded01(baseSeed, i * 67 + 10) * Math.PI * 2
      const spinSign = seeded01(baseSeed, i * 71 + 11) < 0.5 ? -1 : 1
      rotateSpeeds[i] = spinSign * (0.55 + seeded01(baseSeed, i * 73 + 12) * 2.15)
    }
    return { positions, sizes, seeds, fadePhases, fadeSpeeds, rotatePhases, rotateSpeeds }
  }, [baseSeed])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uNoiseMap: { value: getSharedWarpAttenuationNoiseTexture() },
    }),
    []
  )

  useFrame((state) => {
    const m = materialRef.current
    const u = m?.uniforms.uTime
    if (u) u.value = state.clock.elapsedTime
  })

  useEffect(() => {
    return () => {
      const m = materialRef.current
      if (m) m.dispose()
    }
  }, [])

  return (
    <points frustumCulled={false} renderOrder={6}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 3]} />
        <bufferAttribute attach="attributes-aFadePhase" args={[fadePhases, 1]} />
        <bufferAttribute attach="attributes-aFadeSpeed" args={[fadeSpeeds, 1]} />
        <bufferAttribute attach="attributes-aRotatePhase" args={[rotatePhases, 1]} />
        <bufferAttribute attach="attributes-aRotateSpeed" args={[rotateSpeeds, 1]} />
      </bufferGeometry>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  )
}
