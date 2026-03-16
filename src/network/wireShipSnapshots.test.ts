import { describe, expect, it } from 'vitest'
import { toShipsSnapshot } from '@/network/wireShipSnapshots'

describe('wireShipSnapshots', () => {
  it('maps Colyseus room state into wire ship snapshots', () => {
    const snapshot = toShipsSnapshot({
      ships: new Map([
        [
          'local',
          {
            id: 'local',
            name: 'Raven',
            currentCelestialId: 'planet-1',
            x: 1,
            y: 2,
            z: 3,
            targetSpeed: 40,
            mwdActive: false,
            mwdRemaining: 0,
            mwdCooldownRemaining: 0,
            dampenersActive: true,
            bearing: 90,
            inclination: 5,
            actualHeading: 89,
            actualSpeed: 38,
            actualInclination: 4,
            rollAngle: 3,
            shield: 10,
            shieldMax: 20,
            armor: 30,
            armorMax: 40,
            hull: 50,
            hullMax: 60,
            capacitor: 70,
            capacitorMax: 80,
          },
        ],
      ]) as never,
    })

    expect(snapshot.local).toEqual(
      expect.objectContaining({
        id: 'local',
        position: [1, 2, 3],
        actualSpeed: 38,
        capacitorMax: 80,
      })
    )
  })
})
