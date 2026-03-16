import { PilotStation } from '@/ui/stations/PilotStation'
import { type StationId } from '@/ui/stations/StationSelector'
import { EWStation } from '@/ui/stations/EWStation'

interface StationLayersProps {
  station: StationId
}

const stationLayerStyle = (station: StationId, stationId: StationId) => ({
  position: 'absolute' as const,
  inset: 0,
  visibility: station === stationId ? 'visible' as const : 'hidden' as const,
  pointerEvents: station === stationId ? 'auto' as const : 'none' as const,
  zIndex: station === stationId ? 1 : 0,
})

export function StationLayers({ station }: StationLayersProps) {
  return (
    <>
      <div style={stationLayerStyle(station, 'pilot')}>
        <PilotStation />
      </div>
      <div style={stationLayerStyle(station, 'ew')}>
        <EWStation />
      </div>
    </>
  )
}
