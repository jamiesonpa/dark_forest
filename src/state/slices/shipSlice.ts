import type { StateCreator } from 'zustand'
import { defaultShipState } from '@/state/defaults'
import type { GameStore } from '@/state/types'
import type { NetworkShipSnapshot } from '@/network/colyseusClient'

const MWD_CAPACITOR_ACTIVATION_FRACTION = 0.2
const OFFLINE_LOCAL_PLAYER_ID = 'local-player'

function clampAngle(deg: number) {
  return ((deg % 360) + 360) % 360
}

function getLocalPlayerId(state: GameStore) {
  return state.localPlayerId || OFFLINE_LOCAL_PLAYER_ID
}

function withLocalShipUpdate(
  state: GameStore,
  updater: (ship: GameStore['ship']) => GameStore['ship']
) {
  const localId = getLocalPlayerId(state)
  const current = state.shipsById[localId] ?? state.ship
  const next = updater(current)
  return {
    ship: next,
    shipsById: {
      ...state.shipsById,
      [localId]: next,
    },
  }
}

function fromSnapshot(snapshot: NetworkShipSnapshot, existing: GameStore['ship']) {
  return {
    ...existing,
    position: snapshot.position,
    targetSpeed: snapshot.targetSpeed,
    mwdActive: snapshot.mwdActive,
    mwdRemaining: snapshot.mwdRemaining,
    mwdCooldownRemaining: snapshot.mwdCooldownRemaining,
    dampenersActive: snapshot.dampenersActive,
    bearing: snapshot.bearing,
    inclination: snapshot.inclination,
    actualHeading: snapshot.actualHeading,
    actualSpeed: snapshot.actualSpeed,
    actualInclination: snapshot.actualInclination,
    rollAngle: snapshot.rollAngle,
    shield: snapshot.shield,
    shieldMax: snapshot.shieldMax,
    armor: snapshot.armor,
    armorMax: snapshot.armorMax,
    hull: snapshot.hull,
    hullMax: snapshot.hullMax,
    capacitor: snapshot.capacitor,
    capacitorMax: snapshot.capacitorMax,
  }
}

export const createShipSlice: StateCreator<GameStore, [], [], Partial<GameStore>> = (set) => ({
  localPlayerId: OFFLINE_LOCAL_PLAYER_ID,
  shipsById: {
    [OFFLINE_LOCAL_PLAYER_ID]: { ...defaultShipState },
  },
  ship: { ...defaultShipState },
  setLocalPlayerId: (id) =>
    set((s) => {
      const nextShips = { ...s.shipsById }
      const previousLocalId = s.localPlayerId || OFFLINE_LOCAL_PLAYER_ID

      // Remove the previous local identity when the client switches between
      // offline and network-controlled ships so it cannot linger as a remote render.
      if (previousLocalId === OFFLINE_LOCAL_PLAYER_ID && id !== OFFLINE_LOCAL_PLAYER_ID) {
        delete nextShips[OFFLINE_LOCAL_PLAYER_ID]
      } else if (previousLocalId !== OFFLINE_LOCAL_PLAYER_ID && id === OFFLINE_LOCAL_PLAYER_ID) {
        delete nextShips[previousLocalId]
      }

      if (!nextShips[id]) {
        nextShips[id] = { ...defaultShipState }
      }

      return {
        localPlayerId: id,
        shipsById: nextShips,
        ship: nextShips[id],
      }
    }),
  setLocalShipState: (partial) =>
    set((s) =>
      withLocalShipUpdate(s as GameStore, (ship) => ({ ...ship, ...partial }))
    ),
  upsertRemoteShips: (snapshot) =>
    set((s) => {
      const prevState = s as GameStore
      const localId = getLocalPlayerId(prevState)
      const nextShips: Record<string, GameStore['ship']> = {}
      Object.entries(snapshot).forEach(([id, remoteShip]) => {
        if (id === localId) {
          return
        }
        const prevShip = prevState.shipsById[id] ?? { ...defaultShipState }
        nextShips[id] = fromSnapshot(remoteShip, prevShip)
      })

      nextShips[localId] = prevState.shipsById[localId] ?? prevState.ship

      return {
        shipsById: nextShips,
        ship: nextShips[localId],
      }
    }),
  setShipState: (partial) =>
    set((s) =>
      withLocalShipUpdate(s as GameStore, (ship) => ({ ...ship, ...partial }))
    ),
  setTargetSpeed: (mps) =>
    set((s) =>
      withLocalShipUpdate(s as GameStore, (ship) => ({
        ...ship,
        targetSpeed: Math.max(0, Math.min(215, mps)),
      }))
    ),
  setMwdActive: (active) =>
    set((s) => {
      const state = s as GameStore
      const localId = getLocalPlayerId(state)
      const localShip = state.shipsById[localId] ?? state.ship
      if (!active) {
        const updated = {
          ...localShip,
          mwdActive: false,
          mwdRemaining: 0,
        }
        return {
          ship: updated,
          shipsById: {
            ...state.shipsById,
            [localId]: updated,
          },
        }
      }

      if (localShip.mwdActive) return {}
      if (localShip.mwdCooldownRemaining > 0) return {}

      const activationCost = localShip.capacitorMax * MWD_CAPACITOR_ACTIVATION_FRACTION
      if (localShip.capacitor < activationCost) return {}

      const updated = {
        ...localShip,
        mwdActive: true,
        mwdRemaining: 5,
        capacitor: Math.max(0, localShip.capacitor - activationCost),
      }

      return {
        ship: updated,
        shipsById: {
          ...state.shipsById,
          [localId]: updated,
        },
      }
    }),
  setMwdRemaining: (seconds) =>
    set((s) =>
      withLocalShipUpdate(s as GameStore, (ship) => ({
        ...ship,
        mwdRemaining: Math.max(0, seconds),
      }))
    ),
  setDampenersActive: (active) =>
    set((s) =>
      withLocalShipUpdate(s as GameStore, (ship) => ({ ...ship, dampenersActive: active }))
    ),
  setBearing: (deg) =>
    set((s) =>
      withLocalShipUpdate(s as GameStore, (ship) => ({
        ...ship,
        bearing: clampAngle(deg),
      }))
    ),
  setInclination: (deg) =>
    set((s) =>
      withLocalShipUpdate(s as GameStore, (ship) => ({
        ...ship,
        inclination: Math.max(-90, Math.min(90, deg)),
      }))
    ),
  setActualHeading: (deg) =>
    set((s) =>
      withLocalShipUpdate(s as GameStore, (ship) => ({
        ...ship,
        actualHeading: clampAngle(deg),
      }))
    ),
  setActualSpeed: (mps) =>
    set((s) =>
      withLocalShipUpdate(s as GameStore, (ship) => ({ ...ship, actualSpeed: Math.max(0, mps) }))
    ),
  setActualInclination: (deg) =>
    set((s) =>
      withLocalShipUpdate(s as GameStore, (ship) => ({
        ...ship,
        actualInclination: Math.max(-90, Math.min(90, deg)),
      }))
    ),
})
