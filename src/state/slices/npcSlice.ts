import type { StateCreator } from 'zustand'
import { defaultNpcShipConfig, defaultShipState } from '@/state/defaults'
import type { GameStore, NpcShipConfig } from '@/state/types'
import { MWD_SPEED } from '@/systems/simulation/constants'

const DEFAULT_NPC_SPAWN_POSITION: [number, number, number] = [0, 0, -20000]
const MAX_NPC_SUBWARP_SPEED = 215

function getNpcMaxSpeed(config: NpcShipConfig): number {
  return config.mwdActive ? MWD_SPEED : MAX_NPC_SUBWARP_SPEED
}

function sanitizeNpcSpawnPosition(position: [number, number, number]): [number, number, number] {
  const [x, y, z] = position
  return [
    Number.isFinite(x) ? x : DEFAULT_NPC_SPAWN_POSITION[0],
    Number.isFinite(y) ? y : DEFAULT_NPC_SPAWN_POSITION[1],
    Number.isFinite(z) ? z : DEFAULT_NPC_SPAWN_POSITION[2],
  ]
}

function getShipForwardVector(headingDeg: number, inclinationDeg: number): [number, number, number] {
  const headingRad = (headingDeg * Math.PI) / 180
  const inclinationRad = (inclinationDeg * Math.PI) / 180
  const cosInclination = Math.cos(inclinationRad)
  return [
    -Math.sin(headingRad) * cosInclination,
    Math.sin(inclinationRad),
    Math.cos(headingRad) * cosInclination,
  ]
}

export const createNpcSlice: StateCreator<GameStore, [], [], Partial<GameStore>> = (set) => ({
  npcShips: {},
  npcSpawnPosition: DEFAULT_NPC_SPAWN_POSITION,

  setNpcSpawnPosition: (position) =>
    set({ npcSpawnPosition: sanitizeNpcSpawnPosition(position) }),

  spawnNpcShip: (position, config) =>
    set((s) => {
      const id = `npc-${Date.now()}-${Math.floor(Math.random() * 100000)}`
      const [x, y, z] = sanitizeNpcSpawnPosition(position ?? s.npcSpawnPosition)
      const npcConfig: NpcShipConfig = { ...defaultNpcShipConfig, ...config }
      const spawnedSpeed = Math.max(0, Math.min(getNpcMaxSpeed(npcConfig), npcConfig.commandedSpeed))
      const shipState = {
        ...defaultShipState,
        currentCelestialId: s.currentCelestialId,
        position: [x, y, z] as [number, number, number],
        shieldsUp: npcConfig.shieldsUp,
        bearing: npcConfig.commandedHeading,
        actualHeading: npcConfig.commandedHeading,
        inclination: npcConfig.commandedInclination,
        actualInclination: npcConfig.commandedInclination,
        targetSpeed: spawnedSpeed,
        actualSpeed: spawnedSpeed,
        mwdActive: npcConfig.mwdActive,
        actualVelocity: getShipForwardVector(
          npcConfig.commandedHeading,
          npcConfig.commandedInclination
        ).map((v) => v * spawnedSpeed) as [number, number, number],
      }
      return {
        shipsById: { ...s.shipsById, [id]: shipState },
        npcShips: { ...s.npcShips, [id]: npcConfig },
      }
    }),

  removeNpcShip: (id) =>
    set((s) => {
      const nextShips = { ...s.shipsById }
      delete nextShips[id]
      const nextNpc = { ...s.npcShips }
      delete nextNpc[id]
      return {
        shipsById: nextShips,
        npcShips: nextNpc,
        selectedTargetId: s.selectedTargetId === id ? null : s.selectedTargetId,
      }
    }),

  clearNpcShips: () =>
    set((s) => {
      const nextShips = { ...s.shipsById }
      for (const id of Object.keys(s.npcShips)) {
        delete nextShips[id]
      }
      return {
        shipsById: nextShips,
        npcShips: {},
        selectedTargetId: s.selectedTargetId && s.npcShips[s.selectedTargetId]
          ? null
          : s.selectedTargetId,
      }
    }),

  setNpcShipConfig: (id, partial) =>
    set((s) => {
      const existing = s.npcShips[id]
      if (!existing) return {}
      const updated = { ...existing, ...partial }
      const shipUpdates: Partial<GameStore['ship']> = {}
      if (partial.shieldsUp !== undefined) {
        shipUpdates.shieldsUp = partial.shieldsUp
      }
      if (partial.mwdActive !== undefined) {
        shipUpdates.mwdActive = partial.mwdActive
      }
      const existingShip = s.shipsById[id]
      if (!existingShip) return { npcShips: { ...s.npcShips, [id]: updated } }
      return {
        npcShips: { ...s.npcShips, [id]: updated },
        shipsById: {
          ...s.shipsById,
          [id]: { ...existingShip, ...shipUpdates },
        },
      }
    }),

  advanceNpcShips: (deltaSeconds) =>
    set((s) => {
      const npcIds = Object.keys(s.npcShips)
      if (npcIds.length === 0 || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
        return {}
      }
      const nextShips = { ...s.shipsById }
      for (const id of npcIds) {
        const config = s.npcShips[id]
        const ship = nextShips[id]
        if (!config || !ship) continue

        if (config.behaviorMode === 'stationary') {
          nextShips[id] = {
            ...ship,
            targetSpeed: 0,
            actualSpeed: 0,
            actualVelocity: [0, 0, 0],
            mwdActive: config.mwdActive,
          }
          continue
        }

        if (config.behaviorMode === 'manual' || config.behaviorMode === 'straight') {
          const heading = ((config.commandedHeading % 360) + 360) % 360
          const inclination = Math.max(-90, Math.min(90, config.commandedInclination))
          const speed = Math.max(0, Math.min(getNpcMaxSpeed(config), config.commandedSpeed))
          const forward = getShipForwardVector(heading, inclination)
          const velocity: [number, number, number] = [
            forward[0] * speed,
            forward[1] * speed,
            forward[2] * speed,
          ]
          nextShips[id] = {
            ...ship,
            bearing: heading,
            actualHeading: heading,
            inclination,
            actualInclination: inclination,
            targetSpeed: speed,
            actualSpeed: speed,
            mwdActive: config.mwdActive,
            actualVelocity: velocity,
            position: [
              ship.position[0] + velocity[0] * deltaSeconds,
              ship.position[1] + velocity[1] * deltaSeconds,
              ship.position[2] + velocity[2] * deltaSeconds,
            ],
          }
          continue
        }

        if (config.behaviorMode === 'orbit') {
          const speed = Math.max(0, Math.min(getNpcMaxSpeed(config), config.commandedSpeed))
          if (speed <= 0.0001 || config.orbitRadius <= 0) {
            nextShips[id] = {
              ...ship,
              targetSpeed: 0,
              actualSpeed: 0,
              actualVelocity: [0, 0, 0],
              mwdActive: config.mwdActive,
            }
            continue
          }
          const angularSpeed = speed / config.orbitRadius
          const dx = ship.position[0] - config.orbitCenter[0]
          const dz = ship.position[2] - config.orbitCenter[2]
          const currentAngle = Math.atan2(dx, dz)
          const nextAngle = currentAngle + angularSpeed * deltaSeconds
          const newX = config.orbitCenter[0] + Math.sin(nextAngle) * config.orbitRadius
          const newZ = config.orbitCenter[2] + Math.cos(nextAngle) * config.orbitRadius
          const heading = ((nextAngle + Math.PI / 2) * 180 / Math.PI + 360) % 360
          const forward = getShipForwardVector(heading, 0)
          nextShips[id] = {
            ...ship,
            bearing: heading,
            actualHeading: heading,
            inclination: 0,
            actualInclination: 0,
            targetSpeed: speed,
            actualSpeed: speed,
            mwdActive: config.mwdActive,
            actualVelocity: [forward[0] * speed, 0, forward[2] * speed],
            position: [newX, ship.position[1], newZ],
          }
          continue
        }
      }
      return { shipsById: nextShips }
    }),
})
