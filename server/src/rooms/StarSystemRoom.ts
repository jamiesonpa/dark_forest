import colyseus, { type Client } from 'colyseus'
import { StarSystemRoomState, ShipState } from '../schema/GameState.js'

const SPAWN_RING_RADIUS = 1200
const { Room } = colyseus

type ShipSnapshot = {
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

export class StarSystemRoom extends Room<StarSystemRoomState> {
  maxClients = 20
  private moveDebugLastLogMs = new Map<string, number>()
  private moveDebugLastPos = new Map<string, { x: number; y: number; z: number }>()

  private buildSnapshot(): Record<string, ShipSnapshot> {
    const snapshot: Record<string, ShipSnapshot> = {}
    this.state.ships.forEach((ship, sessionId) => {
      snapshot[sessionId] = {
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
    return snapshot
  }

  private broadcastSnapshot() {
    this.broadcast('ships_snapshot', this.buildSnapshot())
  }

  onCreate(_options: Record<string, unknown>) {
    this.setState(new StarSystemRoomState())
    console.log(`[room:${this.roomId}] created`)
    // Room state is now synced to all clients
    this.onMessage('warp', (client, message: { celestialId: string }) => {
      const ship = this.state.ships.get(client.sessionId)
      if (ship) ship.currentCelestialId = message.celestialId
    })
    this.onMessage('move', (client, message: { x: number; y: number; z: number }) => {
      const ship = this.state.ships.get(client.sessionId)
      if (ship) {
        ship.x = message.x
        ship.y = message.y
        ship.z = message.z
      }
      this.broadcastSnapshot()

      const nowMs = Date.now()
      const lastLog = this.moveDebugLastLogMs.get(client.sessionId) ?? 0
      const prevPos = this.moveDebugLastPos.get(client.sessionId)
      const movedDistance = prevPos
        ? Math.hypot(message.x - prevPos.x, message.y - prevPos.y, message.z - prevPos.z)
        : 0

      // Debug log once per second per player to confirm move packets arrive.
      if (nowMs - lastLog >= 1000) {
        console.log(
          `[room:${this.roomId}] move session=${client.sessionId.slice(0, 8)} pos=(${message.x.toFixed(1)}, ${message.y.toFixed(1)}, ${message.z.toFixed(1)}) delta=${movedDistance.toFixed(1)}`
        )
        this.moveDebugLastLogMs.set(client.sessionId, nowMs)
      }

      this.moveDebugLastPos.set(client.sessionId, { x: message.x, y: message.y, z: message.z })
    })
  }

  onJoin(client: Client) {
    const ship = new ShipState()
    ship.id = client.sessionId
    ship.name = 'Raven'
    const playerIndex = this.state.ships.size
    const angle = (Math.PI * 2 * playerIndex) / Math.max(1, this.maxClients)
    ship.x = Math.cos(angle) * SPAWN_RING_RADIUS
    ship.y = 0
    ship.z = Math.sin(angle) * SPAWN_RING_RADIUS
    this.state.ships.set(client.sessionId, ship)
    this.broadcastSnapshot()
    console.log(
      `[room:${this.roomId}] join session=${client.sessionId} players=${this.state.ships.size}`
    )
  }

  onLeave(client: Client) {
    this.state.ships.delete(client.sessionId)
    this.broadcastSnapshot()
    this.moveDebugLastLogMs.delete(client.sessionId)
    this.moveDebugLastPos.delete(client.sessionId)
    console.log(
      `[room:${this.roomId}] leave session=${client.sessionId} players=${this.state.ships.size}`
    )
  }
}
