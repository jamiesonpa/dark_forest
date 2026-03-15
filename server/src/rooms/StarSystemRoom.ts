import colyseus, { type Client } from 'colyseus'
import { StarSystemRoomState, ShipState } from '../schema/GameState.js'
import {
  DEFAULT_STAR_SYSTEM_CONFIG,
  generateStarSystemSnapshot,
  getFarthestWarpablePair,
} from '../systems/starSystemGenerator.js'
import type { StarSystemGenerationConfig, StarSystemSnapshot } from '../types/starSystem.js'

const SPAWN_RING_RADIUS = 1200
const SPAWN_VERTICAL_JITTER = 150
const { Room } = colyseus

type ShipSnapshot = {
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

export class StarSystemRoom extends Room<StarSystemRoomState> {
  maxClients = 20
  private moveDebugLastLogMs = new Map<string, number>()
  private moveDebugLastPos = new Map<string, { x: number; y: number; z: number }>()
  private starSystemSnapshot: StarSystemSnapshot = generateStarSystemSnapshot(DEFAULT_STAR_SYSTEM_CONFIG)
  private spawnAnchorIds: [string, string] | null = null

  private computeSpawnAnchorIds() {
    const farthestPair = getFarthestWarpablePair(this.starSystemSnapshot.system)
    if (farthestPair) {
      this.spawnAnchorIds = [farthestPair[0].id, farthestPair[1].id]
      return
    }
    const warpables = this.starSystemSnapshot.system.celestials.filter((c) => c.type !== 'star')
    if (warpables.length >= 2) {
      this.spawnAnchorIds = [warpables[0].id, warpables[1].id]
      return
    }
    this.spawnAnchorIds = ['star', 'star']
  }

  private setStarSystemFromConfig(input: Partial<StarSystemGenerationConfig> | undefined) {
    this.starSystemSnapshot = generateStarSystemSnapshot({
      ...DEFAULT_STAR_SYSTEM_CONFIG,
      ...(input ?? {}),
    })
    this.computeSpawnAnchorIds()
  }

  private broadcastStarSystemSnapshot(client?: Client) {
    if (client) {
      client.send('star_system_snapshot', this.starSystemSnapshot)
      return
    }
    this.broadcast('star_system_snapshot', this.starSystemSnapshot)
  }

  private getSpawnForPlayer(playerIndex: number) {
    const anchorId = this.spawnAnchorIds
      ? this.spawnAnchorIds[playerIndex % 2]
      : this.starSystemSnapshot.system.celestials.find((c) => c.type !== 'star')?.id ?? 'star'
    const angle = (Math.PI * 2 * (playerIndex % Math.max(2, this.maxClients))) / Math.max(2, this.maxClients)
    return {
      celestialId: anchorId,
      localPosition: [
        Math.cos(angle) * SPAWN_RING_RADIUS,
        Math.sin(angle * 2) * SPAWN_VERTICAL_JITTER,
        Math.sin(angle) * SPAWN_RING_RADIUS,
      ] as [number, number, number],
    }
  }

  private respawnShipsByAnchorOrder() {
    const ids = Array.from(this.state.ships.keys())
    ids.forEach((sessionId, index) => {
      const ship = this.state.ships.get(sessionId)
      if (!ship) return
      const spawn = this.getSpawnForPlayer(index)
      ship.currentCelestialId = spawn.celestialId
      ship.x = spawn.localPosition[0]
      ship.y = spawn.localPosition[1]
      ship.z = spawn.localPosition[2]
    })
    this.broadcastSnapshot()
  }

  private buildSnapshot(): Record<string, ShipSnapshot> {
    const snapshot: Record<string, ShipSnapshot> = {}
    this.state.ships.forEach((ship, sessionId) => {
      snapshot[sessionId] = {
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
    return snapshot
  }

  private broadcastSnapshot() {
    this.broadcast('ships_snapshot', this.buildSnapshot())
  }

  onCreate(options: Record<string, unknown>) {
    this.setState(new StarSystemRoomState())
    const initialConfig = (options.starSystemConfig as Partial<StarSystemGenerationConfig> | undefined)
      ?? DEFAULT_STAR_SYSTEM_CONFIG
    this.setStarSystemFromConfig(initialConfig)
    console.log(`[room:${this.roomId}] created`)
    // Room state is now synced to all clients
    this.onMessage('warp', (client, message: { celestialId: string }) => {
      const ship = this.state.ships.get(client.sessionId)
      if (ship) ship.currentCelestialId = message.celestialId
    })
    this.onMessage('star_system_regenerate', (_client, message: Partial<StarSystemGenerationConfig>) => {
      this.setStarSystemFromConfig(message)
      this.broadcastStarSystemSnapshot()
      this.respawnShipsByAnchorOrder()
    })
    this.onMessage('move', (client, message: {
      x: number
      y: number
      z: number
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
    }) => {
      const ship = this.state.ships.get(client.sessionId)
      if (ship) {
        ship.x = message.x
        ship.y = message.y
        ship.z = message.z
        if (typeof message.targetSpeed === 'number') ship.targetSpeed = message.targetSpeed
        if (typeof message.mwdActive === 'boolean') ship.mwdActive = message.mwdActive
        if (typeof message.mwdRemaining === 'number') ship.mwdRemaining = message.mwdRemaining
        if (typeof message.mwdCooldownRemaining === 'number') ship.mwdCooldownRemaining = message.mwdCooldownRemaining
        if (typeof message.dampenersActive === 'boolean') ship.dampenersActive = message.dampenersActive
        if (typeof message.bearing === 'number') ship.bearing = message.bearing
        if (typeof message.inclination === 'number') ship.inclination = message.inclination
        if (typeof message.actualHeading === 'number') ship.actualHeading = message.actualHeading
        if (typeof message.actualSpeed === 'number') ship.actualSpeed = message.actualSpeed
        if (typeof message.actualInclination === 'number') ship.actualInclination = message.actualInclination
        if (typeof message.rollAngle === 'number') ship.rollAngle = message.rollAngle
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
    const spawn = this.getSpawnForPlayer(playerIndex)
    ship.currentCelestialId = spawn.celestialId
    ship.x = spawn.localPosition[0]
    ship.y = spawn.localPosition[1]
    ship.z = spawn.localPosition[2]
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
