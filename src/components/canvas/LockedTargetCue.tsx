import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { useGameStore } from '@/state/gameStore'

export function LockedTargetCue() {
  const lockState = useGameStore((s) => s.ewLockState)
  const shipsById = useGameStore((s) => s.shipsById)

  const hardLockId = useMemo(
    () => Object.keys(lockState).find((id) => lockState[id] === 'hard') ?? null,
    [lockState]
  )

  const cuePosition = useMemo<[number, number, number] | null>(() => {
    if (!hardLockId) return null
    const lockedShip = shipsById[hardLockId]
    if (!lockedShip) return null
    return [lockedShip.position[0], lockedShip.position[1], lockedShip.position[2]]
  }, [hardLockId, shipsById])

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

