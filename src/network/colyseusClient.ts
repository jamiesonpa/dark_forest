import { Client, type Room } from 'colyseus.js'

export interface NetworkShipSnapshot {
  id: string
  name: string
  position: [number, number, number]
  shield: number
  shieldMax: number
  armor: number
  armorMax: number
  hull: number
  hullMax: number
  capacitor: number
  capacitorMax: number
}

export type MultiplayerStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

type Handlers = {
  onStatusChange?: (status: MultiplayerStatus, detail?: string) => void
  onJoined?: (sessionId: string) => void
  onShipsUpdate?: (shipsById: Record<string, NetworkShipSnapshot>) => void
}

type ColyseusShip = {
  id: string
  name: string
  x: number
  y: number
  z: number
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
  ships: Map<string, ColyseusShip> & {
    forEach: (callback: (value: ColyseusShip, key: string) => void) => void
  }
}

class ColyseusMultiplayerClient {
  private room: Room<ColyseusRoomState> | null = null
  private handlers: Handlers = {}
  private status: MultiplayerStatus = 'disconnected'

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
      this.updateStatus('connected')
      this.handlers.onJoined?.(room.sessionId)

      room.onStateChange((state) => {
        this.handlers.onShipsUpdate?.(this.toSnapshot(state))
      })
      room.onLeave((code) => {
        this.room = null
        this.updateStatus('disconnected', `Room closed (${code})`)
      })
      room.onError((code, message) => {
        this.updateStatus('error', `Room error (${code}): ${message}`)
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to connect'
      this.updateStatus('error', detail)
      throw error
    }
  }

  disconnect() {
    if (this.room) {
      void this.room.leave()
      this.room = null
    }
    this.updateStatus('disconnected')
  }

  sendMove(position: [number, number, number]) {
    if (!this.room) return
    this.room.send('move', { x: position[0], y: position[1], z: position[2] })
  }

  sendWarp(celestialId: string) {
    if (!this.room) return
    this.room.send('warp', { celestialId })
  }

  private updateStatus(status: MultiplayerStatus, detail?: string) {
    this.status = status
    this.handlers.onStatusChange?.(status, detail)
  }

  private toSnapshot(state: ColyseusRoomState): Record<string, NetworkShipSnapshot> {
    const next: Record<string, NetworkShipSnapshot> = {}
    state.ships.forEach((ship, key) => {
      next[key] = {
        id: ship.id,
        name: ship.name,
        position: [ship.x, ship.y, ship.z],
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
