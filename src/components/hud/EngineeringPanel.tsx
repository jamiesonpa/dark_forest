import { useGameStore } from '@/state/gameStore'
import { MWD_SPEED } from '@/systems/simulation/constants'

export function EngineeringPanel() {
  const thermal = useGameStore((s) => s.ship.thermalSignature)
  const radio = useGameStore((s) => s.ship.radioSignature)
  const targetSpeed = useGameStore((s) => s.ship.targetSpeed)
  const mwdActive = useGameStore((s) => s.ship.mwdActive)
  const requestedSpeed = mwdActive ? MWD_SPEED : targetSpeed

  const thermalLevel =
    requestedSpeed > 100 || mwdActive ? 'high' : requestedSpeed > 30 ? 'med' : 'low'
  const dynamicThermal = thermal + requestedSpeed * 0.8

  return (
    <div className="hud-panel engineering-panel">
      <div className="hud-panel-title">Engineering</div>
      <div className="eng-readings">
        <div className="eng-row">
          <span className="eng-label">Thermal Sig</span>
          <span className={`eng-value thermal-${thermalLevel}`}>
            {Math.round(dynamicThermal)} K
          </span>
        </div>
        <div className="eng-bar-track">
          <div
            className={`eng-bar-fill thermal-${thermalLevel}`}
            style={{ width: `${Math.min(100, (dynamicThermal / 600) * 100)}%` }}
          />
        </div>
        <div className="eng-row">
          <span className="eng-label">Radio Sig</span>
          <span className="eng-value">
            {radio.toFixed(1)} dB
          </span>
        </div>
        <div className="eng-bar-track">
          <div
            className="eng-bar-fill radio"
            style={{ width: `${Math.min(100, ((radio + 80) / 80) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
