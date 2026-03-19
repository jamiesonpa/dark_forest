import { useGameStore } from '@/state/gameStore'
import { MWD_SPEED } from '@/systems/simulation/constants'
import { clamp } from '@/systems/simulation/lib/math'

const CAPACITOR_DRAIN_TIME_AT_MAX_SPEED_SEC = 120
const CAPACITOR_RECHARGE_FRACTION_OF_MAX_DRAIN = 0.6
const CAPACITOR_RECHARGE_COUNTERMEASURES_OFF_MULTIPLIER = 1.1
const CAPACITOR_RECHARGE_DEW_OFF_MULTIPLIER = 1.1
const CAPACITOR_DAMPENERS_DRAIN_FRACTION_OF_MAX_DRAIN = 0.15
const MAX_SELECTED_SPEED = 215

export function EngineeringPanel() {
  const thermal = useGameStore((s) => s.ship.thermalSignature)
  const radio = useGameStore((s) => s.ship.radioSignature)
  const capacitorMax = useGameStore((s) => s.ship.capacitorMax)
  const ewUpperScannerOn = useGameStore((s) => s.ewUpperScannerOn)
  const ewLowerScannerOn = useGameStore((s) => s.ewLowerScannerOn)
  const irstCameraOn = useGameStore((s) => s.irstCameraOn)
  const countermeasuresPowered = useGameStore((s) => s.countermeasuresPowered)
  const dewPowered = useGameStore((s) => s.dewPowered)
  const ewRadarPower = useGameStore((s) => s.ewRadarPower)
  const targetSpeed = useGameStore((s) => s.ship.targetSpeed)
  const mwdActive = useGameStore((s) => s.ship.mwdActive)
  const dampenersActive = useGameStore((s) => s.ship.dampenersActive)
  const requestedSpeed = mwdActive ? MWD_SPEED : targetSpeed

  const thermalLevel =
    requestedSpeed > 100 || mwdActive ? 'high' : requestedSpeed > 30 ? 'med' : 'low'
  const dynamicThermal = thermal + requestedSpeed * 0.8
  const sensorSystemsOfflineCount =
    (ewUpperScannerOn ? 0 : 1) +
    (ewLowerScannerOn ? 0 : 1) +
    (irstCameraOn ? 0 : 1)
  const scannerRechargeBonus = 1 + clamp(sensorSystemsOfflineCount, 0, 3) * 0.1
  const radarPowerNorm = clamp(ewRadarPower, 0, 100) / 100
  const radarLowPowerRechargeBonus = 1 + (1 - radarPowerNorm) * 0.2
  const capacitorDrainPerSecondAtMaxSpeed = capacitorMax / CAPACITOR_DRAIN_TIME_AT_MAX_SPEED_SEC
  let baseRechargeFraction = countermeasuresPowered
    ? CAPACITOR_RECHARGE_FRACTION_OF_MAX_DRAIN
    : CAPACITOR_RECHARGE_FRACTION_OF_MAX_DRAIN * CAPACITOR_RECHARGE_COUNTERMEASURES_OFF_MULTIPLIER
  if (!dewPowered) {
    baseRechargeFraction *= CAPACITOR_RECHARGE_DEW_OFF_MULTIPLIER
  }
  const capRechargePerSecond =
    capacitorDrainPerSecondAtMaxSpeed
    * baseRechargeFraction
    * scannerRechargeBonus
    * radarLowPowerRechargeBonus
  const selectedSpeedRatio = clamp(requestedSpeed / MAX_SELECTED_SPEED, 0, 1)
  const capThrustDrainPerSecond = capacitorDrainPerSecondAtMaxSpeed * selectedSpeedRatio
  const capDampenersDrainPerSecond = dampenersActive
    ? capacitorDrainPerSecondAtMaxSpeed * CAPACITOR_DAMPENERS_DRAIN_FRACTION_OF_MAX_DRAIN
    : 0
  const capNetFlowPerSecond =
    capRechargePerSecond - capThrustDrainPerSecond - capDampenersDrainPerSecond
  const capNetMaxMagnitudePerSecond = Math.max(
    capRechargePerSecond,
    capThrustDrainPerSecond + capDampenersDrainPerSecond,
    1e-6
  )
  const capNetFlowPct = clamp((Math.abs(capNetFlowPerSecond) / capNetMaxMagnitudePerSecond) * 100, 0, 100)

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
        <div className="eng-row">
          <span className="eng-label">Cap Net Flow</span>
          <span
            className="eng-value"
            style={{ color: capNetFlowPerSecond >= 0 ? '#5fd7ff' : 'var(--hud-danger)' }}
          >
            {`${capNetFlowPerSecond >= 0 ? '+' : ''}${capNetFlowPerSecond.toFixed(2)} /s`}
          </span>
        </div>
        <div className="eng-bar-track">
          <div
            className="eng-bar-fill cap-recharge"
            style={{
              width: `${capNetFlowPct}%`,
              background: capNetFlowPerSecond >= 0 ? '#5fd7ff' : 'var(--hud-danger)',
            }}
          />
        </div>
      </div>
    </div>
  )
}
