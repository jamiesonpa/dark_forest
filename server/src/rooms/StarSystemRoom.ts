import colyseus, { type Client } from 'colyseus'
import { StarSystemRoomState, ShipState } from '../schema/GameState.js'

const SPAWN_RING_RADIUS = 1200
const { Room } = colyseus

export class StarSystemRoom extends Room<StarSystemRoomState> {
  maxClients = 20

  onCreate(_options: Record<string, unknown>) {
    this.setState(new StarSystemRoomState())
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
  }

  onLeave(client: Client) {
    this.state.ships.delete(client.sessionId)
  }
}
