import { useMemo } from 'react'
import { Skybox } from './Skybox'
import { Grid } from './Grid'
import { OrbitCameraController } from './OrbitCameraController'
import { CelestialBody } from './CelestialBody'
import { WarpEffect } from './WarpEffect'
import { IRSTCamera } from './IRSTCamera'
import { IRSTCameraDebugCone } from './IRSTCameraDebugCone'
import { SunSystem } from './SunSystem'
import { WarpTargetMarkers } from './WarpTargetMarkers'
import { useGameStore } from '@/state/gameStore'
import { STAR_SYSTEM, getCelestialById } from '@/utils/systemData'

export function StarSystem() {
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const warpState = useGameStore((s) => s.warpState)
  const currentCelestial = useMemo(
    () => getCelestialById(currentCelestialId),
    [currentCelestialId]
  )

  const distantCelestials = useMemo(() => {
    if (!currentCelestial) return []
    const [cx, cy, cz] = currentCelestial.position
    return STAR_SYSTEM.celestials
      .filter((c) => c.id !== currentCelestialId)
      .map((c) => ({
        ...c,
        position: [
          c.position[0] - cx,
          c.position[1] - cy,
          c.position[2] - cz,
        ] as [number, number, number],
      }))
  }, [currentCelestial, currentCelestialId])

  return (
    <>
      <Skybox />
      <ambientLight intensity={0.08} />
      <SunSystem />
      <WarpTargetMarkers />
      {distantCelestials.map((c) => (
        <CelestialBody key={c.id} celestial={c} isDistant />
      ))}
      <Grid />
      {warpState === 'warping' && <WarpEffect />}
      <IRSTCamera />
      <IRSTCameraDebugCone />
      <OrbitCameraController />
    </>
  )
}
