import { useState, useEffect, useCallback, useRef } from 'react'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const [serverWindowOpen, setServerWindowOpen] = useState(false)
  const setLocalPlayerId = useGameStore((s) => s.setLocalPlayerId)
  const upsertRemoteShips = useGameStore((s) => s.upsertRemoteShips)
  const autoJoinAttemptedRef = useRef(false)

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

  useEffect(() => {
    // Ensure the local client joins by default so remote peers become visible immediately.
    if (autoJoinAttemptedRef.current) return
    if (status !== 'disconnected') return
    autoJoinAttemptedRef.current = true
    void connectMultiplayer()
  }, [status, connectMultiplayer])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <SimulationLoop />
      <WarpDriver />
      {station === 'pilot' && <PilotStation />}
      {station === 'ew' && <EWConsole />}
      <StationSelector current={station} onSwitch={setStation} />
      <button
        onClick={() => setMenuOpen((open) => !open)}
        style={{
          position: 'absolute',
          top: 16,
          left: 10,
          zIndex: 9999,
          width: 32,
          height: 32,
          borderRadius: 6,
          border: '1px solid rgba(160, 170, 200, 0.45)',
          background: 'rgba(0, 0, 0, 0.65)',
          color: '#d6dbf5',
          cursor: 'pointer',
        }}
      >
        {menuOpen ? '<' : '>'}
      </button>

      <div
        style={{
          position: 'absolute',
          top: 0,
          left: menuOpen ? 0 : -170,
          zIndex: 9998,
          width: 160,
          height: '100%',
          transition: 'left 180ms ease',
          background: 'rgba(0, 0, 0, 0.62)',
          borderRight: '1px solid rgba(160, 170, 200, 0.35)',
          paddingTop: 60,
          paddingLeft: 12,
          paddingRight: 12,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <button
          onClick={() => setServerWindowOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid rgba(160, 170, 200, 0.45)',
            background: 'rgba(10, 10, 12, 0.85)',
            color: '#d6dbf5',
            cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 12,
          }}
        >
          <span>⚙</span>
          <span>Server</span>
        </button>
        <span style={{ color: '#d6dbf5', fontFamily: 'system-ui, sans-serif', fontSize: 12 }}>
          Status: {status}
        </span>
      </div>

      {serverWindowOpen && (
        <div
          style={{
            position: 'absolute',
            top: 90,
            left: 190,
            zIndex: 10000,
            width: 300,
            borderRadius: 10,
            background: 'rgba(8, 10, 16, 0.95)',
            border: '1px solid rgba(160, 170, 200, 0.5)',
            color: '#d6dbf5',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 12,
            boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
            padding: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
            }}
          >
            <strong>Server Settings</strong>
            <button
              onClick={() => setServerWindowOpen(false)}
              style={{
                borderRadius: 4,
                border: '1px solid rgba(200, 210, 255, 0.35)',
                background: 'rgba(20, 20, 24, 0.9)',
                color: '#f3f4ff',
                cursor: 'pointer',
                width: 24,
                height: 24,
              }}
            >
              x
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
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
          </div>
          <div style={{ marginTop: 8 }}>Status: {status}</div>
          {statusDetail ? <div style={{ color: '#ffb3b3', marginTop: 4 }}>{statusDetail}</div> : null}
        </div>
      )}
    </div>
  )
}
