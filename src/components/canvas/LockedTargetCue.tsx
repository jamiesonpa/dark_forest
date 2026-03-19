import { Html } from '@react-three/drei'
import { useMemo } from 'react'
import { useGameStore } from '@/state/gameStore'
import { useIRSTStore } from '@/state/irstStore'

export function LockedTargetCue() {
  const lockState = useGameStore((s) => s.ewLockState)
  const shipsById = useGameStore((s) => s.shipsById)
  const pointTrackEnabled = useIRSTStore((s) => s.pointTrackEnabled)
  const pointTrackTargetId = useIRSTStore((s) => s.pointTrackTargetId)

  const hardLockId = useMemo(
    () => Object.keys(lockState).find((id) => lockState[id] === 'hard') ?? null,
    [lockState]
  )

  const cues = useMemo(
    (): Array<{
      key: string
      position: [number, number, number]
      shapeClassName: 'pilot-target-cue-world-ring' | 'pilot-target-cue-world-diamond'
    }> => {
      const nextCues: Array<{
        key: string
        position: [number, number, number]
        shapeClassName: 'pilot-target-cue-world-ring' | 'pilot-target-cue-world-diamond'
      }> = []

      if (hardLockId) {
        const lockedShip = shipsById[hardLockId]
        if (lockedShip) {
          nextCues.push({
            key: `radar-${hardLockId}`,
            position: [lockedShip.position[0], lockedShip.position[1], lockedShip.position[2]],
            shapeClassName: 'pilot-target-cue-world-ring',
          })
        }
      }

      if (pointTrackEnabled && pointTrackTargetId && pointTrackTargetId !== hardLockId) {
        const trackedShip = shipsById[pointTrackTargetId]
        if (trackedShip) {
          nextCues.push({
            key: `pt-${pointTrackTargetId}`,
            position: [trackedShip.position[0], trackedShip.position[1], trackedShip.position[2]],
            shapeClassName: 'pilot-target-cue-world-diamond',
          })
        }
      }

      return nextCues
    },
    [hardLockId, pointTrackEnabled, pointTrackTargetId, shipsById]
  )

  if (cues.length === 0) return null

  return (
    <>
      {cues.map((cue) => (
        <group key={cue.key} position={cue.position}>
          <Html center transform={false} zIndexRange={[12000, 0]} style={{ pointerEvents: 'none' }}>
            <div className="pilot-target-cue-world" aria-hidden="true">
              <span className={cue.shapeClassName} />
            </div>
          </Html>
        </group>
      ))}
    </>
  )
}

