import { useState, useEffect, useCallback } from 'react'
import { PilotStation } from '@/ui/stations/PilotStation'
import EWConsole from '@/systems/ew/EWConsole'
import { StationSelector, type StationId } from '@/ui/stations/StationSelector'
import { SimulationLoop } from '@/systems/simulation/SimulationLoop'
import { WarpDriver } from '@/systems/warp/WarpDriver'
import { multiplayerClient, type MultiplayerStatus } from '@/network/colyseusClient'
import { useGameStore } from '@/state/gameStore'

function toWsUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return 'ws://localhost:2567'
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) return trimmed
  return `ws://${trimmed.includes(':') ? trimmed : `${trimmed}:2567`}`
}

export default function App() {
  const [station, setStation] = useState<StationId>('pilot')
  const [hostAddress, setHostAddress] = useState('localhost:2567')
  const [status, setStatus] = useState<MultiplayerStatus>('disconnected')
  const [statusDetail, setStatusDetail] = useState('')
  const [joinBusy, setJoinBusy] = useState(false)
  const setLocalPlayerId = useGameStore((s) => s.setLocalPlayerId)
  const upsertRemoteShips = useGameStore((s) => s.upsertRemoteShips)

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'F1') { e.preventDefault(); setStation('pilot') }
    if (e.key === 'F2') { e.preventDefault(); setStation('ew') }
  }, [])

  const connectMultiplayer = useCallback(async () => {
    setJoinBusy(true)
    setStatusDetail('')
    try {
      await multiplayerClient.connect(toWsUrl(hostAddress))
    } catch (error) {
      setStatusDetail(error instanceof Error ? error.message : 'Connection failed')
    } finally {
      setJoinBusy(false)
    }
  }, [hostAddress])

  const disconnectMultiplayer = useCallback(() => {
    multiplayerClient.disconnect()
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  useEffect(() => {
    multiplayerClient.setHandlers({
      onStatusChange: (nextStatus, detail) => {
        setStatus(nextStatus)
        setStatusDetail(detail ?? '')
      },
      onJoined: (sessionId) => {
        setLocalPlayerId(sessionId)
      },
      onShipsUpdate: (ships) => {
        upsertRemoteShips(ships)
      },
    })
    return () => {
      multiplayerClient.disconnect()
    }
  }, [setLocalPlayerId, upsertRemoteShips])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <SimulationLoop />
      <WarpDriver />
      {station === 'pilot' && <PilotStation />}
      {station === 'ew' && <EWConsole />}
      <StationSelector current={station} onSwitch={setStation} />
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderRadius: 8,
          background: 'rgba(0, 0, 0, 0.55)',
          border: '1px solid rgba(160, 170, 200, 0.45)',
          color: '#d6dbf5',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 12,
        }}
      >
        <span>Server</span>
        <input
          value={hostAddress}
          onChange={(event) => setHostAddress(event.target.value)}
          placeholder="localhost:2567"
          style={{
            width: 150,
            background: 'rgba(10, 10, 12, 0.85)',
            color: '#f3f4ff',
            border: '1px solid rgba(200, 210, 255, 0.35)',
            borderRadius: 4,
            padding: '4px 6px',
          }}
        />
        {status === 'connected' ? (
          <button onClick={disconnectMultiplayer} style={{ cursor: 'pointer' }}>
            Leave
          </button>
        ) : (
          <button onClick={connectMultiplayer} disabled={joinBusy} style={{ cursor: 'pointer' }}>
            {joinBusy ? 'Joining...' : 'Join'}
          </button>
        )}
        <span>Status: {status}</span>
        {statusDetail ? <span style={{ color: '#ffb3b3' }}>{statusDetail}</span> : null}
      </div>
    </div>
  )
}
