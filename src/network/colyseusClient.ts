import { Client, type Room } from 'colyseus.js'
import type { StarSystemGenerationConfig, StarSystemSnapshot } from '@/types/game'

export interface NetworkShipSnapshot {
  id: string
  name: string
  currentCelestialId: string
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

export interface WarpIntentPayload {
  celestialId: string
  requiredBearing: number
  requiredInclination: number
  alignmentErrorDeg: number
  clientStartedAt: number
}

export type MultiplayerStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

type Handlers = {
  onStatusChange?: (status: MultiplayerStatus, detail?: string) => void
  onJoined?: (sessionId: string) => void
  onShipsUpdate?: (shipsById: Record<string, NetworkShipSnapshot>) => void
  onStarSystemUpdate?: (snapshot: StarSystemSnapshot) => void
}

type ColyseusShip = {
  id: string
  name: string
  currentCelestialId: string
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

type ColyseusRoomState = {
  ships?: Map<string, ColyseusShip> & {
    forEach: (callback: (value: ColyseusShip, key: string) => void) => void
  }
}

type WireSnapshot = Record<string, NetworkShipSnapshot>

class ColyseusMultiplayerClient {
  private room: Room<ColyseusRoomState> | null = null
  private handlers: Handlers = {}
  private status: MultiplayerStatus = 'disconnected'
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private preferWireSnapshots = false

  setHandlers(handlers: Handlers) {
    this.handlers = handlers
  }

  isConnected() {
    return this.status === 'connected' && this.room !== null
  }

  getStatus() {
    return this.status
  }

  async connect(serverUrl: string) {
    this.disconnect()
    this.updateStatus('connecting')
    try {
      const client = new Client(serverUrl)
      const room = await client.joinOrCreate<ColyseusRoomState>('star_system')
      this.room = room
      this.preferWireSnapshots = false
      this.updateStatus('connected')
      this.handlers.onJoined?.(room.sessionId)
      this.publishSnapshot(room.state)

      room.onStateChange((state) => {
        if (this.preferWireSnapshots) return
        this.publishSnapshot(state)
      })
      room.onMessage('ships_snapshot', (snapshot: WireSnapshot) => {
        this.preferWireSnapshots = true
        this.handlers.onShipsUpdate?.(snapshot)
      })
      room.onMessage('star_system_snapshot', (snapshot: StarSystemSnapshot) => {
        this.handlers.onStarSystemUpdate?.(snapshot)
      })
      room.onLeave((code) => {
        this.room = null
        this.updateStatus('disconnected', `Room closed (${code})`)
      })
      room.onError((code, message) => {
        this.updateStatus('error', `Room error (${code}): ${message}`)
      })

      // Fallback polling keeps UI state in sync even if patch callbacks are missed.
      this.syncTimer = setInterval(() => {
        if (!this.room) return
        if (this.preferWireSnapshots) return
        this.publishSnapshot(this.room.state)
      }, 250)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to connect'
      this.updateStatus('error', detail)
      throw error
    }
  }

  disconnect() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
    }
    if (this.room) {
      void this.room.leave()
      this.room = null
    }
    this.preferWireSnapshots = false
    this.updateStatus('disconnected')
  }

  sendMove(update: {
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
  }) {
    if (!this.room) return
    this.room.send('move', {
      x: update.position[0],
      y: update.position[1],
      z: update.position[2],
      targetSpeed: update.targetSpeed,
      mwdActive: update.mwdActive,
      mwdRemaining: update.mwdRemaining,
      mwdCooldownRemaining: update.mwdCooldownRemaining,
      dampenersActive: update.dampenersActive,
      bearing: update.bearing,
      inclination: update.inclination,
      actualHeading: update.actualHeading,
      actualSpeed: update.actualSpeed,
      actualInclination: update.actualInclination,
      rollAngle: update.rollAngle,
    })
  }

  sendWarp(celestialId: string) {
    if (!this.room) return
    this.room.send('warp', { celestialId })
  }

  sendWarpIntent(payload: WarpIntentPayload) {
    if (!this.room) return
    this.room.send('warp', payload)
  }

  sendRegenerateSystem(config: Partial<StarSystemGenerationConfig>) {
    if (!this.room) return
    this.room.send('star_system_regenerate', config)
  }

  private updateStatus(status: MultiplayerStatus, detail?: string) {
    this.status = status
    this.handlers.onStatusChange?.(status, detail)
  }

  private publishSnapshot(state: ColyseusRoomState | undefined | null) {
    this.handlers.onShipsUpdate?.(this.toSnapshot(state))
  }

  private toSnapshot(state: ColyseusRoomState | undefined | null): Record<string, NetworkShipSnapshot> {
    const next: Record<string, NetworkShipSnapshot> = {}
    if (!state?.ships) return next
    state.ships.forEach((ship, key) => {
      next[key] = {
        id: ship.id,
        name: ship.name,
        currentCelestialId: ship.currentCelestialId,
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
    })
    return next
  }
}

export const multiplayerClient = new ColyseusMultiplayerClient()
