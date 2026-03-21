import colyseus, { type Client } from 'colyseus'
import type {
  EwRdneFieldMessage,
  EwRwcaAttenuateMessage,
  MoveMessage,
  OrdnanceSnapshotMessage,
  ShipDamageMessage,
  WarpMessage,
  WireLaunchedChaff,
  WireLaunchedCylinder,
  WireLaunchedFlare,
  WireOrdnanceSnapshot,
  WireTorpedoExplosion,
} from '../../../shared/contracts/multiplayer.js'
import { ROOM_MESSAGES } from '../net/messages.js'
import { applyMoveMessage, applyWarpMessage, buildShipsSnapshot, type RdneFieldPayload } from '../net/shipSnapshots.js'
import { createShipForJoin } from '../rooms/roomLifecycle.js'
import { StarSystemRoomState } from '../schema/GameState.js'
import type { ShipState } from '../schema/GameState.js'
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
    launchedChaff: [],
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
  const launchedCylinders = asMessageArray<WireLaunchedCylinder>(message.launchedCylinders)
    .slice(0, MAX_ORDNANCE_ITEMS_PER_CATEGORY)
    .map((cylinder) => ({ ...cylinder }))
  const launchedFlares = asMessageArray<WireLaunchedFlare>(message.launchedFlares)
    .slice(0, MAX_ORDNANCE_ITEMS_PER_CATEGORY)
    .map((flare) => ({ ...flare }))
  const launchedChaff = asMessageArray<WireLaunchedChaff>(message.launchedChaff)
    .slice(0, MAX_ORDNANCE_ITEMS_PER_CATEGORY)
    .map((piece) => ({ ...piece }))
  const torpedoExplosions = asMessageArray<WireTorpedoExplosion>(message.torpedoExplosions)
    .slice(0, MAX_ORDNANCE_ITEMS_PER_CATEGORY)
    .map((explosion) => ({ ...explosion }))
  return {
    launchedCylinders,
    launchedFlares,
    launchedChaff,
    torpedoExplosions,
  }
}

function applyLayeredDamage(
  target: ShipState,
  damage: number
) {
  let remaining = Math.max(0, damage)
  if (remaining <= 0) return

  if (target.shieldsUp && target.shield > 0) {
    const absorbed = Math.min(target.shield, remaining)
    target.shield = Math.max(0, target.shield - absorbed)
    remaining -= absorbed
  }
  if (remaining > 0 && target.armor > 0) {
    const absorbed = Math.min(target.armor, remaining)
    target.armor = Math.max(0, target.armor - absorbed)
    remaining -= absorbed
  }
  if (remaining > 0) {
    target.hull = Math.max(0, target.hull - remaining)
  }
}

export class StarSystemRoom extends Room<StarSystemRoomState> {
  maxClients = 20
  /** Attacker session id → target session id being RWCA-attenuated (validated). */
  private rwcaAttenuationTargetBySource = new Map<string, string | null>()
  /** Attacker session id → RDNE field being applied to a target (validated). */
  private rdneFieldBySource = new Map<string, { targetShipId: string; payload: RdneFieldPayload } | null>()
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
    this.broadcast(
      ROOM_MESSAGES.shipsSnapshot,
      buildShipsSnapshot(this.state.ships, this.rwcaAttenuationTargetBySource, this.rdneFieldBySource)
    )
  }

  private isRwcaAttenuatedVictim(sessionId: string): boolean {
    for (const target of this.rwcaAttenuationTargetBySource.values()) {
      if (target === sessionId) return true
    }
    return false
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
      if (!ship) return
      if (this.isRwcaAttenuatedVictim(client.sessionId)) return
      applyWarpMessage(ship, message)
      this.broadcastSnapshot()
    })

    this.onMessage(ROOM_MESSAGES.ewRwcaAttenuate, (client, message: EwRwcaAttenuateMessage) => {
      const source = this.state.ships.get(client.sessionId)
      if (!source) return

      let nextTarget: string | null = null
      const raw = message?.targetShipId
      if (typeof raw === 'string' && raw.length > 0) {
        const target = this.state.ships.get(raw)
        if (
          target
          && raw !== client.sessionId
          && target.currentCelestialId === source.currentCelestialId
        ) {
          nextTarget = raw
        }
      }

      this.rwcaAttenuationTargetBySource.set(client.sessionId, nextTarget)
      this.broadcastSnapshot()
    })

    this.onMessage(ROOM_MESSAGES.ewRdneField, (client, message: EwRdneFieldMessage) => {
      const source = this.state.ships.get(client.sessionId)
      if (!source) return

      const raw = message?.targetShipId
      if (typeof raw !== 'string' || raw.length === 0) {
        this.rdneFieldBySource.set(client.sessionId, null)
        this.broadcastSnapshot()
        return
      }

      const target = this.state.ships.get(raw)
      if (
        !target
        || raw === client.sessionId
        || target.currentCelestialId !== source.currentCelestialId
      ) {
        this.rdneFieldBySource.set(client.sessionId, null)
        this.broadcastSnapshot()
        return
      }

      const kind = message.kind === 'source' || message.kind === 'sink' ? message.kind : 'sink'
      const wo = Array.isArray(message.worldOffset) && message.worldOffset.length >= 3
        ? [message.worldOffset[0], message.worldOffset[1], message.worldOffset[2]] as [number, number, number]
        : [0, 0, 0] as [number, number, number]
      const intensity = typeof message.intensity === 'number' ? Math.max(0, Math.min(1, message.intensity)) : 0
      const forceMagnitude = typeof message.forceMagnitude === 'number' ? Math.max(0, Math.min(1, message.forceMagnitude)) : 0

      this.rdneFieldBySource.set(client.sessionId, {
        targetShipId: raw,
        payload: { kind, worldOffset: wo, intensity, forceMagnitude },
      })
      this.broadcastSnapshot()
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

    this.onMessage(ROOM_MESSAGES.shipDamage, (client, message: ShipDamageMessage) => {
      const source = this.state.ships.get(client.sessionId)
      const target = this.state.ships.get(message.targetShipId)
      if (!source || !target) return
      if (source.currentCelestialId !== target.currentCelestialId) return
      if (
        message.currentCelestialId
        && target.currentCelestialId !== message.currentCelestialId
      ) {
        return
      }

      const appliedDamage = Math.max(0, message.damage)
      if (!Number.isFinite(appliedDamage) || appliedDamage <= 0) return
      applyLayeredDamage(target, appliedDamage)
      this.broadcastSnapshot()
      this.broadcast(ROOM_MESSAGES.shipDamage, {
        targetShipId: message.targetShipId,
        damage: appliedDamage,
        currentCelestialId: target.currentCelestialId,
      } satisfies ShipDamageMessage)
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
    this.rwcaAttenuationTargetBySource.delete(client.sessionId)
    this.rdneFieldBySource.delete(client.sessionId)
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
