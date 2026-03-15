import { useMemo } from 'react'
import { PlayerShip } from './PlayerShip'
import { CelestialBody } from './CelestialBody'
import { AsteroidBelt } from './AsteroidBelt'
import { useGameStore } from '@/state/gameStore'
import { getCelestialById } from '@/utils/systemData'

const LOCAL_CELESTIAL_OFFSET: [number, number, number] = [0, 0, -2500]

export function Grid() {
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const starSystem = useGameStore((s) => s.starSystem)
  const shipsById = useGameStore((s) => s.shipsById)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const celestial = useMemo(
    () => getCelestialById(currentCelestialId, starSystem),
    [currentCelestialId, starSystem]
  )
  const ships = useMemo(
    () => Object.entries(shipsById),
    [shipsById]
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
      <AsteroidBelt />
      <group position={LOCAL_CELESTIAL_OFFSET}>
        <CelestialBody celestial={celestial} isDistant={false} />
      </group>
    </group>
  )
}
