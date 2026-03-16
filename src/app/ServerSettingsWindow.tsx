import { AppWindow } from '@/app/AppWindow'
import type { MultiplayerStatus } from '@/network/colyseusClient'

interface ServerSettingsWindowProps {
  open: boolean
  hostAddress: string
  status: MultiplayerStatus
  statusDetail: string
  joinBusy: boolean
  onClose: () => void
  onConnect: () => void
  onDisconnect: () => void
  onHostAddressChange: (value: string) => void
}

export function ServerSettingsWindow({
  open,
  hostAddress,
  status,
  statusDetail,
  joinBusy,
  onClose,
  onConnect,
  onDisconnect,
  onHostAddressChange,
}: ServerSettingsWindowProps) {
  if (!open) return null

  return (
    <AppWindow title="Server Settings" left={190} width={300} onClose={onClose}>
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
          onChange={(event) => onHostAddressChange(event.target.value)}
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
          <button onClick={onDisconnect} style={{ cursor: 'pointer' }}>
            Leave
          </button>
        ) : (
          <button onClick={onConnect} disabled={joinBusy} style={{ cursor: 'pointer' }}>
            {joinBusy ? 'Joining...' : 'Join'}
          </button>
        )}
      </div>
      <div style={{ marginTop: 8 }}>Status: {status}</div>
      {statusDetail ? <div style={{ color: '#ffb3b3', marginTop: 4 }}>{statusDetail}</div> : null}
    </AppWindow>
  )
}
