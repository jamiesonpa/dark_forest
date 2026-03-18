import { ShipStatusPrototype } from './ShipStatusPrototype'
import { ShipAttitudePanel } from './ShipAttitudePanel'
import { DacFlightHud } from './DacFlightHud'
import { IRSTView } from './IRSTView'
import { EngineeringPanel } from './EngineeringPanel'
import { RWRDisplay } from './RWRDisplay'
import { LaunchControl } from './LaunchControl'
import { useGameStore } from '@/state/gameStore'

export function HUD() {
  const navAttitudeMode = useGameStore((s) => s.navAttitudeMode)

  return (
    <div className="hud-container">
      <div className="hud-top-left">
        <IRSTView />
      </div>
      <div className="hud-left-eng">
        <EngineeringPanel />
      </div>
      <LaunchControl />
      <div className="hud-bottom">
        <div className={`hud-bottom-status-row ${navAttitudeMode === 'DAC' ? 'dac-mode' : ''}`.trim()}>
          <ShipStatusPrototype />
        </div>
      </div>
      <div className="hud-nav-solution-bottom-right">
        <ShipAttitudePanel />
      </div>
      <DacFlightHud />
      <div className="hud-bottom-right">
        <RWRDisplay />
      </div>
    </div>
  )
}
