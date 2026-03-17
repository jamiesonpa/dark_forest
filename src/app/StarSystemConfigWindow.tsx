import { AppWindow } from '@/app/AppWindow'
import type { MultiplayerStatus } from '@/network/colyseusClient'

export interface StarSystemFormState {
  seed: number
  planetCount: number
  asteroidBeltCount: number
  minOrbitAu: number
  maxOrbitAu: number
  minSeparationAu: number
}

interface StarSystemConfigWindowProps {
  open: boolean
  status: MultiplayerStatus
  activeSeed: number
  formState: StarSystemFormState
  onClose: () => void
  onChange: (nextState: StarSystemFormState) => void
  onRegenerate: () => void
}

export function StarSystemConfigWindow({
  open,
  status,
  activeSeed,
  formState,
  onClose,
  onChange,
  onRegenerate,
}: StarSystemConfigWindowProps) {
  if (!open) return null

  const updateField = <K extends keyof StarSystemFormState>(key: K, value: number) => {
    onChange({
      ...formState,
      [key]: value,
    })
  }

  return (
    <AppWindow title="Star System Config" left={500} width={340} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'center' }}>
        <span>Seed</span>
        <input type="number" value={formState.seed} onChange={(event) => updateField('seed', Number(event.target.value) || 1)} />
        <span>Planets</span>
        <input
          type="number"
          value={formState.planetCount}
          onChange={(event) => updateField('planetCount', Number(event.target.value) || 0)}
        />
        <span>Belts</span>
        <input
          type="number"
          value={formState.asteroidBeltCount}
          onChange={(event) => updateField('asteroidBeltCount', Number(event.target.value) || 0)}
        />
        <span>Min Orbit (AU)</span>
        <input
          type="number"
          value={formState.minOrbitAu}
          onChange={(event) => updateField('minOrbitAu', Number(event.target.value) || 0)}
        />
        <span>Max Orbit (AU)</span>
        <input
          type="number"
          value={formState.maxOrbitAu}
          onChange={(event) => updateField('maxOrbitAu', Number(event.target.value) || 0)}
        />
        <span>Min Separation (AU)</span>
        <input
          type="number"
          value={formState.minSeparationAu}
          onChange={(event) => updateField('minSeparationAu', Number(event.target.value) || 0)}
        />
      </div>
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Active seed: {activeSeed}</span>
        <button onClick={onRegenerate} disabled={status !== 'connected'} style={{ cursor: 'pointer' }}>
          Regenerate
        </button>
      </div>
    </AppWindow>
  )
}
