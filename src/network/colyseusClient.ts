import { Client, type Room } from 'colyseus.js'
import type { StarSystemGenerationConfig, StarSystemSnapshot } from '@/types/game'
import type {
  OrdnanceSnapshotMessage,
  ShipDamageMessage,
  ShipMoveUpdate,
  ShipsSnapshotMessage,
  WarpIntentPayload,
  WireShipSnapshot,
} from '../../shared/contracts/multiplayer'
import { toShipsSnapshot, type ColyseusRoomState } from '@/network/wireShipSnapshots'

export type NetworkShipSnapshot = WireShipSnapshot

export type MultiplayerStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

type Handlers = {
  onStatusChange?: (status: MultiplayerStatus, detail?: string) => void
  onJoined?: (sessionId: string) => void
  onShipsUpdate?: (shipsById: Record<string, NetworkShipSnapshot>) => void
  onOrdnanceUpdate?: (snapshot: OrdnanceSnapshotMessage) => void
  onShipDamage?: (message: ShipDamageMessage) => void
  onStarSystemUpdate?: (snapshot: StarSystemSnapshot) => void
}

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
      room.onMessage('ships_snapshot', (snapshot: ShipsSnapshotMessage) => {
        this.preferWireSnapshots = true
        this.handlers.onShipsUpdate?.(snapshot)
      })
      room.onMessage('ordnance_snapshot', (snapshot: OrdnanceSnapshotMessage) => {
        this.handlers.onOrdnanceUpdate?.(snapshot)
      })
      room.onMessage('ship_damage', (message: ShipDamageMessage) => {
        this.handlers.onShipDamage?.(message)
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

  sendMove(update: ShipMoveUpdate) {
    if (!this.room) return
    this.room.send('move', {
      x: update.position[0],
      y: update.position[1],
      z: update.position[2],
      revealedCelestialIds: update.revealedCelestialIds,
      launchedCylinders: update.launchedCylinders,
      launchedFlares: update.launchedFlares,
      launchedChaff: update.launchedChaff,
      torpedoExplosions: update.torpedoExplosions,
      inWarpTransit: update.inWarpTransit,
      targetSpeed: update.targetSpeed,
      mwdActive: update.mwdActive,
      mwdRemaining: update.mwdRemaining,
      mwdCooldownRemaining: update.mwdCooldownRemaining,
      dampenersActive: update.dampenersActive,
      shieldsUp: update.shieldsUp,
      shieldOnlineLevel: update.shieldOnlineLevel,
      shieldRechargeRatePct: update.shieldRechargeRatePct,
      shield: update.shield,
      armor: update.armor,
      hull: update.hull,
      bearing: update.bearing,
      inclination: update.inclination,
      actualVelocity: update.actualVelocity,
      actualHeading: update.actualHeading,
      actualSpeed: update.actualSpeed,
      actualInclination: update.actualInclination,
      rollAngle: update.rollAngle,
    })
  }

  sendShipDamage(message: ShipDamageMessage) {
    if (!this.room) return
    this.room.send('ship_damage', message)
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
    this.handlers.onShipsUpdate?.(toShipsSnapshot(state))
  }
}

export const multiplayerClient = new ColyseusMultiplayerClient()
