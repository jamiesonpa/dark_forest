import { useEffect } from 'react'
import { multiplayerClient, type MultiplayerStatus } from '@/network/colyseusClient'
import { useGameStore } from '@/state/gameStore'

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
  const setCurrentCelestial = useGameStore((state) => state.setCurrentCelestial)
  const setStarSystemSnapshot = useGameStore((state) => state.setStarSystemSnapshot)

  useEffect(() => {
    multiplayerClient.setHandlers({
      onStatusChange: (nextStatus, detail) => {
        setStatus(nextStatus)
        setStatusDetail(detail ?? '')
        if (nextStatus !== 'connected') {
          setLocalPlayerId(OFFLINE_LOCAL_PLAYER_ID)
          upsertRemoteShips({})
        }
      },
      onJoined: (sessionId) => {
        setLocalPlayerId(sessionId)
      },
      onShipsUpdate: (ships) => {
        upsertRemoteShips(ships)
        const state = useGameStore.getState()
        const localShip = ships[state.localPlayerId]
        if (
          localShip?.currentCelestialId &&
          state.warpState === 'idle' &&
          localShip.currentCelestialId !== state.currentCelestialId
        ) {
          setCurrentCelestial(localShip.currentCelestialId)
        }
      },
      onStarSystemUpdate: (snapshot) => {
        setStarSystemSnapshot(snapshot)
      },
    })

    return () => {
      multiplayerClient.disconnect()
    }
  }, [setCurrentCelestial, setLocalPlayerId, setStarSystemSnapshot, setStatus, setStatusDetail, upsertRemoteShips])
}
