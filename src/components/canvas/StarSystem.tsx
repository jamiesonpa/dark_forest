import { Skybox } from './Skybox'
import { Grid } from './Grid'
import { OrbitCameraController } from './OrbitCameraController'
import { IRSTCamera } from './IRSTCamera'
import { IRSTCameraDebugCone } from './IRSTCameraDebugCone'
import { SunSystem } from './SunSystem'
import { PlanetMoonSystem } from './PlanetMoonSystem'
import { WarpTargetMarkers } from './WarpTargetMarkers'
import { LockedTargetCue } from './LockedTargetCue'
import { useGameStore } from '@/state/gameStore'
import { WarpDriver } from '@/systems/warp/WarpDriver'

export function StarSystem() {
  const localShipInWarpTransit = useGameStore((s) => s.ship.inWarpTransit)
  const offGridWarpActive = localShipInWarpTransit

  return (
    <>
      <Skybox />
      <ambientLight intensity={0.08} />
      <SunSystem />
      <PlanetMoonSystem />
      <WarpDriver />
      {!offGridWarpActive && <WarpTargetMarkers />}
      <LockedTargetCue />
      <Grid />
      <IRSTCamera />
      <IRSTCameraDebugCone />
      <OrbitCameraController />
    </>
  )
}
