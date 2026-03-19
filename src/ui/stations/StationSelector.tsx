export type StationId = 'pilot' | 'ew' | 'ws'

interface StationSelectorProps {
  current: StationId
  onSwitch: (id: StationId) => void
}

const STATIONS: { id: StationId; label: string; key: string }[] = [
  { id: 'pilot', label: 'PILOT', key: 'F1' },
  { id: 'ew', label: 'EW OFFICER', key: 'F2' },
  { id: 'ws', label: 'WS OFFICER', key: 'F3' },
]

export function StationSelector({ current, onSwitch }: StationSelectorProps) {
  return (
    <div className="station-selector">
      {STATIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`station-btn ${current === s.id ? 'active' : ''}`}
          onClick={() => onSwitch(s.id)}
        >
          <span className="station-key">{s.key}</span>
          <span className="station-name">{s.label}</span>
        </button>
      ))}
    </div>
  )
}
