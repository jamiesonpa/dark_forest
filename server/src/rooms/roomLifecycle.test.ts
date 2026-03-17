import { describe, expect, it } from 'vitest'
import { generateStarSystemSnapshot } from '../systems/starSystemGenerator.js'
import { createShipForJoin } from './roomLifecycle.js'
import { computeSpawnAnchorIds } from '../simulation/spawnPolicy.js'

describe('roomLifecycle', () => {
  it('creates join-time ships with the expected identity and spawn location', () => {
    const snapshot = generateStarSystemSnapshot({
      seed: 777,
      planetCount: 2,
      asteroidBeltCount: 1,
      minOrbitAu: 60,
      maxOrbitAu: 220,
      minSeparationAu: 35,
    })
    const anchorIds = computeSpawnAnchorIds(snapshot)

    const ship = createShipForJoin('session-1', 0, snapshot, anchorIds, 20)

    expect(ship.id).toBe('session-1')
    expect(ship.name).toBe('Raven')
    expect(ship.currentCelestialId).toBe(anchorIds[0])
    expect([ship.x, ship.y, ship.z]).not.toEqual([0, 0, 0])
  })
})
