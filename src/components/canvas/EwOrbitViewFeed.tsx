import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useEwTvStore, EW_ORBIT_FEED_W, EW_ORBIT_FEED_H } from '@/state/ewTvStore'

/** Same layer mask as `GameCanvas` `MainCameraSetup` (0 + 2): planets/sun on 2, gameplay meshes on 0. */
const PILOT_CAMERA_LAYERS: [number, number] = [0, 2]

/**
 * Renders the main orbit camera to a small offscreen buffer for the EW MFD "TV" tab.
 * Runs after OrbitCameraController in the StarSystem tree so the pilot camera is current.
 */
export function EwOrbitViewFeed() {
  const { gl, scene, camera } = useThree()
  const rt = useRef<THREE.WebGLRenderTarget | null>(null)
  const canvas2d = useRef<HTMLCanvasElement | null>(null)
  const ctx2d = useRef<CanvasRenderingContext2D | null>(null)
  const blitScene = useRef<THREE.Scene | null>(null)
  const blitCam = useRef<THREE.OrthographicCamera | null>(null)
  const blitMat = useRef<THREE.MeshBasicMaterial | null>(null)
  const savedViewport = useRef(new THREE.Vector4())
  const savedScissor = useRef(new THREE.Vector4())
  const savedScissorTest = useRef(false)

  useEffect(() => {
    const c = document.createElement('canvas')
    c.width = EW_ORBIT_FEED_W
    c.height = EW_ORBIT_FEED_H
    canvas2d.current = c
    ctx2d.current = c.getContext('2d')
    useEwTvStore.getState().setCanvas(c)

    rt.current = new THREE.WebGLRenderTarget(EW_ORBIT_FEED_W, EW_ORBIT_FEED_H, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    })

    const mat = new THREE.MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    blitMat.current = mat
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    const sc = new THREE.Scene()
    sc.add(quad)
    blitScene.current = sc
    blitCam.current = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    return () => {
      rt.current?.dispose()
      blitMat.current?.dispose()
      useEwTvStore.getState().setCanvas(null)
      canvas2d.current = null
      ctx2d.current = null
    }
  }, [])

  useFrame(() => {
    const ctx = ctx2d.current
    const target = rt.current
    const bScene = blitScene.current
    const bCam = blitCam.current
    const bMat = blitMat.current
    if (!ctx || !target || !bScene || !bCam || !bMat) return

    if (useEwTvStore.getState().tvConsumers <= 0) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, EW_ORBIT_FEED_W, EW_ORBIT_FEED_H)
      return
    }

    const cam = camera as THREE.PerspectiveCamera
    const prevAspect = cam.aspect
    cam.aspect = EW_ORBIT_FEED_W / EW_ORBIT_FEED_H
    cam.updateProjectionMatrix()

    const prevShadowAutoUpdate = gl.shadowMap.autoUpdate
    const prevShadowNeedsUpdate = gl.shadowMap.needsUpdate
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = false
    const prevMatAutoUpdate = scene.matrixWorldAutoUpdate
    scene.matrixWorldAutoUpdate = false

    const prevLayerMask = cam.layers.mask
    cam.layers.set(PILOT_CAMERA_LAYERS[0]!)
    for (let i = 1; i < PILOT_CAMERA_LAYERS.length; i += 1) {
      cam.layers.enable(PILOT_CAMERA_LAYERS[i]!)
    }

    // With autoUpdate off, WebGLRenderer will not refresh world matrices; without this,
    // ships, instanced chaff, torpedo cylinders, DEW beams, etc. can lag or disappear.
    scene.updateMatrixWorld(true)

    const prevRT = gl.getRenderTarget()
    gl.setRenderTarget(target)
    gl.clear()
    gl.render(scene, cam)

    cam.layers.mask = prevLayerMask

    gl.shadowMap.autoUpdate = prevShadowAutoUpdate
    gl.shadowMap.needsUpdate = prevShadowNeedsUpdate
    scene.matrixWorldAutoUpdate = prevMatAutoUpdate

    cam.aspect = prevAspect
    cam.updateProjectionMatrix()

    bMat.map = target.texture
    bMat.needsUpdate = true

    gl.getViewport(savedViewport.current)
    gl.getScissor(savedScissor.current)
    savedScissorTest.current = gl.getScissorTest()

    gl.setRenderTarget(null)
    gl.setViewport(0, 0, EW_ORBIT_FEED_W, EW_ORBIT_FEED_H)
    gl.setScissorTest(true)
    gl.setScissor(0, 0, EW_ORBIT_FEED_W, EW_ORBIT_FEED_H)
    gl.render(bScene, bCam)

    const dpr = gl.getPixelRatio()
    const actualW = Math.round(EW_ORBIT_FEED_W * dpr)
    const actualH = Math.round(EW_ORBIT_FEED_H * dpr)
    const canvasH = gl.domElement.height
    ctx.drawImage(
      gl.domElement,
      0,
      canvasH - actualH,
      actualW,
      actualH,
      0,
      0,
      EW_ORBIT_FEED_W,
      EW_ORBIT_FEED_H
    )

    gl.setScissorTest(savedScissorTest.current)
    gl.setScissor(savedScissor.current)
    gl.setViewport(savedViewport.current)
    gl.setRenderTarget(prevRT)
  })

  return null
}
