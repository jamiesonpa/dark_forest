import { useEffect, useRef } from 'react'
import { useGameStore } from '@/state/gameStore'

const ALIGN_DURATION_MS = 2500
const WARP_DURATION_MS = 4500
const LANDING_DURATION_MS = 800

export function WarpDriver() {
  const { warpState, warpTargetId, setWarpState, finishWarp } = useGameStore()
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    if (warpState !== 'aligning' && warpState !== 'warping') return
    if (!warpTargetId) return

    const clearAll = () => {
      timeoutsRef.current.forEach((t) => clearTimeout(t))
      timeoutsRef.current = []
    }

    if (warpState === 'aligning') {
      const t = setTimeout(() => {
        setWarpState('warping', warpTargetId)
      }, ALIGN_DURATION_MS)
      timeoutsRef.current.push(t)
    } else if (warpState === 'warping') {
      const t = setTimeout(() => {
        setWarpState('landing', warpTargetId)
        const landingTimer = setTimeout(() => finishWarp(), LANDING_DURATION_MS)
        timeoutsRef.current.push(landingTimer)
      }, WARP_DURATION_MS)
      timeoutsRef.current.push(t)
    }

    return clearAll
  }, [warpState, warpTargetId, setWarpState, finishWarp])

  return null
}
