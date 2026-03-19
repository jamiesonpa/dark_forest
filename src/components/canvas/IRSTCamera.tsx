import { useRef, useEffect, useCallback } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import { useIRSTStore } from '@/state/irstStore'
import { getPlayerHullObjectName } from './PlayerShip'

const IRST_W = 720
const IRST_H = 540
export const IRSTCameraSphereRadius = 600
const IRST_EXTREME_HOT_BLOOM_THRESHOLD = 245
const IRST_EXTREME_HOT_BLOOM_MULTIPLIER = 20
const VIS_EXTREME_HOT_BLOOM_SCALE = 0.5
const TRACK_BOX_COLOR = '#44ff66'
const TRACK_BOX_LINE_WIDTH = 1.5

function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360
}

function clampInclination(deg: number): number {
  return Math.max(-85, Math.min(85, deg))
}

export function IRSTCamera() {
  const { gl, scene } = useThree()
  const cam = useRef<THREE.PerspectiveCamera>(null!)
  const rt = useRef<THREE.WebGLRenderTarget>(null!)
  const canvas2d = useRef<HTMLCanvasElement | null>(null)
  const frame = useRef(0)
  const buf = useRef<Uint8Array>(null!)
  const lumBuf = useRef<Float32Array>(null!)
  const bloomBuf = useRef<Float32Array>(null!)
  const imageData = useRef<ImageData | null>(null)
  const trackedBounds = useRef(new THREE.Box3())
  const projectedCorner = useRef(new THREE.Vector3())

  const drawTrackedTargetBounds = useCallback((ctx: CanvasRenderingContext2D) => {
    const irstState = useIRSTStore.getState()
    if (!irstState.pointTrackEnabled || !irstState.pointTrackTargetId) return

    const targetHull = scene.getObjectByName(getPlayerHullObjectName(irstState.pointTrackTargetId))
    if (!targetHull) return

    targetHull.updateMatrixWorld(true)
    const box = trackedBounds.current
    box.setFromObject(targetHull)
    if (box.isEmpty()) return

    const { min, max } = box
    const corners: [number, number, number][] = [
      [min.x, min.y, min.z],
      [min.x, min.y, max.z],
      [min.x, max.y, min.z],
      [min.x, max.y, max.z],
      [max.x, min.y, min.z],
      [max.x, min.y, max.z],
      [max.x, max.y, min.z],
      [max.x, max.y, max.z],
    ]

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let visibleCornerCount = 0

    const corner = projectedCorner.current
    for (const [x, y, z] of corners) {
      corner.set(x, y, z).project(cam.current)
      if (!Number.isFinite(corner.x) || !Number.isFinite(corner.y) || !Number.isFinite(corner.z)) continue
      if (corner.z < -1 || corner.z > 1) continue

      const sx = (corner.x * 0.5 + 0.5) * IRST_W
      const sy = (-corner.y * 0.5 + 0.5) * IRST_H
      minX = Math.min(minX, sx)
      minY = Math.min(minY, sy)
      maxX = Math.max(maxX, sx)
      maxY = Math.max(maxY, sy)
      visibleCornerCount += 1
    }

    if (visibleCornerCount === 0) return
    if (maxX < 0 || maxY < 0 || minX > IRST_W || minY > IRST_H) return

    const clampedMinX = Math.max(0, Math.min(IRST_W - 1, minX))
    const clampedMinY = Math.max(0, Math.min(IRST_H - 1, minY))
    const clampedMaxX = Math.max(0, Math.min(IRST_W - 1, maxX))
    const clampedMaxY = Math.max(0, Math.min(IRST_H - 1, maxY))
    const width = clampedMaxX - clampedMinX
    const height = clampedMaxY - clampedMinY
    if (width < 2 || height < 2) return

    ctx.save()
    ctx.strokeStyle = TRACK_BOX_COLOR
    ctx.lineWidth = TRACK_BOX_LINE_WIDTH
    ctx.strokeRect(clampedMinX, clampedMinY, width, height)
    ctx.restore()
  }, [scene])

  if (!cam.current) {
    cam.current = new THREE.PerspectiveCamera(20, IRST_W / IRST_H, 1, 5000000)
    cam.current.layers.enable(0)
    cam.current.layers.enable(1)
  }
  if (!rt.current) rt.current = new THREE.WebGLRenderTarget(IRST_W, IRST_H)
  if (!buf.current) buf.current = new Uint8Array(IRST_W * IRST_H * 4)
  if (!lumBuf.current) lumBuf.current = new Float32Array(IRST_W * IRST_H)
  if (!bloomBuf.current) bloomBuf.current = new Float32Array(IRST_W * IRST_H)

  useEffect(() => {
    const c = document.createElement('canvas')
    c.width = IRST_W
    c.height = IRST_H
    canvas2d.current = c
    useIRSTStore.getState().setCanvas(c)
    return () => { rt.current?.dispose() }
  }, [])

  const copyToCanvas = useCallback(() => {
    const c = canvas2d.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    if (!imageData.current) imageData.current = ctx.createImageData(IRST_W, IRST_H)
    const shipState = useGameStore.getState().ship
    const irstMode = shipState.irstMode
    const irstSpectrumMode = shipState.irstSpectrumMode
    gl.readRenderTargetPixels(rt.current, 0, 0, IRST_W, IRST_H, buf.current)

    const src = buf.current
    const lum = lumBuf.current
    for (let row = 0; row < IRST_H; row++) {
      const srcRow = (IRST_H - 1 - row) * IRST_W * 4
      for (let col = 0; col < IRST_W; col++) {
        const si = srcRow + col * 4
        const luma = ((src[si] ?? 0) * 77 + (src[si + 1] ?? 0) * 150 + (src[si + 2] ?? 0) * 29) / 256
        lum[row * IRST_W + col] = luma
      }
    }

    const BLOOM_THRESH = 100
    const BG_CEIL = 8
    const BLOOM_R = 8
    const BLOOM_R_REDUCED = 3
    const MAX_BLOOM_HOT_PIXELS = 5000
    const bloom = bloomBuf.current
    bloom.fill(0)

    let hotPixelCount = 0
    for (let i = 0; i < IRST_W * IRST_H; i++) {
      if (lum[i]! > BLOOM_THRESH) hotPixelCount++
    }

    const overloaded = hotPixelCount > MAX_BLOOM_HOT_PIXELS
    const effectiveR = overloaded ? BLOOM_R_REDUCED : BLOOM_R
    const stride = overloaded
      ? Math.max(1, Math.ceil(hotPixelCount / MAX_BLOOM_HOT_PIXELS))
      : 1

    const kSize = effectiveR * 2 + 1
    const falloffLUT = new Float32Array(kSize * kSize)
    for (let ky = 0; ky < kSize; ky++) {
      for (let kx = 0; kx < kSize; kx++) {
        const dy = ky - effectiveR
        const dx = kx - effectiveR
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > effectiveR) {
          falloffLUT[ky * kSize + kx] = -1
        } else {
          const f = 1 - dist / effectiveR
          falloffLUT[ky * kSize + kx] = f * f * 0.5
        }
      }
    }

    let hotIdx = 0
    for (let y = 0; y < IRST_H; y++) {
      for (let x = 0; x < IRST_W; x++) {
        const v = lum[y * IRST_W + x]!
        if (v <= BLOOM_THRESH) continue
        hotIdx++
        if (stride > 1 && hotIdx % stride !== 0) continue

        if (!overloaded) {
          let hotNeighbors = 0
          for (let ny = Math.max(0, y - 1); ny <= Math.min(IRST_H - 1, y + 1); ny++) {
            for (let nx = Math.max(0, x - 1); nx <= Math.min(IRST_W - 1, x + 1); nx++) {
              if (ny === y && nx === x) continue
              if (lum[ny * IRST_W + nx]! > BLOOM_THRESH * 0.5) hotNeighbors++
            }
          }
          if (hotNeighbors < 2) continue
        }

        const hotBoost = v >= IRST_EXTREME_HOT_BLOOM_THRESHOLD
          ? IRST_EXTREME_HOT_BLOOM_MULTIPLIER *
            (irstSpectrumMode === 'VIS' ? VIS_EXTREME_HOT_BLOOM_SCALE : 1)
          : 1
        const excess = (v - BLOOM_THRESH) * hotBoost * stride
        for (let ky = 0; ky < kSize; ky++) {
          const ny = y - effectiveR + ky
          if (ny < 0 || ny >= IRST_H) continue
          for (let kx = 0; kx < kSize; kx++) {
            const nx = x - effectiveR + kx
            if (nx < 0 || nx >= IRST_W) continue
            const falloff = falloffLUT[ky * kSize + kx]!
            if (falloff < 0) continue
            if (!overloaded) {
              const targetLum = lum[ny * IRST_W + nx]!
              if (targetLum > BG_CEIL && targetLum < BLOOM_THRESH) continue
            }
            bloom[ny * IRST_W + nx] += excess * falloff
          }
        }
      }
    }

    const imgData = imageData.current
    if (!imgData) return
    const dst = imgData.data
    if (irstSpectrumMode === 'VIS') {
      const VIS_BLOOM_GAIN = 0.55
      for (let row = 0; row < IRST_H; row++) {
        const srcRow = (IRST_H - 1 - row) * IRST_W * 4
        const dstRow = row * IRST_W * 4
        for (let col = 0; col < IRST_W; col++) {
          const si = srcRow + col * 4
          const di = dstRow + col * 4
          const bloomValue = (bloom[row * IRST_W + col] ?? 0) * VIS_BLOOM_GAIN
          dst[di] = Math.min(255, (src[si] ?? 0) + bloomValue)
          dst[di + 1] = Math.min(255, (src[si + 1] ?? 0) + bloomValue)
          dst[di + 2] = Math.min(255, (src[si + 2] ?? 0) + bloomValue)
          dst[di + 3] = 255
        }
      }
      ctx.putImageData(imgData, 0, 0)
      drawTrackedTargetBounds(ctx)
      return
    }
    for (let i = 0; i < IRST_W * IRST_H; i++) {
      const raw = lum[i]!
      const bloomValue = bloom[i]!
      const combined = Math.min(255, raw + bloomValue)
      const bHotLuma = combined < 15 ? 140 - (combined >> 2) : Math.max(0, 140 - combined)
      const outputLuma = irstMode === 'WHOT' ? 255 - bHotLuma : bHotLuma
      const di = i * 4
      dst[di] = outputLuma
      dst[di + 1] = outputLuma
      dst[di + 2] = outputLuma
      dst[di + 3] = 255
    }
    ctx.putImageData(imgData, 0, 0)
    drawTrackedTargetBounds(ctx)
  }, [drawTrackedTargetBounds, gl])

  useFrame(() => {
    frame.current++
    if (frame.current % 6 !== 0) return
    if (!canvas2d.current) return

    const state = useGameStore.getState()
    if (!state.irstCameraOn) {
      const offCanvas = canvas2d.current
      const offCtx = offCanvas?.getContext('2d')
      if (offCanvas && offCtx) {
        offCtx.fillStyle = '#000'
        offCtx.fillRect(0, 0, offCanvas.width, offCanvas.height)
      }
      return
    }

    const ship = state.ship
    const stabilized = useIRSTStore.getState().stabilized
    const effectiveBearing = stabilized
      ? ship.irstBearing
      : normalizeBearing(360 - ship.actualHeading + ship.irstBearing)
    const effectiveInclination = stabilized
      ? ship.irstInclination
      : clampInclination(ship.actualInclination + ship.irstInclination)
    const bearingRad = THREE.MathUtils.degToRad(effectiveBearing)
    const inclinationRad = THREE.MathUtils.degToRad(effectiveInclination)
    const outX = Math.sin(bearingRad) * Math.cos(inclinationRad)
    const outY = Math.sin(inclinationRad)
    const outZ = Math.cos(bearingRad) * Math.cos(inclinationRad)

    const [shipX, shipY, shipZ] = ship.position
    const camX = shipX + outX * IRSTCameraSphereRadius
    const camY = shipY + outY * IRSTCameraSphereRadius
    const camZ = shipZ + outZ * IRSTCameraSphereRadius
    const zoom = Math.max(1, Math.min(20, ship.irstZoom))
    cam.current.fov = 40 / zoom
    cam.current.updateProjectionMatrix()
    cam.current.position.set(camX, camY, camZ)
    cam.current.lookAt(camX + outX * 100, camY + outY * 100, camZ + outZ * 100)
    cam.current.updateMatrixWorld()

    const prev = gl.getRenderTarget()
    gl.setRenderTarget(rt.current)
    gl.clear()
    gl.render(scene, cam.current)
    gl.setRenderTarget(prev)

    copyToCanvas()
  })

  return null
}
