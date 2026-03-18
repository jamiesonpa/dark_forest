import type { GameStore } from '@/state/types'
import type { RWRContact } from '@/types/game'
import { clamp } from '@/systems/simulation/lib/math'

export function updateNpcElectronicWarfare(
  state: GameStore,
  playerPosition: [number, number, number],
  playerHeading: number,
  _dt: number
) {
  const localId = state.localPlayerId
  const shipsById = state.shipsById
  const npcShips = state.npcShips
  const [playerX, , playerZ] = playerPosition
  const ewJammers = state.ewJammers
  const lockState = state.ewLockState

  const rwrContacts: RWRContact[] = []
  let lockChanged = false
  const cleanedLocks: Record<string, 'soft' | 'hard'> = {}

  for (const [id, ship] of Object.entries(shipsById)) {
    if (id === localId) continue
    if (ship.currentCelestialId !== state.currentCelestialId) continue

    const npcConfig = npcShips[id]
    const radarMode = npcConfig?.radarMode ?? 'off'

    const dx = ship.position[0] - playerX
    const dz = ship.position[2] - playerZ
    const range = Math.sqrt(dx * dx + dz * dz)
    const bearing = ((Math.atan2(-dx, dz) * 180) / Math.PI + 360) % 360

    if (radarMode === 'stt' || radarMode === 'scan') {
      const enemyFreq = radarMode === 'stt' ? 0.48 : 0.42
      const rangeKm = range / 1000

      const playerRCS = 22
      const rangeFactor = clamp(1 - rangeKm / 150, 0.05, 1)
      const rcsFactor = Math.pow(playerRCS, 0.25) / 2.2
      const modeFactor = radarMode === 'stt' ? 1.0 : 0.6
      const lockStrength = rangeFactor * rcsFactor * modeFactor

      let totalJamPower = 0
      for (const jammer of ewJammers) {
        if (!jammer.active || !jammer.mode) continue
        const freqDist = Math.abs(jammer.freq - enemyFreq)
        if (freqDist > 0.06) continue
        const overlap = clamp(1 - freqDist / 0.04, 0, 1)
        let effectiveness = 0
        if (jammer.mode === 'NJ') effectiveness = overlap * 0.5
        else if (jammer.mode === 'SJ') effectiveness = overlap * overlap * 0.8
        else if (jammer.mode === 'DRFM') effectiveness = overlap * 0.7
        else if (jammer.mode === 'RGPO') effectiveness = overlap * 0.4
        totalJamPower += effectiveness
      }

      const jammed = totalJamPower > lockStrength && radarMode === 'stt'
      const effectiveRadarMode = jammed ? 'scan' : radarMode

      if (jammed && npcConfig) {
        state.setNpcShipConfig(id, { radarMode: 'scan' })
      }

      const relElevation = Math.atan2(
        ship.position[1] - playerPosition[1],
        range
      ) * 180 / Math.PI

      rwrContacts.push({
        id,
        symbol: effectiveRadarMode === 'stt' ? 'S' : '2',
        bearing,
        relativeElevation: relElevation,
        priority: effectiveRadarMode === 'stt' ? 'critical' : 'high',
        newContact: false,
        signalStrength: clamp(1 - rangeKm / 200, 0.1, 1),
        sttLock: effectiveRadarMode === 'stt',
      })
    }

    if (lockState[id]) {
      const relativeBearing = ((bearing - playerHeading + 540) % 360) - 180
      if (Math.abs(relativeBearing) > 90) {
        lockChanged = true
      } else {
        cleanedLocks[id] = lockState[id]
      }
    }
  }

  for (const id of Object.keys(lockState)) {
    if (!shipsById[id] || id === localId) {
      lockChanged = true
    }
  }

  state.setRwrContacts(rwrContacts)

  if (lockChanged) {
    state.setEwLockState(() => cleanedLocks)
  }
}
