import { useMemo } from 'react'
import { PlayerShip } from './PlayerShip'
import { CelestialBody } from './CelestialBody'
import { AsteroidBelt } from './AsteroidBelt'
import { CelestialGridContents } from './CelestialGridContents'
import { LaunchedCylinders } from './LaunchedCylinders'
import { LaunchedFlares } from './LaunchedFlares'
import { TorpedoExplosions } from './TorpedoExplosions'
import { useGameStore } from '@/state/gameStore'
import { getCelestialById } from '@/utils/systemData'

const LOCAL_CELESTIAL_OFFSET: [number, number, number] = [0, 0, -2500]

export function Grid() {
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const starSystem = useGameStore((s) => s.starSystem)
  const shipsById = useGameStore((s) => s.shipsById)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const localShipInWarpTransit = useGameStore((s) => s.ship.inWarpTransit)
  const showCelestialGridCenterMarker = useGameStore((s) => s.showCelestialGridCenterMarker)
  const offGridWarpActive = localShipInWarpTransit
  const celestial = useMemo(
    () => getCelestialById(currentCelestialId, starSystem),
    [currentCelestialId, starSystem]
  )
  const ships = useMemo(
    () =>
      Object.entries(shipsById).filter(([id, ship]) => {
        if (id === localPlayerId) return true
        return ship.currentCelestialId === currentCelestialId && !ship.inWarpTransit
      }),
    [currentCelestialId, localPlayerId, shipsById]
  )

  if (!celestial) return null

  return (
    <group position={[0, 0, 0]}>
      {ships.map(([id, ship]) => (
        <PlayerShip
          key={id}
          playerId={id}
          ship={ship}
          isLocal={id === localPlayerId}
        />
      ))}
      <LaunchedCylinders />
      <TorpedoExplosions />
      <LaunchedFlares />
      {!offGridWarpActive && (
        <>
          <AsteroidBelt />
          <CelestialGridContents celestial={celestial} />
          {showCelestialGridCenterMarker && (
            <mesh castShadow receiveShadow>
              <sphereGeometry args={[Math.max(160, celestial.gridRadius * 0.1), 24, 24]} />
              <meshStandardMaterial color={0xff2222} emissive={0x660000} roughness={0.35} />
            </mesh>
          )}
          <group position={LOCAL_CELESTIAL_OFFSET}>
            <CelestialBody celestial={celestial} isDistant={false} />
          </group>
        </>
      )}
    </group>
  )
}
