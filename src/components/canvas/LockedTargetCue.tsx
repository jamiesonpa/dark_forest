import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { useGameStore } from '@/state/gameStore'
import {
  vectorMagnitude,
} from '@/systems/warp/navigationMath'

export function LockedTargetCue() {
  const lockState = useGameStore((s) => s.ewLockState)
  const enemy = useGameStore((s) => s.enemy)
  const ship = useGameStore((s) => s.ship)
  const shipTargets = useGameStore((s) => s.shipTargets)

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

    if (hardLockId.startsWith('TGT-')) {
      const targetId = hardLockId.slice(4)
      const lockedTarget = shipTargets.find((target) => target.id === targetId)
      if (!lockedTarget) return null
      return [
        lockedTarget.position[0],
        lockedTarget.position[1],
        lockedTarget.position[2],
      ]
    }

    return null
  }, [enemy.position, hardLockId, ship.position, shipTargets])

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

