import { useEffect } from 'react'
import { multiplayerClient, type MultiplayerStatus } from '@/network/colyseusClient'
import { useGameStore } from '@/state/gameStore'
import type { OrdnanceSnapshotMessage } from '../../shared/contracts/multiplayer'

const OFFLINE_LOCAL_PLAYER_ID = 'local-player'

type UseMultiplayerLifecycleOptions = {
  setStatus: (status: MultiplayerStatus) => void
  setStatusDetail: (detail: string) => void
}

export function useMultiplayerLifecycle({
  setStatus,
  setStatusDetail,
}: UseMultiplayerLifecycleOptions) {
  const setLocalPlayerId = useGameStore((state) => state.setLocalPlayerId)
  const upsertRemoteShips = useGameStore((state) => state.upsertRemoteShips)
  const setRemoteOrdnanceSnapshot = useGameStore((state) => state.setRemoteOrdnanceSnapshot)
  const clearRemoteOrdnance = useGameStore((state) => state.clearRemoteOrdnance)
  const setCurrentCelestial = useGameStore((state) => state.setCurrentCelestial)
  const setEwRevealedCelestialIds = useGameStore((state) => state.setEwRevealedCelestialIds)
  const setStarSystemSnapshot = useGameStore((state) => state.setStarSystemSnapshot)

  useEffect(() => {
    multiplayerClient.setHandlers({
      onStatusChange: (nextStatus, detail) => {
        setStatus(nextStatus)
        setStatusDetail(detail ?? '')
        if (nextStatus !== 'connected') {
          setLocalPlayerId(OFFLINE_LOCAL_PLAYER_ID)
          upsertRemoteShips({})
          clearRemoteOrdnance()
        }
      },
      onJoined: (sessionId) => {
        setLocalPlayerId(sessionId)
      },
      onShipsUpdate: (ships) => {
        upsertRemoteShips(ships)
        const state = useGameStore.getState()
        const localShip = ships[state.localPlayerId]
        if (Array.isArray(localShip?.revealedCelestialIds)) {
          const mergedRevealedCelestialIds = Array.from(
            new Set([
              ...state.ewRevealedCelestialIds,
              ...localShip.revealedCelestialIds,
              localShip.currentCelestialId,
            ])
          )
          const revealChanged =
            mergedRevealedCelestialIds.length !== state.ewRevealedCelestialIds.length
            || mergedRevealedCelestialIds.some((id, index) => state.ewRevealedCelestialIds[index] !== id)
          if (revealChanged) {
            setEwRevealedCelestialIds(mergedRevealedCelestialIds)
          }
        }
        if (
          localShip?.currentCelestialId &&
          state.warpState === 'idle' &&
          localShip.currentCelestialId !== state.currentCelestialId
        ) {
          setCurrentCelestial(localShip.currentCelestialId)
        }
      },
      onOrdnanceUpdate: (snapshot) => {
        const localPlayerId = useGameStore.getState().localPlayerId
        const remoteOnlySnapshot = Object.fromEntries(
          Object.entries(snapshot).filter(([sessionId]) => sessionId !== localPlayerId)
        ) as OrdnanceSnapshotMessage
        setRemoteOrdnanceSnapshot(remoteOnlySnapshot)
      },
      onStarSystemUpdate: (snapshot) => {
        setStarSystemSnapshot(snapshot)
      },
    })

    return () => {
      multiplayerClient.disconnect()
    }
  }, [clearRemoteOrdnance, setCurrentCelestial, setEwRevealedCelestialIds, setLocalPlayerId, setRemoteOrdnanceSnapshot, setStarSystemSnapshot, setStatus, setStatusDetail, upsertRemoteShips])
}
