import { useRef, useEffect, useCallback } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import { useIRSTStore, irstDragOverride } from '@/state/irstStore'
import { getPlayerHullObjectName } from './PlayerShip'

const IRST_W = 320
const IRST_H = 240
export const IRSTCameraSphereRadius = 600
const TRACK_BOX_COLOR = '#44ff66'
const TRACK_BOX_LINE_WIDTH = 1.5

const BLIT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

const BLIT_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tScene;
uniform int uMode;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  if (uMode == 2) {
    gl_FragColor = vec4(c, 1.0);
    return;
  }
  float luma = dot(c, vec3(0.30078, 0.58594, 0.11328));
  float bHot = luma < 0.05882
    ? 0.5490 - luma * 0.25
    : max(0.0, 0.5490 - luma);
  float v = uMode == 1 ? 1.0 - bHot : bHot;
  gl_FragColor = vec4(v, v, v, 1.0);
}`

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
  const ctx2d = useRef<CanvasRenderingContext2D | null>(null)
  const mountedRef = useRef(true)
  const trackedBounds = useRef(new THREE.Box3())
  const projectedCorner = useRef(new THREE.Vector3())
  const blitScene = useRef<THREE.Scene>(null!)
  const blitCam = useRef<THREE.Camera>(null!)
  const blitMat = useRef<THREE.ShaderMaterial>(null!)
  const savedViewport = useRef(new THREE.Vector4())
  const savedScissor = useRef(new THREE.Vector4())
  const savedScissorTest = useRef(false)

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
  if (!blitScene.current) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, uMode: { value: 2 } },
      vertexShader: BLIT_VERT,
      fragmentShader: BLIT_FRAG,
      depthWrite: false,
      depthTest: false,
    })
    blitMat.current = mat
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    const sc = new THREE.Scene()
    sc.add(quad)
    blitScene.current = sc
    blitCam.current = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  }

  useEffect(() => {
    mountedRef.current = true
    const c = document.createElement('canvas')
    c.width = IRST_W
    c.height = IRST_H
    canvas2d.current = c
    ctx2d.current = c.getContext('2d')
    useIRSTStore.getState().setCanvas(c)
    return () => {
      mountedRef.current = false
      rt.current?.dispose()
      blitMat.current?.dispose()
    }
  }, [])

  useFrame(() => {
    const ctx = ctx2d.current
    if (!ctx) return

    const state = useGameStore.getState()
    if (!state.irstCameraOn) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, IRST_W, IRST_H)
      return
    }

    const ship = state.ship
    const stabilized = useIRSTStore.getState().stabilized
    const rawBearing = irstDragOverride.active ? irstDragOverride.bearing : ship.irstBearing
    const rawInclination = irstDragOverride.active ? irstDragOverride.inclination : ship.irstInclination
    const effectiveBearing = stabilized
      ? rawBearing
      : normalizeBearing(360 - ship.actualHeading + rawBearing)
    const effectiveInclination = stabilized
      ? rawInclination
      : clampInclination(ship.actualInclination + rawInclination)
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

    const prevShadowAutoUpdate = gl.shadowMap.autoUpdate
    const prevShadowNeedsUpdate = gl.shadowMap.needsUpdate
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = false
    const prevMatAutoUpdate = scene.matrixWorldAutoUpdate
    scene.matrixWorldAutoUpdate = false

    const prevRT = gl.getRenderTarget()
    gl.setRenderTarget(rt.current)
    gl.clear()
    gl.render(scene, cam.current)

    gl.shadowMap.autoUpdate = prevShadowAutoUpdate
    gl.shadowMap.needsUpdate = prevShadowNeedsUpdate
    scene.matrixWorldAutoUpdate = prevMatAutoUpdate

    const mode: 'BHOT' | 'WHOT' | 'VIS' =
      ship.irstSpectrumMode === 'VIS' ? 'VIS'
        : ship.irstMode === 'WHOT' ? 'WHOT' : 'BHOT'

    blitMat.current.uniforms.tScene!.value = rt.current.texture
    blitMat.current.uniforms.uMode!.value = mode === 'VIS' ? 2 : mode === 'WHOT' ? 1 : 0

    gl.getViewport(savedViewport.current)
    gl.getScissor(savedScissor.current)
    savedScissorTest.current = gl.getScissorTest()

    gl.setRenderTarget(null)
    gl.setViewport(0, 0, IRST_W, IRST_H)
    gl.setScissorTest(true)
    gl.setScissor(0, 0, IRST_W, IRST_H)
    gl.render(blitScene.current, blitCam.current)

    const dpr = gl.getPixelRatio()
    const actualW = Math.round(IRST_W * dpr)
    const actualH = Math.round(IRST_H * dpr)
    const canvasH = gl.domElement.height
    ctx.drawImage(
      gl.domElement,
      0, canvasH - actualH, actualW, actualH,
      0, 0, IRST_W, IRST_H,
    )
    drawTrackedTargetBounds(ctx)

    gl.setScissorTest(savedScissorTest.current)
    gl.setScissor(savedScissor.current)
    gl.setViewport(savedViewport.current)
    gl.setRenderTarget(prevRT)
  })

  return null
}
