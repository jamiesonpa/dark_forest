import { useRef, useEffect, useCallback } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import { useIRSTStore } from '@/state/irstStore'

const IRST_W = 320
const IRST_H = 240
export const IRSTCameraSphereRadius = 600
export const IRSTCameraSphereCenter: [number, number, number] = [0, 0, 0]

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
    gl.readRenderTargetPixels(rt.current, 0, 0, IRST_W, IRST_H, buf.current)

    const src = buf.current
    const lum = lumBuf.current
    for (let row = 0; row < IRST_H; row++) {
      const srcRow = (IRST_H - 1 - row) * IRST_W * 4
      for (let col = 0; col < IRST_W; col++) {
        const si = srcRow + col * 4
        lum[row * IRST_W + col] =
          ((src[si] ?? 0) * 77 + (src[si + 1] ?? 0) * 150 + (src[si + 2] ?? 0) * 29) / 256
      }
    }

    const BLOOM_THRESH = 100
    const BG_CEIL = 8
    const BLOOM_R = 8
    const bloom = bloomBuf.current
    bloom.fill(0)
    for (let y = 0; y < IRST_H; y++) {
      for (let x = 0; x < IRST_W; x++) {
        const v = lum[y * IRST_W + x]!
        if (v <= BLOOM_THRESH) continue
        let hotNeighbors = 0
        for (let ny = Math.max(0, y - 1); ny <= Math.min(IRST_H - 1, y + 1); ny++) {
          for (let nx = Math.max(0, x - 1); nx <= Math.min(IRST_W - 1, x + 1); nx++) {
            if (ny === y && nx === x) continue
            if (lum[ny * IRST_W + nx]! > BLOOM_THRESH * 0.5) hotNeighbors++
          }
        }
        if (hotNeighbors < 2) continue
        const excess = v - BLOOM_THRESH
        for (let dy = -BLOOM_R; dy <= BLOOM_R; dy++) {
          for (let dx = -BLOOM_R; dx <= BLOOM_R; dx++) {
            const ny = y + dy, nx = x + dx
            if (ny < 0 || ny >= IRST_H || nx < 0 || nx >= IRST_W) continue
            const targetLum = lum[ny * IRST_W + nx]!
            if (targetLum > BG_CEIL && targetLum < BLOOM_THRESH) continue
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist > BLOOM_R) continue
            const falloff = (1 - dist / BLOOM_R) * (1 - dist / BLOOM_R)
            bloom[ny * IRST_W + nx] = (bloom[ny * IRST_W + nx] ?? 0) + excess * falloff * 0.5
          }
        }
      }
    }

    const imgData = imageData.current
    if (!imgData) return
    const dst = imgData.data
    for (let i = 0; i < IRST_W * IRST_H; i++) {
      const raw = lum[i]!
      const bloomValue = bloom[i]!
      const combined = Math.min(255, raw + bloomValue)
      const inv = combined < 15 ? 140 - (combined >> 2) : Math.max(0, 140 - combined)
      const di = i * 4
      dst[di] = inv
      dst[di + 1] = inv
      dst[di + 2] = inv
      dst[di + 3] = 255
    }
    ctx.putImageData(imgData, 0, 0)
  }, [gl])

  useFrame(() => {
    frame.current++
    if (frame.current % 6 !== 0) return
    if (!canvas2d.current) return

    const ship = useGameStore.getState().ship
    const bearingRad = THREE.MathUtils.degToRad(ship.irstBearing)
    const inclinationRad = THREE.MathUtils.degToRad(ship.irstInclination)
    const outX = Math.sin(bearingRad) * Math.cos(inclinationRad)
    const outY = Math.sin(inclinationRad)
    const outZ = Math.cos(bearingRad) * Math.cos(inclinationRad)

    // The rendered player ship stays at scene origin, so anchor the IRST sphere there.
    const camX = IRSTCameraSphereCenter[0] + outX * IRSTCameraSphereRadius
    const camY = IRSTCameraSphereCenter[1] + outY * IRSTCameraSphereRadius
    const camZ = IRSTCameraSphereCenter[2] + outZ * IRSTCameraSphereRadius
    const zoom = Math.max(1, Math.min(10, ship.irstZoom))
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
