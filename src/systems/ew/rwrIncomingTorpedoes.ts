import { bearingInclinationFromVector } from '@/systems/warp/navigationMath'
import type { GameStore, LaunchedCylinder } from '@/state/types'

const OFFLINE_LOCAL_PLAYER_ID = 'local-player'

function incomingEnemyTorpedoCylinders(
  s: Pick<
    GameStore,
    | 'launchedCylinders'
    | 'remoteLaunchedCylinders'
    | 'localPlayerId'
    | 'shipsById'
    | 'ship'
    | 'currentCelestialId'
  >
): LaunchedCylinder[] {
  const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
  const all = [...s.launchedCylinders, ...s.remoteLaunchedCylinders]
  return all.filter((c) => {
    if (c.currentCelestialId !== s.currentCelestialId) return false
    if (c.targetLockId !== localId) return false
    if (!c.launchedByShipId || c.launchedByShipId === localId) return false
    return true
  })
}

export function hasIncomingEnemyTorpedoesForLocalPlayer(
  s: Pick<
    GameStore,
    | 'launchedCylinders'
    | 'remoteLaunchedCylinders'
    | 'localPlayerId'
    | 'shipsById'
    | 'ship'
    | 'currentCelestialId'
  >
): boolean {
  return incomingEnemyTorpedoCylinders(s).length > 0
}

/** Clock bearing (deg) from local ship to each enemy torpedo homing on you — for RWR "T" symbols. */
export function getIncomingEnemyTorpedoRwrMarkers(
  s: Pick<
    GameStore,
    | 'launchedCylinders'
    | 'remoteLaunchedCylinders'
    | 'localPlayerId'
    | 'shipsById'
    | 'ship'
    | 'currentCelestialId'
  >
): { id: string; bearingDeg: number }[] {
  const localId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
  const localShip = s.shipsById[localId] ?? s.ship
  const cylinders = incomingEnemyTorpedoCylinders(s)
  const markers: { id: string; bearingDeg: number }[] = []
  for (const c of cylinders) {
    const dx = c.position[0] - localShip.position[0]
    const dy = c.position[1] - localShip.position[1]
    const dz = c.position[2] - localShip.position[2]
    const { bearing } = bearingInclinationFromVector([dx, dy, dz])
    markers.push({ id: c.id, bearingDeg: bearing })
  }
  return markers
}
