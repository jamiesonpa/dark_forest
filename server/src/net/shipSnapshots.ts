import type {
  MoveMessage,
  ShipsSnapshotMessage,
  WarpMessage,
  WireShipSnapshot,
} from '../../../shared/contracts/multiplayer.js'
import type { ShipState } from '../schema/GameState.js'

type ShipCollection = {
  forEach: (callback: (ship: ShipState, sessionId: string) => void) => void
}

export function toWireShipSnapshot(ship: ShipState): WireShipSnapshot {
  return {
    id: ship.id,
    name: ship.name,
    currentCelestialId: ship.currentCelestialId,
    inWarpTransit: ship.inWarpTransit,
    position: [ship.x, ship.y, ship.z],
    targetSpeed: ship.targetSpeed,
    mwdActive: ship.mwdActive,
    mwdRemaining: ship.mwdRemaining,
    mwdCooldownRemaining: ship.mwdCooldownRemaining,
    dampenersActive: ship.dampenersActive,
    bearing: ship.bearing,
    inclination: ship.inclination,
    actualHeading: ship.actualHeading,
    actualSpeed: ship.actualSpeed,
    actualInclination: ship.actualInclination,
    rollAngle: ship.rollAngle,
    shield: ship.shield,
    shieldMax: ship.shieldMax,
    armor: ship.armor,
    armorMax: ship.armorMax,
    hull: ship.hull,
    hullMax: ship.hullMax,
    capacitor: ship.capacitor,
    capacitorMax: ship.capacitorMax,
  }
}

export function buildShipsSnapshot(ships: ShipCollection): ShipsSnapshotMessage {
  const snapshot: ShipsSnapshotMessage = {}
  ships.forEach((ship, sessionId) => {
    snapshot[sessionId] = toWireShipSnapshot(ship)
  })
  return snapshot
}

export function applyMoveMessage(ship: ShipState, message: MoveMessage) {
  ship.x = message.x
  ship.y = message.y
  ship.z = message.z
  if (typeof message.inWarpTransit === 'boolean') ship.inWarpTransit = message.inWarpTransit
  if (typeof message.targetSpeed === 'number') ship.targetSpeed = message.targetSpeed
  if (typeof message.mwdActive === 'boolean') ship.mwdActive = message.mwdActive
  if (typeof message.mwdRemaining === 'number') ship.mwdRemaining = message.mwdRemaining
  if (typeof message.mwdCooldownRemaining === 'number') {
    ship.mwdCooldownRemaining = message.mwdCooldownRemaining
  }
  if (typeof message.dampenersActive === 'boolean') ship.dampenersActive = message.dampenersActive
  if (typeof message.bearing === 'number') ship.bearing = message.bearing
  if (typeof message.inclination === 'number') ship.inclination = message.inclination
  if (typeof message.actualHeading === 'number') ship.actualHeading = message.actualHeading
  if (typeof message.actualSpeed === 'number') ship.actualSpeed = message.actualSpeed
  if (typeof message.actualInclination === 'number') ship.actualInclination = message.actualInclination
  if (typeof message.rollAngle === 'number') ship.rollAngle = message.rollAngle
}

export function applyWarpMessage(ship: ShipState, message: WarpMessage) {
  ship.currentCelestialId = message.celestialId
}
