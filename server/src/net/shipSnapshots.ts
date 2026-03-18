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

function toFiniteVector3(input: unknown): [number, number, number] | null {
  if (!Array.isArray(input) || input.length < 3) return null
  const x = input[0]
  const y = input[1]
  const z = input[2]
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null
  }
  return [x, y, z]
}

function velocityFromAttitude(
  headingDeg: number,
  inclinationDeg: number,
  speed: number
): [number, number, number] {
  const headingRad = (headingDeg * Math.PI) / 180
  const inclinationRad = (inclinationDeg * Math.PI) / 180
  const cosInclination = Math.cos(inclinationRad)
  return [
    -Math.sin(headingRad) * cosInclination * speed,
    Math.sin(inclinationRad) * speed,
    Math.cos(headingRad) * cosInclination * speed,
  ]
}

export function toWireShipSnapshot(ship: ShipState): WireShipSnapshot {
  const revealedCelestialIds = Array.from(ship.revealedCelestialIds).filter(
    (id): id is string => typeof id === 'string' && id.length > 0
  )
  return {
    id: ship.id,
    name: ship.name,
    currentCelestialId: ship.currentCelestialId,
    revealedCelestialIds,
    inWarpTransit: ship.inWarpTransit,
    position: [ship.x, ship.y, ship.z],
    targetSpeed: ship.targetSpeed,
    mwdActive: ship.mwdActive,
    mwdRemaining: ship.mwdRemaining,
    mwdCooldownRemaining: ship.mwdCooldownRemaining,
    dampenersActive: ship.dampenersActive,
    shieldsUp: ship.shieldsUp,
    shieldOnlineLevel: ship.shieldOnlineLevel,
    shieldRechargeRatePct: ship.shieldRechargeRatePct,
    bearing: ship.bearing,
    inclination: ship.inclination,
    actualVelocity: [ship.vx, ship.vy, ship.vz],
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
  if (Array.isArray(message.revealedCelestialIds)) {
    const nextRevealed = message.revealedCelestialIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )
    ship.revealedCelestialIds.splice(0, ship.revealedCelestialIds.length, ...nextRevealed)
  }
  if (typeof message.inWarpTransit === 'boolean') ship.inWarpTransit = message.inWarpTransit
  if (typeof message.targetSpeed === 'number') ship.targetSpeed = message.targetSpeed
  if (typeof message.mwdActive === 'boolean') ship.mwdActive = message.mwdActive
  if (typeof message.mwdRemaining === 'number') ship.mwdRemaining = message.mwdRemaining
  if (typeof message.mwdCooldownRemaining === 'number') {
    ship.mwdCooldownRemaining = message.mwdCooldownRemaining
  }
  if (typeof message.dampenersActive === 'boolean') ship.dampenersActive = message.dampenersActive
  if (typeof message.shieldsUp === 'boolean') ship.shieldsUp = message.shieldsUp
  if (typeof message.shieldOnlineLevel === 'number') ship.shieldOnlineLevel = Math.max(0, message.shieldOnlineLevel)
  if (typeof message.shieldRechargeRatePct === 'number') {
    ship.shieldRechargeRatePct = Math.max(0, Math.min(100, message.shieldRechargeRatePct))
  }
  if (typeof message.shield === 'number') ship.shield = Math.max(0, message.shield)
  if (typeof message.armor === 'number') ship.armor = Math.max(0, message.armor)
  if (typeof message.hull === 'number') ship.hull = Math.max(0, message.hull)
  if (typeof message.bearing === 'number') ship.bearing = message.bearing
  if (typeof message.inclination === 'number') ship.inclination = message.inclination
  const actualVelocity = toFiniteVector3(message.actualVelocity)
  if (actualVelocity) {
    ship.vx = actualVelocity[0]
    ship.vy = actualVelocity[1]
    ship.vz = actualVelocity[2]
  }
  if (typeof message.actualHeading === 'number') ship.actualHeading = message.actualHeading
  if (typeof message.actualSpeed === 'number') ship.actualSpeed = message.actualSpeed
  if (typeof message.actualInclination === 'number') ship.actualInclination = message.actualInclination
  if (typeof message.rollAngle === 'number') ship.rollAngle = message.rollAngle
  if (!actualVelocity) {
    const derivedVelocity = velocityFromAttitude(
      ship.actualHeading,
      ship.actualInclination,
      ship.actualSpeed
    )
    ship.vx = derivedVelocity[0]
    ship.vy = derivedVelocity[1]
    ship.vz = derivedVelocity[2]
  }
}

export function applyWarpMessage(ship: ShipState, message: WarpMessage) {
  ship.currentCelestialId = message.celestialId
  if (!ship.revealedCelestialIds.includes(message.celestialId)) {
    ship.revealedCelestialIds.push(message.celestialId)
  }
}
