export interface WireShipSnapshot {
  id: string
  name: string
  currentCelestialId: string
  revealedCelestialIds: string[]
  inWarpTransit: boolean
  position: [number, number, number]
  targetSpeed: number
  mwdActive: boolean
  mwdRemaining: number
  mwdCooldownRemaining: number
  dampenersActive: boolean
  shieldsUp: boolean
  shieldOnlineLevel: number
  shieldRechargeRatePct: number
  bearing: number
  inclination: number
  actualVelocity: [number, number, number]
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

export type ShipsSnapshotMessage = Record<string, WireShipSnapshot>

export interface WireLaunchedCylinder {
  id: string
  currentCelestialId: string
  position: [number, number, number]
  velocity: [number, number, number]
  radius: number
  length: number
  direction: [number, number, number]
  targetLockId: string | null
  flightTimeSeconds: number
}

export interface WireLaunchedFlare {
  id: string
  currentCelestialId: string
  position: [number, number, number]
  velocity: [number, number, number]
  flightTimeSeconds: number
}

export interface WireTorpedoExplosion {
  id: string
  currentCelestialId: string
  position: [number, number, number]
  flightTimeSeconds: number
  targetShipId?: string
}

export interface WireOrdnanceSnapshot {
  launchedCylinders: WireLaunchedCylinder[]
  launchedFlares: WireLaunchedFlare[]
  torpedoExplosions: WireTorpedoExplosion[]
}

export type OrdnanceSnapshotMessage = Record<string, WireOrdnanceSnapshot>

export interface MoveMessage {
  x: number
  y: number
  z: number
  revealedCelestialIds?: string[]
  launchedCylinders?: WireLaunchedCylinder[]
  launchedFlares?: WireLaunchedFlare[]
  torpedoExplosions?: WireTorpedoExplosion[]
  inWarpTransit?: boolean
  targetSpeed?: number
  mwdActive?: boolean
  mwdRemaining?: number
  mwdCooldownRemaining?: number
  dampenersActive?: boolean
  shieldsUp?: boolean
  shieldOnlineLevel?: number
  shieldRechargeRatePct?: number
  shield?: number
  armor?: number
  hull?: number
  bearing?: number
  inclination?: number
  actualVelocity?: [number, number, number]
  actualHeading?: number
  actualSpeed?: number
  actualInclination?: number
  rollAngle?: number
}

export interface ShipMoveUpdate {
  position: [number, number, number]
  revealedCelestialIds: string[]
  launchedCylinders: WireLaunchedCylinder[]
  launchedFlares: WireLaunchedFlare[]
  torpedoExplosions: WireTorpedoExplosion[]
  inWarpTransit: boolean
  targetSpeed: number
  mwdActive: boolean
  mwdRemaining: number
  mwdCooldownRemaining: number
  dampenersActive: boolean
  shieldsUp: boolean
  shieldOnlineLevel: number
  shieldRechargeRatePct: number
  shield: number
  armor: number
  hull: number
  bearing: number
  inclination: number
  actualVelocity: [number, number, number]
  actualHeading: number
  actualSpeed: number
  actualInclination: number
  rollAngle: number
}

export interface ShipDamageMessage {
  targetShipId: string
  damage: number
  currentCelestialId?: string
}

export interface WarpMessage {
  celestialId: string
}

export interface WarpIntentPayload extends WarpMessage {
  requiredBearing: number
  requiredInclination: number
  alignmentErrorDeg: number
  clientStartedAt: number
}
