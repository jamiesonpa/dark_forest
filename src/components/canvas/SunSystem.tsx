import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import { getCelestialById } from '@/utils/systemData'
import type { WarpState } from '@/types/game'

const DEFAULT_SUN_DIRECTION = new THREE.Vector3(0.32, 0.18, 0.93).normalize()
const SUN_DISTANCE = 60000
const FLARE_DISTANCE = 3200
const OCCLUSION_SAMPLE_INTERVAL = 4
const OCCLUDER_REFRESH_INTERVAL = 120
const OCCLUSION_MIN_DISTANCE = 350
const OCCLUSION_DARKENING = 0.995
const WARPING_STATES: WarpState[] = ['warping', 'landing']
const SUN_SCALE_MIN_ORBIT_MULTIPLIER = 2
const SUN_SCALE_MAX_ORBIT_MULTIPLIER = 0.25
const SUN_SCALE_SMOOTH_SPEED = 3.5
const SUN_LIGHT_INTENSITY = 2.4
const SUN_BLOCKED_LIGHT_FACTOR = 0.12
const SUN_SHADOW_DISTANCE = 12000
const SUN_SHADOW_FRUSTUM_RADIUS = 3200
const SUN_SHADOW_NEAR = 100
const SUN_SHADOW_FAR = 26000

type FlareConfig = {
  offset: number
  scale: number
  opacity: number
  texture: THREE.CanvasTexture
}

function createGlowTexture(innerColor: string, outerColor: string) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, innerColor)
  g.addColorStop(0.35, innerColor)
  g.addColorStop(1, outerColor)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

function createHardCoreTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  const center = size * 0.5
  const radius = size * 0.5
  ctx.clearRect(0, 0, size, size)
  const g = ctx.createRadialGradient(center, center, 0, center, center, radius)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.38, 'rgba(255,255,255,1)')
  g.addColorStop(0.48, 'rgba(255,255,255,0.95)')
  g.addColorStop(0.58, 'rgba(255,255,255,0)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

function createDiffuseHaloTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  const center = size * 0.5
  const radius = size * 0.5
  const g = ctx.createRadialGradient(center, center, 0, center, center, radius)
  g.addColorStop(0, 'rgba(255,215,135,0.48)')
  g.addColorStop(0.22, 'rgba(255,195,110,0.28)')
  g.addColorStop(0.46, 'rgba(255,170,90,0.16)')
  g.addColorStop(0.68, 'rgba(255,150,80,0.08)')
  g.addColorStop(0.84, 'rgba(255,135,70,0.035)')
  g.addColorStop(0.94, 'rgba(255,125,64,0.012)')
  g.addColorStop(1, 'rgba(255,120,60,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

function createUltraDiffuseHaloTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return new THREE.CanvasTexture(canvas)
  }

  const center = size * 0.5
  const radius = size * 0.5
  const g = ctx.createRadialGradient(center, center, 0, center, center, radius)
  g.addColorStop(0, 'rgba(255,200,120,0.15)')
  g.addColorStop(0.25, 'rgba(255,180,105,0.1)')
  g.addColorStop(0.5, 'rgba(255,160,92,0.06)')
  g.addColorStop(0.72, 'rgba(255,145,84,0.03)')
  g.addColorStop(0.88, 'rgba(255,135,78,0.012)')
  g.addColorStop(1, 'rgba(255,130,74,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

function getOrbitRadiusExtents(
  celestials: { id: string; position: [number, number, number] }[],
  starPosition: [number, number, number]
) {
  let minRadius = Number.POSITIVE_INFINITY
  let maxRadius = 0
  for (const celestial of celestials) {
    if (celestial.id === 'star') continue
    const dx = celestial.position[0] - starPosition[0]
    const dy = celestial.position[1] - starPosition[1]
    const dz = celestial.position[2] - starPosition[2]
    const radius = Math.hypot(dx, dy, dz)
    if (radius < minRadius) minRadius = radius
    if (radius > maxRadius) maxRadius = radius
  }
  if (!Number.isFinite(minRadius) || maxRadius <= 0) {
    return null
  }
  return { minRadius, maxRadius }
}

export function SunSystem() {
  const { camera, scene } = useThree()
  const directionalLightRef = useRef<THREE.DirectionalLight>(null)
  const sunAnchorRef = useRef<THREE.Group>(null)
  const irstSunGroupRef = useRef<THREE.Group>(null)
  const sunDiscRef = useRef<THREE.Sprite>(null)
  const sunCoreRef = useRef<THREE.Sprite>(null)
  const haloRef = useRef<THREE.Sprite>(null)
  const ultraHaloRef = useRef<THREE.Sprite>(null)
  const flareRefs = useRef<THREE.Sprite[]>([])
  const intensityRef = useRef(0)
  const occlusionRef = useRef(0)
  const frameRef = useRef(0)
  const occludersRef = useRef<THREE.Object3D[]>([])
  const blockedRef = useRef(false)
  const sunScaleFactorRef = useRef(1)

  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const forward = useMemo(() => new THREE.Vector3(), [])
  const sunPos = useMemo(() => new THREE.Vector3(), [])
  const ndc = useMemo(() => new THREE.Vector3(), [])
  const worldTarget = useMemo(() => new THREE.Vector3(), [])
  const worldDir = useMemo(() => new THREE.Vector3(), [])
  const camPos = useMemo(() => new THREE.Vector3(), [])
  const sunRayDir = useMemo(() => new THREE.Vector3(), [])
  const sunDirection = useMemo(() => new THREE.Vector3(), [])
  const sunLightPos = useMemo(() => new THREE.Vector3(), [])
  const shadowTarget = useMemo(() => new THREE.Object3D(), [])
  const irstSunCoreRef = useRef<THREE.Sprite>(null)
  const irstSunHaloRef = useRef<THREE.Sprite>(null)

  const refreshOccluders = () => {
    const next: THREE.Object3D[] = []
    scene.traverse((obj) => {
      if (!obj.visible || obj.userData?.sunVisual || obj.userData?.ignoreSunOcclusion) return
      if ((obj as THREE.Mesh).isMesh || (obj as THREE.InstancedMesh).isInstancedMesh) {
        next.push(obj)
      }
    })
    occludersRef.current = next
  }

  const coreTexture = useMemo(
    () => createGlowTexture('rgba(255,245,210,1)', 'rgba(255,200,80,0)'),
    []
  )
  const hardCoreTexture = useMemo(() => createHardCoreTexture(), [])
  const haloTexture = useMemo(() => createDiffuseHaloTexture(), [])
  const ultraHaloTexture = useMemo(() => createUltraDiffuseHaloTexture(), [])
  const flareTexture = useMemo(
    () => createGlowTexture('rgba(255,220,160,0.85)', 'rgba(255,220,160,0)'),
    []
  )

  const flareConfigs = useMemo<FlareConfig[]>(
    () => [
      { offset: 0.2, scale: 180, opacity: 0.22, texture: flareTexture },
      { offset: 0.45, scale: 240, opacity: 0.18, texture: flareTexture },
      { offset: 0.75, scale: 150, opacity: 0.14, texture: flareTexture },
      { offset: 1.05, scale: 280, opacity: 0.16, texture: haloTexture },
      { offset: 1.35, scale: 120, opacity: 0.13, texture: flareTexture },
    ],
    [flareTexture, haloTexture]
  )

  useEffect(() => {
    shadowTarget.userData.ignoreSunOcclusion = true
    scene.add(shadowTarget)
    if (directionalLightRef.current) {
      directionalLightRef.current.target = shadowTarget
      directionalLightRef.current.shadow.bias = -0.00025
      directionalLightRef.current.shadow.normalBias = 0.02
      directionalLightRef.current.shadow.mapSize.set(1024, 1024)
      directionalLightRef.current.shadow.camera.near = SUN_SHADOW_NEAR
      directionalLightRef.current.shadow.camera.far = SUN_SHADOW_FAR
      directionalLightRef.current.shadow.camera.left = -SUN_SHADOW_FRUSTUM_RADIUS
      directionalLightRef.current.shadow.camera.right = SUN_SHADOW_FRUSTUM_RADIUS
      directionalLightRef.current.shadow.camera.top = SUN_SHADOW_FRUSTUM_RADIUS
      directionalLightRef.current.shadow.camera.bottom = -SUN_SHADOW_FRUSTUM_RADIUS
      directionalLightRef.current.shadow.camera.updateProjectionMatrix()
    }
    refreshOccluders()
    sunCoreRef.current?.layers.set(2)
    sunDiscRef.current?.layers.set(2)
    haloRef.current?.layers.set(2)
    ultraHaloRef.current?.layers.set(2)
    flareRefs.current.forEach((flare) => flare?.layers.set(2))
    irstSunCoreRef.current?.layers.set(1)
    irstSunHaloRef.current?.layers.set(1)
    return () => {
      scene.remove(shadowTarget)
      coreTexture.dispose()
      hardCoreTexture.dispose()
      haloTexture.dispose()
      ultraHaloTexture.dispose()
      flareTexture.dispose()
    }
  }, [coreTexture, hardCoreTexture, haloTexture, scene, shadowTarget, ultraHaloTexture, flareTexture])

  useFrame((_, dt) => {
    frameRef.current += 1
    if (frameRef.current % OCCLUDER_REFRESH_INTERVAL === 0) {
      refreshOccluders()
    }

    const liveState = useGameStore.getState()
    const currentCelestial = getCelestialById(liveState.currentCelestialId, liveState.starSystem)
    const starCelestial = liveState.starSystem.celestials.find((c) => c.id === 'star')
    const sourceCelestial = getCelestialById(
      liveState.warpSourceCelestialId ?? liveState.currentCelestialId,
      liveState.starSystem
    )
    const warpTargetId = liveState.warpTargetId ?? liveState.selectedWarpDestinationId
    const warpTargetCelestial = warpTargetId
      ? getCelestialById(warpTargetId, liveState.starSystem)
      : undefined

    let observerWorldPosition: [number, number, number] | undefined = currentCelestial?.position
    if (
      WARPING_STATES.includes(liveState.warpState) &&
      sourceCelestial &&
      warpTargetCelestial &&
      sourceCelestial.id !== warpTargetCelestial.id
    ) {
      const t = THREE.MathUtils.clamp(liveState.warpTravelProgress, 0, 1)
      observerWorldPosition = [
        sourceCelestial.position[0] + (warpTargetCelestial.position[0] - sourceCelestial.position[0]) * t,
        sourceCelestial.position[1] + (warpTargetCelestial.position[1] - sourceCelestial.position[1]) * t,
        sourceCelestial.position[2] + (warpTargetCelestial.position[2] - sourceCelestial.position[2]) * t,
      ]
    } else if (sourceCelestial) {
      // Keep sun bearing fixed while maneuvering within a grid; subwarp parallax is intentionally ignored.
      observerWorldPosition = sourceCelestial.position
    }

    if (observerWorldPosition) {
      const starWorldPosition = starCelestial?.position ?? ([0, 0, 0] as [number, number, number])
      sunDirection.set(
        starWorldPosition[0] - observerWorldPosition[0],
        starWorldPosition[1] - observerWorldPosition[1],
        starWorldPosition[2] - observerWorldPosition[2]
      )
      if (sunDirection.lengthSq() < 0.0001) {
        sunDirection.copy(DEFAULT_SUN_DIRECTION)
      } else {
        sunDirection.normalize()
      }
    } else {
      sunDirection.copy(DEFAULT_SUN_DIRECTION)
    }

    const starWorldPosition = starCelestial?.position ?? ([0, 0, 0] as [number, number, number])
    const orbitExtents = getOrbitRadiusExtents(liveState.starSystem.celestials, starWorldPosition)
    let targetSunScaleFactor = 1
    if (observerWorldPosition && orbitExtents) {
      const observerRadius = Math.hypot(
        observerWorldPosition[0] - starWorldPosition[0],
        observerWorldPosition[1] - starWorldPosition[1],
        observerWorldPosition[2] - starWorldPosition[2]
      )
      const orbitSpan = orbitExtents.maxRadius - orbitExtents.minRadius
      if (orbitSpan > 0.0001) {
        const orbitT = THREE.MathUtils.clamp(
          (observerRadius - orbitExtents.minRadius) / orbitSpan,
          0,
          1
        )
        targetSunScaleFactor = THREE.MathUtils.lerp(
          SUN_SCALE_MIN_ORBIT_MULTIPLIER,
          SUN_SCALE_MAX_ORBIT_MULTIPLIER,
          orbitT
        )
      }
    }
    sunScaleFactorRef.current = THREE.MathUtils.lerp(
      sunScaleFactorRef.current,
      targetSunScaleFactor,
      THREE.MathUtils.clamp(dt * SUN_SCALE_SMOOTH_SPEED, 0, 1)
    )
    const sunScaleFactor = sunScaleFactorRef.current

    camera.getWorldPosition(camPos)
    sunPos.copy(camPos).addScaledVector(sunDirection, SUN_DISTANCE)
    sunAnchorRef.current?.position.copy(sunPos)
    irstSunGroupRef.current?.position.copy(sunPos)
    shadowTarget.position.copy(camPos)
    shadowTarget.updateMatrixWorld()
    directionalLightRef.current?.position.copy(
      sunLightPos.copy(camPos).addScaledVector(sunDirection, SUN_SHADOW_DISTANCE)
    )

    forward.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize()
    const alignment = THREE.MathUtils.smoothstep(forward.dot(sunDirection), 0.45, 0.995)

    ndc.copy(sunPos).project(camera)
    const inFront = ndc.z > -1 && ndc.z < 1
    const inView = Math.abs(ndc.x) < 1.8 && Math.abs(ndc.y) < 1.8

    if (frameRef.current % OCCLUSION_SAMPLE_INTERVAL === 0) {
      sunRayDir.copy(sunPos).sub(camPos).normalize()
      raycaster.near = OCCLUSION_MIN_DISTANCE
      raycaster.far = SUN_DISTANCE - 50
      raycaster.set(camPos, sunRayDir)
      blockedRef.current = raycaster.intersectObjects(occludersRef.current, false).length > 0
    }
    const blocked = blockedRef.current

    const blockedFactor = blocked ? 0.02 : 1
    const targetIntensity = inFront && inView ? alignment * blockedFactor : 0
    intensityRef.current = THREE.MathUtils.lerp(intensityRef.current, targetIntensity, 0.12)
    const intensity = intensityRef.current
    const targetOcclusion = blocked ? 1 : 0
    // Fast eclipse, slower recovery for a more dramatic occlusion feel.
    const occlusionLerp = blocked ? 0.32 : 0.08
    occlusionRef.current = THREE.MathUtils.lerp(occlusionRef.current, targetOcclusion, occlusionLerp)
    const occlusion = occlusionRef.current
    const lightOcclusionFactor = THREE.MathUtils.lerp(1, SUN_BLOCKED_LIGHT_FACTOR, occlusion)
    if (directionalLightRef.current) {
      directionalLightRef.current.intensity = SUN_LIGHT_INTENSITY * lightOcclusionFactor
    }
    const visibleIntensity = intensity * (1 - occlusion * OCCLUSION_DARKENING)
    const flareOcclusion = Math.max(0, 1 - occlusion * 1.35)
    const edgeFade = 1 - THREE.MathUtils.smoothstep(Math.hypot(ndc.x, ndc.y), 0.7, 1.35)

    const discMaterial = sunDiscRef.current?.material as THREE.SpriteMaterial | undefined
    if (discMaterial) discMaterial.opacity = 0.01 + visibleIntensity * 1.5
    const coreMaterial = sunCoreRef.current?.material as THREE.SpriteMaterial | undefined
    if (coreMaterial) coreMaterial.opacity = 0.01 + flareOcclusion * 0.9
    const haloMaterial = haloRef.current?.material as THREE.SpriteMaterial | undefined
    if (haloMaterial) haloMaterial.opacity = visibleIntensity * 1.15
    const ultraHaloMaterial = ultraHaloRef.current?.material as THREE.SpriteMaterial | undefined
    if (ultraHaloMaterial) ultraHaloMaterial.opacity = visibleIntensity * 0.42
    if (sunCoreRef.current) {
      const coreScale = (900 + visibleIntensity * 1400) * sunScaleFactor
      sunCoreRef.current.scale.set(coreScale, coreScale, 1)
    }
    if (sunDiscRef.current) {
      const discScale = (3600 + visibleIntensity * 5600) * sunScaleFactor
      sunDiscRef.current.scale.set(discScale, discScale, 1)
    }
    if (haloRef.current) {
      const haloScale = (8000 + visibleIntensity * 15000) * sunScaleFactor
      haloRef.current.scale.set(haloScale, haloScale, 1)
    }
    if (ultraHaloRef.current) {
      const ultraHaloScale = (14000 + visibleIntensity * 25000) * sunScaleFactor
      ultraHaloRef.current.scale.set(ultraHaloScale, ultraHaloScale, 1)
    }

    flareRefs.current.forEach((flare, idx) => {
      const config = flareConfigs[idx]
      if (!flare || !config) return

      const mat = flare.material as THREE.SpriteMaterial
      if (intensity < 0.02) {
        mat.opacity = 0
        return
      }

      const ndcX = ndc.x * (1 - config.offset)
      const ndcY = ndc.y * (1 - config.offset)
      worldTarget.set(ndcX, ndcY, 0.25).unproject(camera)
      worldDir.copy(worldTarget).sub(camPos).normalize()
      flare.position.copy(camPos).addScaledVector(worldDir, FLARE_DISTANCE)
      flare.scale.setScalar(config.scale * (1 + visibleIntensity * 1.7) * sunScaleFactor)
      mat.opacity = config.opacity * visibleIntensity * edgeFade * 2.8 * flareOcclusion
    })

    if (irstSunCoreRef.current) {
      const irstCoreScale = 2200 * sunScaleFactor
      irstSunCoreRef.current.scale.set(irstCoreScale, irstCoreScale, 1)
    }
    if (irstSunHaloRef.current) {
      const irstHaloScale = 7000 * sunScaleFactor
      irstSunHaloRef.current.scale.set(irstHaloScale, irstHaloScale, 1)
    }
  })

  return (
    <>
      <directionalLight
        ref={directionalLightRef}
        position={DEFAULT_SUN_DIRECTION.clone().multiplyScalar(20000).toArray()}
        intensity={SUN_LIGHT_INTENSITY}
        castShadow
      />

      <group ref={sunAnchorRef} userData={{ sunVisual: true }} renderOrder={8}>
        <sprite ref={sunCoreRef} userData={{ sunVisual: true }} scale={[1800, 1800, 1]}>
          <spriteMaterial
            map={hardCoreTexture}
            color="#ffffff"
            blending={THREE.NormalBlending}
            depthWrite={false}
            depthTest={false}
            transparent
            toneMapped={false}
            opacity={0.92}
          />
        </sprite>
        <sprite ref={sunDiscRef} userData={{ sunVisual: true }} scale={[5200, 5200, 1]}>
          <spriteMaterial
            map={coreTexture}
            color="#fff7d6"
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            transparent
            toneMapped={false}
            opacity={0.2}
          />
        </sprite>
        <sprite ref={haloRef} userData={{ sunVisual: true }} scale={[9200, 9200, 1]}>
          <spriteMaterial
            map={haloTexture}
            color="#ffbf75"
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            transparent
            toneMapped={false}
            opacity={0.1}
          />
        </sprite>
        <sprite ref={ultraHaloRef} userData={{ sunVisual: true }} scale={[28000, 28000, 1]}>
          <spriteMaterial
            map={ultraHaloTexture}
            color="#ffc484"
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            transparent
            toneMapped={false}
            opacity={0.14}
          />
        </sprite>
      </group>

      {flareConfigs.map((config, idx) => (
        <sprite
          key={`sun-flare-${idx}`}
          ref={(value) => {
            if (value) flareRefs.current[idx] = value
          }}
          userData={{ sunVisual: true }}
          scale={[config.scale, config.scale, 1]}
          renderOrder={10}
        >
          <spriteMaterial
            map={config.texture}
            color="#ffd9a8"
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            transparent
            toneMapped={false}
            opacity={0}
          />
        </sprite>
      ))}

      <group ref={irstSunGroupRef} userData={{ sunVisual: true }} renderOrder={7}>
        <sprite
          ref={irstSunHaloRef}
          userData={{ sunVisual: true }}
          scale={[7000, 7000, 1]}
          renderOrder={7}
        >
          <spriteMaterial
            map={coreTexture}
            color="#ffffff"
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            transparent
            toneMapped={false}
            opacity={0.38}
          />
        </sprite>
        <sprite
          ref={irstSunCoreRef}
          userData={{ sunVisual: true }}
          scale={[2200, 2200, 1]}
          renderOrder={8}
        >
          <spriteMaterial
            map={hardCoreTexture}
            color="#ffffff"
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            depthTest={false}
            transparent
            toneMapped={false}
            opacity={1}
          />
        </sprite>
      </group>
    </>
  )
}
