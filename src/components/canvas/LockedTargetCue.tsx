import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { useGameStore } from '@/state/gameStore'
import { getCelestialById } from '@/utils/systemData'
import {
  getWorldShipPosition,
  vectorBetweenWorldPoints,
  vectorMagnitude,
  worldPositionForCelestial,
} from '@/systems/warp/navigationMath'

export function LockedTargetCue() {
  const lockState = useGameStore((s) => s.ewLockState)
  const enemy = useGameStore((s) => s.enemy)
  const ship = useGameStore((s) => s.ship)
  const starSystem = useGameStore((s) => s.starSystem)
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const debugEwPlanet1TargetEnabled = useGameStore((s) => s.debugEwPlanet1TargetEnabled)

  const hardLockId = useMemo(
    () => Object.keys(lockState).find((id) => lockState[id] === 'hard') ?? null,
    [lockState]
  )

  const cuePosition = useMemo<[number, number, number] | null>(() => {
    if (!hardLockId) return null

    if (hardLockId === 'Σ' || hardLockId === 'M') {
      const toEnemy: [number, number, number] = [
        enemy.position[0] - ship.position[0],
        enemy.position[1] - ship.position[1],
        enemy.position[2] - ship.position[2],
      ]
      if (hardLockId === 'M') {
        const dist = vectorMagnitude(toEnemy)
        if (dist > 0.001) {
          const missileDist = Math.max(0, dist - 2000)
          const scale = missileDist / dist
          toEnemy[0] *= scale
          toEnemy[1] *= scale
          toEnemy[2] *= scale
        }
      }
      return [
        ship.position[0] + toEnemy[0],
        ship.position[1] + toEnemy[1],
        ship.position[2] + toEnemy[2],
      ]
    }

    if (hardLockId === 'P1' && debugEwPlanet1TargetEnabled) {
      const currentCelestial = getCelestialById(currentCelestialId, starSystem)
      const planetOne = getCelestialById('planet-1', starSystem)
      if (!currentCelestial || !planetOne) return null
      const shipWorld = getWorldShipPosition(ship.position, worldPositionForCelestial(currentCelestial))
      const planetOneWorld = worldPositionForCelestial(planetOne)
      const targetWorld: [number, number, number] = [planetOneWorld[0] + 100000, planetOneWorld[1], planetOneWorld[2]]
      const toTarget = vectorBetweenWorldPoints(shipWorld, targetWorld)
      return [
        ship.position[0] + toTarget[0],
        ship.position[1] + toTarget[1],
        ship.position[2] + toTarget[2],
      ]
    }

    return null
  }, [currentCelestialId, debugEwPlanet1TargetEnabled, enemy.position, hardLockId, ship.position, starSystem])

  if (!cuePosition) return null

  return (
    <group position={cuePosition}>
      <Html center transform={false} zIndexRange={[12000, 0]} style={{ pointerEvents: 'none' }}>
        <div className="pilot-target-cue-world" aria-hidden="true">
          <span className="pilot-target-cue-world-ring" />
        </div>
      </Html>
    </group>
  )
}

