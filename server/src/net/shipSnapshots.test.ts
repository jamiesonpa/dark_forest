import { describe, expect, it } from 'vitest'
import { ShipState } from '../schema/GameState.js'
import { applyMoveMessage, applyWarpMessage, buildShipsSnapshot } from './shipSnapshots.js'

describe('shipSnapshots', () => {
  it('builds stable wire snapshots from room ships', () => {
    const ship = new ShipState()
    ship.id = 'alpha'
    ship.name = 'Raven'
    ship.currentCelestialId = 'planet-1'
    ship.revealedCelestialIds.push('planet-1')
    ship.x = 10
    ship.y = 20
    ship.z = 30
    ship.vx = 2
    ship.vy = 3
    ship.vz = 4
    ship.actualSpeed = 42

    const snapshot = buildShipsSnapshot(
      new Map([
        ['alpha', ship],
      ])
    )

    expect(snapshot.alpha).toEqual(
      expect.objectContaining({
        id: 'alpha',
        name: 'Raven',
        currentCelestialId: 'planet-1',
        revealedCelestialIds: ['planet-1'],
        position: [10, 20, 30],
        actualVelocity: [2, 3, 4],
        actualSpeed: 42,
      })
    )
  })

  it('applies move payload fields without changing unrelated stats', () => {
    const ship = new ShipState()
    ship.shield = 123
    ship.capacitor = 456

    applyMoveMessage(ship, {
      x: 7,
      y: 8,
      z: 9,
      revealedCelestialIds: ['planet-1', 'moon-2'],
      targetSpeed: 120,
      dampenersActive: false,
      actualVelocity: [11, 12, 13],
      actualHeading: 270,
      actualSpeed: 119,
    })

    expect(ship.x).toBe(7)
    expect(ship.y).toBe(8)
    expect(ship.z).toBe(9)
    expect(ship.targetSpeed).toBe(120)
    expect(Array.from(ship.revealedCelestialIds)).toEqual(['planet-1', 'moon-2'])
    expect(ship.dampenersActive).toBe(false)
    expect([ship.vx, ship.vy, ship.vz]).toEqual([11, 12, 13])
    expect(ship.actualHeading).toBe(270)
    expect(ship.actualSpeed).toBe(119)
    expect(ship.shield).toBe(123)
    expect(ship.capacitor).toBe(456)
  })

  it('applies warp payloads by changing only the active celestial', () => {
    const ship = new ShipState()
    ship.currentCelestialId = 'planet-1'
    ship.revealedCelestialIds.push('planet-1')
    ship.x = 11

    applyWarpMessage(ship, { celestialId: 'planet-2' })

    expect(ship.currentCelestialId).toBe('planet-2')
    expect(Array.from(ship.revealedCelestialIds)).toEqual(['planet-1', 'planet-2'])
    expect(ship.x).toBe(11)
  })
})
