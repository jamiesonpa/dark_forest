import { ShipState } from '../schema/GameState.js'
import { getSpawnForPlayer, type SpawnAnchorIds } from '../simulation/spawnPolicy.js'
import type { StarSystemSnapshot } from '../types/starSystem.js'

export function createShipForJoin(
  sessionId: string,
  playerIndex: number,
  snapshot: StarSystemSnapshot,
  anchorIds: SpawnAnchorIds,
  maxClients: number
) {
  const ship = new ShipState()
  const spawn = getSpawnForPlayer(snapshot, anchorIds, playerIndex, maxClients)

  ship.id = sessionId
  ship.name = 'Raven'
  ship.currentCelestialId = spawn.celestialId
  ship.x = spawn.localPosition[0]
  ship.y = spawn.localPosition[1]
  ship.z = spawn.localPosition[2]

  return ship
}
