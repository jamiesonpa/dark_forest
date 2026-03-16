import { useCallback, useEffect, useState } from 'react'
import { AppSidebar } from '@/app/AppSidebar'
import { DebugSettingsPanelWindow } from '@/app/DebugSettingsPanelWindow'
import { ServerSettingsWindow } from '@/app/ServerSettingsWindow'
import { StarSystemConfigWindow, type StarSystemFormState } from '@/app/StarSystemConfigWindow'
import { StationLayers } from '@/app/StationLayers'
import { appRootStyle } from '@/app/styles'
import { useAppHotkeys } from '@/app/useAppHotkeys'
import { useMultiplayerLifecycle } from '@/app/useMultiplayerLifecycle'
import { multiplayerClient, type MultiplayerStatus } from '@/network/colyseusClient'
import { SimulationLoop } from '@/systems/simulation/SimulationLoop'
import { useGameStore } from '@/state/gameStore'
import {
  selectNavAttitudeMode,
  selectStarSystemConfig,
  selectStarSystemSeed,
} from '@/state/selectors'
import { StationSelector, type StationId } from '@/ui/stations/StationSelector'

function toWsUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return 'ws://localhost:2567'
  if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) return trimmed
  return `ws://${trimmed.includes(':') ? trimmed : `${trimmed}:2567`}`
}

function toFormState(seed: number, config: ReturnType<typeof selectStarSystemConfig>): StarSystemFormState {
  return {
    seed,
    planetCount: config.planetCount,
    moonCount: config.moonCount,
    asteroidBeltCount: config.asteroidBeltCount,
    minOrbitAu: config.minOrbitAu,
    maxOrbitAu: config.maxOrbitAu,
    minSeparationAu: config.minSeparationAu,
  }
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

  const starSystemSeed = useGameStore(selectStarSystemSeed)
  const starSystemConfig = useGameStore(selectStarSystemConfig)
  const navAttitudeMode = useGameStore(selectNavAttitudeMode)
  const setNavAttitudeMode = useGameStore((state) => state.setNavAttitudeMode)
  const setMwdActive = useGameStore((state) => state.setMwdActive)

  const [starSystemFormState, setStarSystemFormState] = useState<StarSystemFormState>(() =>
    toFormState(starSystemSeed, starSystemConfig)
  )

  useAppHotkeys({
    navAttitudeMode,
    setNavAttitudeMode,
    setMwdActive,
    setStation,
  })

  useMultiplayerLifecycle({
    setStatus,
    setStatusDetail,
  })

  useEffect(() => {
    setStarSystemFormState(toFormState(starSystemSeed, starSystemConfig))
  }, [starSystemConfig, starSystemSeed])

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

  const handleRegenerate = useCallback(() => {
    if (status !== 'connected') {
      setStatusDetail('Join multiplayer server first, then regenerate the system.')
      return
    }

    multiplayerClient.sendRegenerateSystem(starSystemFormState)
  }, [starSystemFormState, status])

  return (
    <div style={appRootStyle}>
      <SimulationLoop />
      <StationLayers station={station} />
      <StationSelector current={station} onSwitch={setStation} />
      <AppSidebar
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onOpenServerWindow={() => setServerWindowOpen(true)}
        onOpenStarSystemWindow={() => setStarSystemWindowOpen(true)}
        onOpenDebugWindow={() => setDebugWindowOpen(true)}
        status={status}
      />
      <ServerSettingsWindow
        open={serverWindowOpen}
        hostAddress={hostAddress}
        status={status}
        statusDetail={statusDetail}
        joinBusy={joinBusy}
        onClose={() => setServerWindowOpen(false)}
        onConnect={connectMultiplayer}
        onDisconnect={disconnectMultiplayer}
        onHostAddressChange={setHostAddress}
      />
      <StarSystemConfigWindow
        open={starSystemWindowOpen}
        status={status}
        activeSeed={starSystemSeed}
        formState={starSystemFormState}
        onClose={() => setStarSystemWindowOpen(false)}
        onChange={setStarSystemFormState}
        onRegenerate={handleRegenerate}
      />
      <DebugSettingsPanelWindow
        open={debugWindowOpen}
        onClose={() => setDebugWindowOpen(false)}
      />
    </div>
  )
}
