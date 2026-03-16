import colyseus, { type Client } from 'colyseus'
import type { MoveMessage, WarpMessage } from '../../../shared/contracts/multiplayer.js'
import { ROOM_MESSAGES } from '../net/messages.js'
import { applyMoveMessage, applyWarpMessage, buildShipsSnapshot } from '../net/shipSnapshots.js'
import { createShipForJoin } from '../rooms/roomLifecycle.js'
import { StarSystemRoomState } from '../schema/GameState.js'
import {
  computeSpawnAnchorIds,
  respawnShipsByAnchorOrder,
  type SpawnAnchorIds,
} from '../simulation/spawnPolicy.js'
import { buildStarSystemSnapshot, getStartupStarSystemConfig } from '../simulation/starSystemConfig.js'
import type { StarSystemGenerationConfig, StarSystemSnapshot } from '../types/starSystem.js'

const { Room } = colyseus

export class StarSystemRoom extends Room<StarSystemRoomState> {
  maxClients = 20
  private moveDebugLastLogMs = new Map<string, number>()
  private moveDebugLastPos = new Map<string, { x: number; y: number; z: number }>()
  private starSystemSnapshot: StarSystemSnapshot = buildStarSystemSnapshot(getStartupStarSystemConfig())
  private spawnAnchorIds: SpawnAnchorIds = computeSpawnAnchorIds(this.starSystemSnapshot)

  private setStarSystemFromConfig(input: Partial<StarSystemGenerationConfig> | undefined) {
    this.starSystemSnapshot = buildStarSystemSnapshot(input)
    this.spawnAnchorIds = computeSpawnAnchorIds(this.starSystemSnapshot)
  }

  private broadcastStarSystemSnapshot(client?: Client) {
    if (client) {
      client.send(ROOM_MESSAGES.starSystemSnapshot, this.starSystemSnapshot)
      return
    }
    this.broadcast(ROOM_MESSAGES.starSystemSnapshot, this.starSystemSnapshot)
  }

  private respawnShipsByAnchorOrder() {
    respawnShipsByAnchorOrder(
      this.state.ships,
      this.starSystemSnapshot,
      this.spawnAnchorIds,
      this.maxClients
    )
    this.broadcastSnapshot()
  }

  private broadcastSnapshot() {
    this.broadcast(ROOM_MESSAGES.shipsSnapshot, buildShipsSnapshot(this.state.ships))
  }

  private logMoveDebug(client: Client, message: MoveMessage) {
    const nowMs = Date.now()
    const lastLog = this.moveDebugLastLogMs.get(client.sessionId) ?? 0
    const prevPos = this.moveDebugLastPos.get(client.sessionId)
    const movedDistance = prevPos
      ? Math.hypot(message.x - prevPos.x, message.y - prevPos.y, message.z - prevPos.z)
      : 0

    if (nowMs - lastLog >= 1000) {
      console.log(
        `[room:${this.roomId}] move session=${client.sessionId.slice(0, 8)} pos=(${message.x.toFixed(1)}, ${message.y.toFixed(1)}, ${message.z.toFixed(1)}) delta=${movedDistance.toFixed(1)}`
      )
      this.moveDebugLastLogMs.set(client.sessionId, nowMs)
    }

    this.moveDebugLastPos.set(client.sessionId, { x: message.x, y: message.y, z: message.z })
  }

  onCreate(options: Record<string, unknown>) {
    this.setState(new StarSystemRoomState())
    const initialConfig = (options.starSystemConfig as Partial<StarSystemGenerationConfig> | undefined)
      ?? getStartupStarSystemConfig()
    this.setStarSystemFromConfig(initialConfig)
    console.log(`[room:${this.roomId}] created`)

    this.onMessage(ROOM_MESSAGES.warp, (client, message: WarpMessage) => {
      const ship = this.state.ships.get(client.sessionId)
      if (ship) {
        applyWarpMessage(ship, message)
        this.broadcastSnapshot()
      }
    })

    this.onMessage(ROOM_MESSAGES.starSystemRegenerate, (_client, message: Partial<StarSystemGenerationConfig>) => {
      this.setStarSystemFromConfig(message)
      this.broadcastStarSystemSnapshot()
      this.respawnShipsByAnchorOrder()
    })

    this.onMessage(ROOM_MESSAGES.move, (client, message: MoveMessage) => {
      const ship = this.state.ships.get(client.sessionId)
      if (ship) {
        applyMoveMessage(ship, message)
      }
      this.broadcastSnapshot()
      this.logMoveDebug(client, message)
    })
  }

  onJoin(client: Client) {
    const playerIndex = this.state.ships.size
    const ship = createShipForJoin(
      client.sessionId,
      playerIndex,
      this.starSystemSnapshot,
      this.spawnAnchorIds,
      this.maxClients
    )
    this.state.ships.set(client.sessionId, ship)
    this.broadcastStarSystemSnapshot(client)
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
