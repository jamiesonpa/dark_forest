import { useEffect } from 'react'
import type { StationId } from '@/ui/stations/StationSelector'
import { isEditableTarget } from '@/utils/dom'

type UseAppHotkeysOptions = {
  navAttitudeMode: 'AA' | 'DAC'
  setNavAttitudeMode: (mode: 'AA' | 'DAC') => void
  setMwdActive: (active: boolean) => void
  setStation: (station: StationId) => void
}

export function useAppHotkeys({
  navAttitudeMode,
  setNavAttitudeMode,
  setMwdActive,
  setStation,
}: UseAppHotkeysOptions) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault()
        setStation('pilot')
      }
      if (event.key === 'F2') {
        event.preventDefault()
        setStation('ew')
      }
      if (event.key === 'Backspace' && !isEditableTarget(event.target)) {
        event.preventDefault()
        setNavAttitudeMode(navAttitudeMode === 'DAC' ? 'AA' : 'DAC')
      }
      if (event.key === 'Enter' && !isEditableTarget(event.target)) {
        if (event.repeat) return
        event.preventDefault()
        setMwdActive(true)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [navAttitudeMode, setMwdActive, setNavAttitudeMode, setStation])
}
