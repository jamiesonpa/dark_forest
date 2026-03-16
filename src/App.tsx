import { useState, useEffect, useCallback } from 'react'
import { PilotStation } from '@/ui/stations/PilotStation'
import EWConsole from '@/systems/ew/EWConsole'
import { StationSelector, type StationId } from '@/ui/stations/StationSelector'
import { SimulationLoop } from '@/systems/simulation/SimulationLoop'
import { multiplayerClient, type MultiplayerStatus } from '@/network/colyseusClient'
import { useGameStore } from '@/state/gameStore'
import { DebugSettingsWindow } from '@/components/hud/DebugSettingsWindow'

const OFFLINE_LOCAL_PLAYER_ID = 'local-player'

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
  const [starSystemWindowOpen, setStarSystemWindowOpen] = useState(false)
  const [debugWindowOpen, setDebugWindowOpen] = useState(false)
  const setLocalPlayerId = useGameStore((s) => s.setLocalPlayerId)
  const upsertRemoteShips = useGameStore((s) => s.upsertRemoteShips)
  const setCurrentCelestial = useGameStore((s) => s.setCurrentCelestial)
  const setStarSystemSnapshot = useGameStore((s) => s.setStarSystemSnapshot)
  const starSystemSeed = useGameStore((s) => s.starSystemSeed)
  const starSystemConfig = useGameStore((s) => s.starSystemConfig)
  const navAttitudeMode = useGameStore((s) => s.navAttitudeMode)
  const setNavAttitudeMode = useGameStore((s) => s.setNavAttitudeMode)
  const setMwdActive = useGameStore((s) => s.setMwdActive)
  const [cfgSeed, setCfgSeed] = useState(starSystemSeed)
  const [cfgPlanets, setCfgPlanets] = useState(starSystemConfig.planetCount)
  const [cfgMoons, setCfgMoons] = useState(starSystemConfig.moonCount)
  const [cfgBelts, setCfgBelts] = useState(starSystemConfig.asteroidBeltCount)
  const [cfgMinAu, setCfgMinAu] = useState(starSystemConfig.minOrbitAu)
  const [cfgMaxAu, setCfgMaxAu] = useState(starSystemConfig.maxOrbitAu)
  const [cfgSepAu, setCfgSepAu] = useState(starSystemConfig.minSeparationAu)

  const stationLayerStyle = (stationId: StationId) => ({
    position: 'absolute' as const,
    inset: 0,
    visibility: station === stationId ? 'visible' as const : 'hidden' as const,
    pointerEvents: station === stationId ? 'auto' as const : 'none' as const,
    zIndex: station === stationId ? 1 : 0,
  })

  const handleKey = useCallback((e: KeyboardEvent) => {
    const isEditableElement = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      return (
        target.isContentEditable ||
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT'
      )
    }

    if (e.key === 'F1') { e.preventDefault(); setStation('pilot') }
    if (e.key === 'F2') { e.preventDefault(); setStation('ew') }
    if (e.key === 'Backspace' && !isEditableElement(e.target)) {
      e.preventDefault()
      setNavAttitudeMode(navAttitudeMode === 'DAC' ? 'AA' : 'DAC')
    }
    if (e.key === 'Enter' && !isEditableElement(e.target)) {
      if (e.repeat) return
      e.preventDefault()
      setMwdActive(true)
    }
  }, [navAttitudeMode, setNavAttitudeMode, setMwdActive])

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
    setCfgSeed(starSystemSeed)
    setCfgPlanets(starSystemConfig.planetCount)
    setCfgMoons(starSystemConfig.moonCount)
    setCfgBelts(starSystemConfig.asteroidBeltCount)
    setCfgMinAu(starSystemConfig.minOrbitAu)
    setCfgMaxAu(starSystemConfig.maxOrbitAu)
    setCfgSepAu(starSystemConfig.minSeparationAu)
  }, [starSystemConfig, starSystemSeed])

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
  }, [setCurrentCelestial, setLocalPlayerId, setStarSystemSnapshot, upsertRemoteShips])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <SimulationLoop />
      <div style={stationLayerStyle('pilot')}>
        <PilotStation />
      </div>
      <div style={stationLayerStyle('ew')}>
        <EWConsole />
      </div>
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
        <button
          onClick={() => setStarSystemWindowOpen(true)}
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
          <span>✦</span>
          <span>Star System Config</span>
        </button>
        <button
          onClick={() => setDebugWindowOpen(true)}
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
          <span>🧪</span>
          <span>Debug Settings</span>
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

      {starSystemWindowOpen && (
        <div
          style={{
            position: 'absolute',
            top: 90,
            left: 500,
            zIndex: 10000,
            width: 340,
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
            <strong>Star System Config</strong>
            <button
              onClick={() => setStarSystemWindowOpen(false)}
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' }}>
            <span>Seed</span>
            <input type="number" value={cfgSeed} onChange={(e) => setCfgSeed(Number(e.target.value) || 1)} />
            <span>Planets</span>
            <input type="number" value={cfgPlanets} onChange={(e) => setCfgPlanets(Number(e.target.value) || 0)} />
            <span>Moons</span>
            <input type="number" value={cfgMoons} onChange={(e) => setCfgMoons(Number(e.target.value) || 0)} />
            <span>Belts</span>
            <input type="number" value={cfgBelts} onChange={(e) => setCfgBelts(Number(e.target.value) || 0)} />
            <span>Min Orbit (AU)</span>
            <input type="number" value={cfgMinAu} onChange={(e) => setCfgMinAu(Number(e.target.value) || 0)} />
            <span>Max Orbit (AU)</span>
            <input type="number" value={cfgMaxAu} onChange={(e) => setCfgMaxAu(Number(e.target.value) || 0)} />
            <span>Min Separation (AU)</span>
            <input type="number" value={cfgSepAu} onChange={(e) => setCfgSepAu(Number(e.target.value) || 0)} />
          </div>
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Active seed: {starSystemSeed}</span>
            <button
              onClick={() => {
                if (status !== 'connected') {
                  setStatusDetail('Join multiplayer server first, then regenerate the system.')
                  return
                }
                multiplayerClient.sendRegenerateSystem({
                  seed: cfgSeed,
                  planetCount: cfgPlanets,
                  moonCount: cfgMoons,
                  asteroidBeltCount: cfgBelts,
                  minOrbitAu: cfgMinAu,
                  maxOrbitAu: cfgMaxAu,
                  minSeparationAu: cfgSepAu,
                })
              }}
              style={{ cursor: 'pointer' }}
            >
              Regenerate
            </button>
          </div>
        </div>
      )}
      {debugWindowOpen && (
        <div
          style={{
            position: 'absolute',
            top: 90,
            left: 860,
            zIndex: 10000,
            width: 340,
            maxHeight: '80vh',
            overflowY: 'auto',
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
            <strong>Debug Settings</strong>
            <button
              onClick={() => setDebugWindowOpen(false)}
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
          <DebugSettingsWindow />
        </div>
      )}
    </div>
  )
}
