
import { describe, expect, it } from 'vitest'
import { ShipState } from '../schema/GameState.js'
import { generateStarSystemSnapshot } from '../systems/starSystemGenerator.js'
import { computeSpawnAnchorIds, respawnShipsByAnchorOrder } from './spawnPolicy.js'

describe('spawnPolicy', () => {
  it('chooses valid warpable anchors for the active star system', () => {
    const snapshot = generateStarSystemSnapshot({
      seed: 99,
      planetCount: 3,
      moonCount: 1,
      asteroidBeltCount: 1,
      minOrbitAu: 60,
      maxOrbitAu: 200,
      minSeparationAu: 30,
    })

    const anchors = computeSpawnAnchorIds(snapshot)
    const warpableIds = new Set(snapshot.system.celestials.filter((c) => c.type !== 'star').map((c) => c.id))

    expect(warpableIds.has(anchors[0]) || anchors[0] === 'star').toBe(true)
    expect(warpableIds.has(anchors[1]) || anchors[1] === 'star').toBe(true)
  })

  it('respawns ships in alternating anchor order after regeneration', () => {
    const snapshot = generateStarSystemSnapshot({
      seed: 101,
      planetCount: 4,
      moonCount: 0,
      asteroidBeltCount: 1,
      minOrbitAu: 50,
      maxOrbitAu: 180,
      minSeparationAu: 25,
    })
    const anchors = computeSpawnAnchorIds(snapshot)

    const first = new ShipState()
    const second = new ShipState()
    const third = new ShipState()
    const ships = new Map([
      ['a', first],
      ['b', second],
      ['c', third],
    ])

    respawnShipsByAnchorOrder(ships, snapshot, anchors, 20)

    expect(first.currentCelestialId).toBe(anchors[0])
    expect(second.currentCelestialId).toBe(anchors[1])
    expect(third.currentCelestialId).toBe(anchors[0])
  })
})
