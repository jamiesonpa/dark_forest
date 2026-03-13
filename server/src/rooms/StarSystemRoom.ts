import { Room, Client } from 'colyseus'
import { StarSystemRoomState, ShipState } from '../schema/GameState.js'

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
    this.state.ships.set(client.sessionId, ship)
  }

  onLeave(client: Client) {
    this.state.ships.delete(client.sessionId)
  }
}
