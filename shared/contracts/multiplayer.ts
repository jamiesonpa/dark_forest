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

export type ShipsSnapshotMessage = Record<string, WireShipSnapshot>

export interface MoveMessage {
  x: number
  y: number
  z: number
  revealedCelestialIds?: string[]
  inWarpTransit?: boolean
  targetSpeed?: number
  mwdActive?: boolean
  mwdRemaining?: number
  mwdCooldownRemaining?: number
  dampenersActive?: boolean
  bearing?: number
  inclination?: number
  actualHeading?: number
  actualSpeed?: number
  actualInclination?: number
  rollAngle?: number
}

export interface ShipMoveUpdate {
  position: [number, number, number]
  revealedCelestialIds: string[]
  inWarpTransit: boolean
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
