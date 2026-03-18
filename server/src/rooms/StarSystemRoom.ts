import colyseus, { type Client } from 'colyseus'
import type {
  MoveMessage,
  OrdnanceSnapshotMessage,
  WarpMessage,
  WireOrdnanceSnapshot,
} from '../../../shared/contracts/multiplayer.js'
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

const MAX_ORDNANCE_ITEMS_PER_CATEGORY = 512

function emptyOrdnanceSnapshot(): WireOrdnanceSnapshot {
  return {
    launchedCylinders: [],
    launchedFlares: [],
    torpedoExplosions: [],
  }
}

function asMessageArray<T>(value: unknown): T[] {
  if (!value) return []
  if (Array.isArray(value)) return value as T[]
  if (value instanceof Map) return Array.from(value.values()) as T[]
  if (typeof value === 'object') return Object.values(value as Record<string, T>)
  return []
}

function toOrdnanceSnapshotFromMove(message: MoveMessage): WireOrdnanceSnapshot {
  const launchedCylinders = asMessageArray(message.launchedCylinders)
    .slice(0, MAX_ORDNANCE_ITEMS_PER_CATEGORY)
    .map((cylinder) => ({ ...cylinder }))
  const launchedFlares = asMessageArray(message.launchedFlares)
    .slice(0, MAX_ORDNANCE_ITEMS_PER_CATEGORY)
    .map((flare) => ({ ...flare }))
  const torpedoExplosions = asMessageArray(message.torpedoExplosions)
    .slice(0, MAX_ORDNANCE_ITEMS_PER_CATEGORY)
    .map((explosion) => ({ ...explosion }))
  return {
    launchedCylinders,
    launchedFlares,
    torpedoExplosions,
  }
}

export class StarSystemRoom extends Room<StarSystemRoomState> {
  maxClients = 20
  private moveDebugLastLogMs = new Map<string, number>()
  private moveDebugLastPos = new Map<string, { x: number; y: number; z: number }>()
  private starSystemSnapshot: StarSystemSnapshot = buildStarSystemSnapshot(getStartupStarSystemConfig())
  private spawnAnchorIds: SpawnAnchorIds = computeSpawnAnchorIds(this.starSystemSnapshot)
  private ordnanceBySession: OrdnanceSnapshotMessage = {}

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

  private broadcastOrdnanceSnapshot(client?: Client) {
    if (client) {
      client.send(ROOM_MESSAGES.ordnanceSnapshot, this.ordnanceBySession)
      return
    }
    this.broadcast(ROOM_MESSAGES.ordnanceSnapshot, this.ordnanceBySession)
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
      this.ordnanceBySession[client.sessionId] = toOrdnanceSnapshotFromMove(message)
      this.broadcastSnapshot()
      this.broadcastOrdnanceSnapshot()
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
    this.ordnanceBySession[client.sessionId] = emptyOrdnanceSnapshot()
    this.broadcastStarSystemSnapshot(client)
    this.broadcastOrdnanceSnapshot(client)
    this.broadcastSnapshot()
    console.log(
      `[room:${this.roomId}] join session=${client.sessionId} players=${this.state.ships.size}`
    )
  }

  onLeave(client: Client) {
    this.state.ships.delete(client.sessionId)
    delete this.ordnanceBySession[client.sessionId]
    this.broadcastSnapshot()
    this.broadcastOrdnanceSnapshot()
    this.moveDebugLastLogMs.delete(client.sessionId)
    this.moveDebugLastPos.delete(client.sessionId)
    console.log(
      `[room:${this.roomId}] leave session=${client.sessionId} players=${this.state.ships.size}`
    )
  }
}
