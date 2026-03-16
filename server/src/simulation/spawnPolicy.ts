import { getFarthestWarpablePair } from '../systems/starSystemGenerator.js'
import type { ShipState } from '../schema/GameState.js'
import type { StarSystemSnapshot } from '../types/starSystem.js'

const SPAWN_RING_RADIUS = 1200
const SPAWN_VERTICAL_JITTER = 150

export type SpawnAnchorIds = [string, string]

export function computeSpawnAnchorIds(snapshot: StarSystemSnapshot): SpawnAnchorIds {
  const farthestPair = getFarthestWarpablePair(snapshot.system)
  if (farthestPair) {
    return [farthestPair[0].id, farthestPair[1].id]
  }

  const warpables = snapshot.system.celestials.filter((c) => c.type !== 'star')
  if (warpables.length >= 2) {
    return [warpables[0].id, warpables[1].id]
  }

  return ['star', 'star']
}

export function getSpawnForPlayer(
  snapshot: StarSystemSnapshot,
  anchorIds: SpawnAnchorIds,
  playerIndex: number,
  maxClients: number
) {
  const fallbackAnchorId = snapshot.system.celestials.find((c) => c.type !== 'star')?.id ?? 'star'
  const anchorId = anchorIds[playerIndex % 2] ?? fallbackAnchorId
  const angle = (Math.PI * 2 * (playerIndex % Math.max(2, maxClients))) / Math.max(2, maxClients)

  return {
    celestialId: anchorId,
    localPosition: [
      Math.cos(angle) * SPAWN_RING_RADIUS,
      Math.sin(angle * 2) * SPAWN_VERTICAL_JITTER,
      Math.sin(angle) * SPAWN_RING_RADIUS,
    ] as [number, number, number],
  }
}

export function respawnShipsByAnchorOrder(
  ships: {
    forEach: (callback: (ship: ShipState, sessionId: string) => void) => void
  },
  snapshot: StarSystemSnapshot,
  anchorIds: SpawnAnchorIds,
  maxClients: number
) {
  let index = 0
  ships.forEach((ship) => {
    const spawn = getSpawnForPlayer(snapshot, anchorIds, index, maxClients)
    ship.currentCelestialId = spawn.celestialId
    ship.x = spawn.localPosition[0]
    ship.y = spawn.localPosition[1]
    ship.z = spawn.localPosition[2]
    index += 1
  })
}
