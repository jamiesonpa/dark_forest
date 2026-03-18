import { useMemo } from 'react'
import { useGameStore } from '@/state/gameStore'

export function LaunchControl() {
  const ewLockState = useGameStore((s) => s.ewLockState)
  const playerShipBoundingLength = useGameStore((s) => s.playerShipBoundingLength)
  const launchLockedCylinder = useGameStore((s) => s.launchLockedCylinder)
  const launchFlares = useGameStore((s) => s.launchFlares)

  const hasRadarLock = useMemo(
    () => Object.values(ewLockState).some((state) => state === 'hard' || state === 'soft'),
    [ewLockState]
  )

  const launchDisabled = !hasRadarLock

  return (
    <div className="hud-launch-left">
      <button
        type="button"
        className={`hud-launch-button ${launchDisabled ? 'is-disabled' : ''}`.trim()}
        onClick={() => launchLockedCylinder(playerShipBoundingLength)}
        disabled={launchDisabled}
      >
        LAUNCH
      </button>
      <button
        type="button"
        className="hud-launch-button"
        onClick={() => launchFlares(playerShipBoundingLength)}
      >
        FLARE
      </button>
    </div>
  )
}
