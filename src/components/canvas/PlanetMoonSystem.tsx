import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGameStore } from '@/state/gameStore'
import { WORLD_UNITS_PER_AU } from '@/systems/warp/navigationMath'
import { getCelestialById } from '@/utils/systemData'

const DISTANT_BODY_ANCHOR_DISTANCE = 58000
const CURRENT_PLANET_ANCHOR_CLEARANCE = 12000
const VISIBILITY_DISTANCE_AU = 100
const VISIBILITY_DISTANCE_WORLD = VISIBILITY_DISTANCE_AU * WORLD_UNITS_PER_AU
const SCALE_SMOOTH_SPEED = 4.2
const DISTANT_BODY_MIN_SCALE = 10
const DISTANT_BODY_MAX_SCALE = 25_000
const DISTANT_BODY_PRELANDING_MAX_SCALE = DISTANT_BODY_MAX_SCALE * 0.92
const DISTANT_BODY_APPARENT_SIZE_TUNING = 0.08
const WARPING_STATES = new Set(['warping', 'landing'])
const DEFAULT_BODY_DIRECTION = new THREE.Vector3(0.18, 0.11, 0.97).normalize()
const PLANET_TEXTURE_TINT = '#b8b8b8'
const PLANET_TEXTURE_MODULES = (
  import.meta as unknown as {
    glob: (
      pattern: string,
      options: { eager: true; import: 'default' }
    ) => Record<string, string>
  }
).glob('/planetary_textures/**/*.{png,jpg,jpeg,webp,avif}', {
  eager: true,
  import: 'default',
})

type DistantBody = {
  id: string
  type: 'planet'
  radius: number
}

function isCloudTexturePath(path: string) {
  return /cloud/i.test(path)
}

function stableIndexFromId(id: string, count: number) {
  if (count <= 0) return 0
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0) % count
}

function textureAssignmentKey(bodyId: string, nonce: number) {
  return `${bodyId}:${nonce}`
}

function bodyColor() {
  return '#ff2b2b'
}

export function PlanetMoonSystem() {
  const { camera } = useThree()
  const starSystem = useGameStore((s) => s.starSystem)
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const planetTextureRandomizeNonce = useGameStore((s) => s.planetTextureRandomizeNonce)

  const bodyRefs = useRef<Record<string, THREE.Mesh | null>>({})
  const bodyScaleRef = useRef<Record<string, number>>({})
  const camPos = useMemo(() => new THREE.Vector3(), [])
  const direction = useMemo(() => new THREE.Vector3(), [])

  const distantBodyGeometry = useMemo(() => new THREE.SphereGeometry(1, 48, 32), [])
  const planetTextures = useMemo(() => {
    const urls = Object.entries(PLANET_TEXTURE_MODULES)
      .filter(([path]) => !isCloudTexturePath(path))
      .map(([, url]) => url)
    const loader = new THREE.TextureLoader()
    return urls.map((url) => {
      const texture = loader.load(url)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.minFilter = THREE.LinearMipmapLinearFilter
      texture.magFilter = THREE.LinearFilter
      return texture
    })
  }, [])

  const distantBodies = useMemo<DistantBody[]>(() => {
    return starSystem.celestials
      .filter((celestial): celestial is typeof celestial & { type: 'planet' } => (
        celestial.type === 'planet'
      ))
      .map((celestial) => ({
        id: celestial.id,
        type: celestial.type,
        radius: Math.max(60, celestial.radius ?? 320),
      }))
  }, [starSystem, currentCelestialId])

  useEffect(() => {
    return () => {
      distantBodyGeometry.dispose()
      for (const texture of planetTextures) texture.dispose()
    }
  }, [distantBodyGeometry, planetTextures])

  const planetTextureByBodyId = useMemo(() => {
    if (planetTextures.length === 0) return {}
    const assignments: Record<string, THREE.Texture> = {}
    for (const body of distantBodies) {
      if (body.type !== 'planet') continue
      const textureIndex = stableIndexFromId(
        textureAssignmentKey(body.id, planetTextureRandomizeNonce),
        planetTextures.length
      )
      const assignedTexture = planetTextures[textureIndex]
      if (assignedTexture) assignments[body.id] = assignedTexture
    }
    return assignments
  }, [distantBodies, planetTextures, planetTextureRandomizeNonce])

  useFrame((_, dt) => {
    const liveState = useGameStore.getState()
    const currentCelestial = getCelestialById(liveState.currentCelestialId, liveState.starSystem)
    const sourceCelestial = getCelestialById(
      liveState.warpSourceCelestialId ?? liveState.currentCelestialId,
      liveState.starSystem
    )
    const warpTargetId = liveState.warpTargetId ?? liveState.selectedWarpDestinationId
    const warpTargetCelestial = warpTargetId
      ? getCelestialById(warpTargetId, liveState.starSystem)
      : undefined

    let renderShipWorld: [number, number, number] = currentCelestial?.position ?? [0, 0, 0]
    if (
      WARPING_STATES.has(liveState.warpState) &&
      sourceCelestial &&
      warpTargetCelestial &&
      sourceCelestial.id !== warpTargetCelestial.id
    ) {
      const t = THREE.MathUtils.clamp(liveState.warpTravelProgress, 0, 1)
      renderShipWorld = [
        sourceCelestial.position[0] + (warpTargetCelestial.position[0] - sourceCelestial.position[0]) * t,
        sourceCelestial.position[1] + (warpTargetCelestial.position[1] - sourceCelestial.position[1]) * t,
        sourceCelestial.position[2] + (warpTargetCelestial.position[2] - sourceCelestial.position[2]) * t,
      ]
    } else if (sourceCelestial) {
      renderShipWorld = sourceCelestial.position
    }
    renderShipWorld = [
      renderShipWorld[0] + liveState.ship.position[0],
      renderShipWorld[1] + liveState.ship.position[1],
      renderShipWorld[2] + liveState.ship.position[2],
    ]

    // Keep apparent-size/culling distances in the same frame as EW map destination pips.
    let distanceShipWorld: [number, number, number] = currentCelestial?.position ?? [0, 0, 0]
    if (liveState.warpState === 'aligning') {
      if (sourceCelestial) {
        distanceShipWorld = sourceCelestial.position
      }
    } else if (WARPING_STATES.has(liveState.warpState)) {
      if (
        sourceCelestial &&
        warpTargetCelestial &&
        sourceCelestial.id !== warpTargetCelestial.id
      ) {
        const t = THREE.MathUtils.clamp(liveState.warpTravelProgress, 0, 1)
        distanceShipWorld = [
          sourceCelestial.position[0] + (warpTargetCelestial.position[0] - sourceCelestial.position[0]) * t,
          sourceCelestial.position[1] + (warpTargetCelestial.position[1] - sourceCelestial.position[1]) * t,
          sourceCelestial.position[2] + (warpTargetCelestial.position[2] - sourceCelestial.position[2]) * t,
        ]
      } else if (warpTargetCelestial) {
        distanceShipWorld = warpTargetCelestial.position
      }
    }

    camera.getWorldPosition(camPos)
    const scaleLerp = THREE.MathUtils.clamp(dt * SCALE_SMOOTH_SPEED, 0, 1)
    const visibleNow = new Set<string>()

    for (const body of distantBodies) {
      const mesh = bodyRefs.current[body.id]
      if (!mesh) continue

      const celestial = getCelestialById(body.id, liveState.starSystem)
      if (!celestial) {
        mesh.visible = false
        continue
      }

      direction.set(
        celestial.position[0] - renderShipWorld[0],
        celestial.position[1] - renderShipWorld[1],
        celestial.position[2] - renderShipWorld[2]
      )
      const isCurrentCelestial = body.id === liveState.currentCelestialId
      if (isCurrentCelestial && body.type === 'planet' && liveState.warpState === 'idle') {
        // Keep the host planet out of the ship/grid center by pinning it to a stable
        // anti-stellar world direction instead of tiny local-offset direction noise.
        const starCelestial = getCelestialById('star', liveState.starSystem)
        if (starCelestial) {
          direction.set(
            celestial.position[0] - starCelestial.position[0],
            celestial.position[1] - starCelestial.position[1],
            celestial.position[2] - starCelestial.position[2]
          )
        }
      }
      const directionDistance = direction.length()
      if (directionDistance < 0.001) {
        direction.copy(DEFAULT_BODY_DIRECTION)
      }
      const distanceForScale = Math.hypot(
        celestial.position[0] - distanceShipWorld[0],
        celestial.position[1] - distanceShipWorld[1],
        celestial.position[2] - distanceShipWorld[2]
      )

      const visibilityDistance = isCurrentCelestial ? 0 : distanceForScale
      if (directionDistance < 0.001 || visibilityDistance > VISIBILITY_DISTANCE_WORLD) {
        mesh.visible = false
        continue
      }
      visibleNow.add(body.id)

      direction.normalize()
      mesh.visible = true
      const anchorDistance =
        isCurrentCelestial && body.type === 'planet'
          ? DISTANT_BODY_ANCHOR_DISTANCE + DISTANT_BODY_MAX_SCALE + CURRENT_PLANET_ANCHOR_CLEARANCE
          : DISTANT_BODY_ANCHOR_DISTANCE
      mesh.position.copy(camPos).addScaledVector(direction, anchorDistance)

      const projectedDiameterAtAnchor =
        (body.radius * 2 * anchorDistance) / Math.max(distanceForScale, 1)
      let targetScale = projectedDiameterAtAnchor * DISTANT_BODY_APPARENT_SIZE_TUNING
      if (isCurrentCelestial && body.type === 'planet' && liveState.warpState === 'idle') {
        // On the active planet grid, always render the host planet at max visual size.
        targetScale = DISTANT_BODY_MAX_SCALE
      }
      const maxAllowedScale =
        isCurrentCelestial && body.type === 'planet'
          ? DISTANT_BODY_MAX_SCALE
          : DISTANT_BODY_PRELANDING_MAX_SCALE
      targetScale = THREE.MathUtils.clamp(
        targetScale,
        DISTANT_BODY_MIN_SCALE,
        maxAllowedScale
      )
      const currentScale = bodyScaleRef.current[body.id] ?? targetScale
      const nextScale = THREE.MathUtils.lerp(currentScale, targetScale, scaleLerp)
      bodyScaleRef.current[body.id] = nextScale
      mesh.scale.set(nextScale, nextScale, nextScale)

      const material = mesh.material as THREE.MeshStandardMaterial
      material.opacity = 1
      material.color.set(material.map ? PLANET_TEXTURE_TINT : bodyColor())
      material.emissive.set(0x000000)
      material.emissiveIntensity = 0
    }

    for (const body of distantBodies) {
      if (!visibleNow.has(body.id) && bodyRefs.current[body.id]) {
        bodyRefs.current[body.id]!.visible = false
      }
    }
  })

  return (
    <group userData={{ ignoreSunOcclusion: true }}>
      {distantBodies.map((body) => {
        // Planets get a stable randomly assigned texture.
        // Cloud textures are filtered out at load time for future dedicated cloud layers.
        const planetTexture = planetTextureByBodyId[body.id]
        const hasPlanetTexture = !!planetTexture
        return (
          <mesh
            key={body.id}
            ref={(value) => {
              bodyRefs.current[body.id] = value
              if (value) {
                value.layers.set(2)
                value.layers.enable(1)
                value.visible = false
                value.userData.ignoreSunOcclusion = true
              }
            }}
            geometry={distantBodyGeometry}
            renderOrder={6}
            scale={[DISTANT_BODY_MIN_SCALE, DISTANT_BODY_MIN_SCALE, DISTANT_BODY_MIN_SCALE]}
            userData={{ ignoreSunOcclusion: true }}
          >
            <meshStandardMaterial
              map={hasPlanetTexture ? planetTexture : null}
              color={hasPlanetTexture ? PLANET_TEXTURE_TINT : bodyColor()}
              transparent={false}
              opacity={1}
              depthWrite
              depthTest
              metalness={0.02}
              roughness={0.98}
            />
          </mesh>
        )
      })}
    </group>
  )
}
