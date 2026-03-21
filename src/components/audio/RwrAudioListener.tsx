import { useEffect, useRef } from 'react'
import { useGameStore } from '@/state/gameStore'
import { hasIncomingEnemyTorpedoesForLocalPlayer } from '@/systems/ew/rwrIncomingTorpedoes'
import {
  playNewContactTone,
  setRwrReceiverPowered,
  setVolume,
  startLockTone,
  startTorpedoWarnTone,
  stopLockTone,
  stopTorpedoWarnTone,
} from '@/utils/rwrAudio'

/**
 * Single subscription for RWR Web Audio cues (avoids duplicate SFX when both pilot HUD and EW embed `RWRDisplay`).
 */
export function RwrAudioListener() {
  const rwrContacts = useGameStore((s) => s.rwrContacts)
  const launchedCylinders = useGameStore((s) => s.launchedCylinders)
  const remoteLaunchedCylinders = useGameStore((s) => s.remoteLaunchedCylinders)
  const localPlayerId = useGameStore((s) => s.localPlayerId)
  const shipsById = useGameStore((s) => s.shipsById)
  const ship = useGameStore((s) => s.ship)
  const currentCelestialId = useGameStore((s) => s.currentCelestialId)
  const ewRwrPowered = useGameStore((s) => s.ewRwrPowered)
  const ewRwrVolume = useGameStore((s) => s.ewRwrVolume)
  const ewRwrMuted = useGameStore((s) => s.ewRwrMuted)

  const prevIdsRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    setRwrReceiverPowered(ewRwrPowered)
    const effectiveVolume = ewRwrMuted ? 0 : ewRwrVolume
    setVolume(effectiveVolume)

    if (!ewRwrPowered) {
      prevIdsRef.current = null
      stopLockTone()
      stopTorpedoWarnTone()
      return
    }

    const ids = new Set(rwrContacts.map((c) => c.id))
    if (prevIdsRef.current !== null && effectiveVolume > 0) {
      for (const id of ids) {
        if (!prevIdsRef.current.has(id)) {
          playNewContactTone()
        }
      }
    }
    prevIdsRef.current = new Set(ids)

    const incomingTorpedo = hasIncomingEnemyTorpedoesForLocalPlayer({
      launchedCylinders,
      remoteLaunchedCylinders,
      localPlayerId,
      shipsById,
      ship,
      currentCelestialId,
    })

    const anyLock = rwrContacts.some((c) => c.sttLock)
    if (incomingTorpedo && effectiveVolume > 0) {
      startTorpedoWarnTone()
    } else {
      stopTorpedoWarnTone()
      if (anyLock && effectiveVolume > 0) {
        startLockTone()
      } else {
        stopLockTone()
      }
    }
  }, [
    rwrContacts,
    launchedCylinders,
    remoteLaunchedCylinders,
    localPlayerId,
    shipsById,
    ship,
    currentCelestialId,
    ewRwrPowered,
    ewRwrVolume,
    ewRwrMuted,
  ])

  return null
}
