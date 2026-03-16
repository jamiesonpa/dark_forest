import type { ShipsSnapshotMessage, WireShipSnapshot } from '../../shared/contracts/multiplayer'

type ColyseusShip = {
  id: string
  name: string
  currentCelestialId: string
  inWarpTransit: boolean
  x: number
  y: number
  z: number
  targetSpeed: number
  mwdActive: boolean
  mwdRemaining: number
  mwdCooldownRemaining: number
  dampenersActive: boolean
  bearing: number
  inclination: number
  actualHeading: number
  actualSpeed: number
  actualInclination: number
  rollAngle: number
  shield: number
  shieldMax: number
  armor: number
  armorMax: number
  hull: number
  hullMax: number
  capacitor: number
  capacitorMax: number
}

export type ColyseusRoomState = {
  ships?: Map<string, ColyseusShip> & {
    forEach: (callback: (value: ColyseusShip, key: string) => void) => void
  }
}

export function toWireShipSnapshot(ship: ColyseusShip): WireShipSnapshot {
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

export function toShipsSnapshot(state: ColyseusRoomState | undefined | null): ShipsSnapshotMessage {
  const next: ShipsSnapshotMessage = {}
  if (!state?.ships) return next

  state.ships.forEach((ship, key) => {
    next[key] = toWireShipSnapshot(ship)
  })

  return next
}
