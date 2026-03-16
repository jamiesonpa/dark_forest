import type { GameStore } from '@/state/types'
import { clamp } from '@/systems/simulation/lib/math'

export function updateEnemyAndElectronicWarfare(
  state: GameStore,
  playerPosition: [number, number, number],
  playerHeading: number,
  dt: number
) {
  const enemy = state.enemy
  let enemyX = enemy.position[0]
  const enemyY = enemy.position[1]
  let enemyZ = enemy.position[2]

  if (enemy.speed > 0) {
    const hRad = (enemy.heading * Math.PI) / 180
    enemyX = enemy.position[0] + (-Math.sin(hRad) * enemy.speed * dt)
    enemyZ = enemy.position[2] + (-Math.cos(hRad) * enemy.speed * dt)
    state.setEnemyState({ position: [enemyX, enemyY, enemyZ] })
  }

  const [nextX, , nextZ] = playerPosition
  const rwrContacts = state.rwrContacts
  if (rwrContacts.length > 0) {
    const rdx = -(enemyX - nextX)
    const rdz = enemyZ - nextZ
    const enemyBearing = ((Math.atan2(rdx, rdz) * 180) / Math.PI + 360) % 360
    let changed = false
    const updated = rwrContacts.map((contact) => {
      if (contact.id === 'concord' || contact.id === 'missile') {
        if (Math.abs((contact.bearing ?? 0) - enemyBearing) > 0.5) {
          changed = true
          return { ...contact, bearing: enemyBearing }
        }
      }
      return contact
    })
    if (changed) state.setRwrContacts(updated)
  }

  const ewJammers = state.ewJammers
  if (enemy.radarMode === 'stt' || enemy.radarMode === 'scan') {
    const enemyFreq = enemy.radarMode === 'stt' ? 0.48 : 0.42
    const rangeKm = Math.sqrt(
      Math.pow(enemyX - nextX, 2) +
      Math.pow(enemyZ - nextZ, 2)
    ) / 1000

    const playerRCS = 22
    const rangeFactor = clamp(1 - rangeKm / 150, 0.05, 1)
    const rcsFactor = Math.pow(playerRCS, 0.25) / 2.2
    const modeFactor = enemy.radarMode === 'stt' ? 1.0 : 0.6
    const lockStrength = rangeFactor * rcsFactor * modeFactor

    let totalJamPower = 0
    ewJammers.forEach((jammer) => {
      if (!jammer.active || !jammer.mode) return
      const freqDist = Math.abs(jammer.freq - enemyFreq)
      if (freqDist > 0.06) return
      const overlap = clamp(1 - freqDist / 0.04, 0, 1)

      let effectiveness = 0
      if (jammer.mode === 'NJ') effectiveness = overlap * 0.5
      else if (jammer.mode === 'SJ') effectiveness = overlap * overlap * 0.8
      else if (jammer.mode === 'DRFM') effectiveness = overlap * 0.7
      else if (jammer.mode === 'RGPO') effectiveness = overlap * 0.4
      totalJamPower += effectiveness
    })

    if (totalJamPower > lockStrength && enemy.radarMode === 'stt') {
      state.setEnemyState({ radarMode: 'scan' })
      const currentRwr = state.rwrContacts
      if (currentRwr.length > 0) {
        state.setRwrContacts(currentRwr.map((contact) =>
          contact.id === 'concord'
            ? { ...contact, sttLock: false, symbol: '2' as const, newContact: false }
            : contact
        ))
      }
    }
  }

  const lockState = state.ewLockState
  if (Object.keys(lockState).length > 0) {
    const rdx = -(enemyX - nextX)
    const rdz = enemyZ - nextZ
    const enemyBearing = ((Math.atan2(rdx, rdz) * 180) / Math.PI + 360) % 360
    const relativeBearing = ((enemyBearing - playerHeading + 540) % 360) - 180
    if (Math.abs(relativeBearing) > 90) {
      const cleaned: Record<string, 'soft' | 'hard'> = {}
      let anyRemoved = false
      for (const [id, lock] of Object.entries(lockState)) {
        if (id === 'Σ') {
          anyRemoved = true
        } else {
          cleaned[id] = lock
        }
      }
      if (anyRemoved) {
        state.setEwLockState(() => cleaned)
      }
    }
  }

  return [enemyX, enemyY, enemyZ] as [number, number, number]
}
