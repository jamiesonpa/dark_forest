import type { StateCreator } from 'zustand'
import type { GameStore } from '@/state/types'

export const createEwSlice: StateCreator<GameStore, [], [], Partial<GameStore>> = (set) => ({
  rwrContacts: [],
  ewLockState: {},
  ewIffState: {},
  ewRadarOn: false,
  ewRadarMode: 'RWS',
  ewRadarPower: 50,
  ewRadarFreq: 0.5,
  ewRadarPRF: 'MED',
  ewJammers: [
    { mode: null, active: false, freq: 0.2 },
    { mode: null, active: false, freq: 0.4 },
    { mode: null, active: false, freq: 0.6 },
    { mode: null, active: false, freq: 0.8 },
  ],
  setEwJammers: (jammers) => set({ ewJammers: jammers }),
  setEwLockState: (updater) =>
    set((s) => ({ ewLockState: updater(s.ewLockState) })),
  setEwIffState: (updater) =>
    set((s) => ({ ewIffState: updater(s.ewIffState) })),
  setEwRadar: (partial) =>
    set(() => ({
      ...(partial.radarOn !== undefined ? { ewRadarOn: partial.radarOn } : {}),
      ...(partial.radarMode !== undefined ? { ewRadarMode: partial.radarMode } : {}),
      ...(partial.radarPower !== undefined ? { ewRadarPower: partial.radarPower } : {}),
      ...(partial.radarFreq !== undefined ? { ewRadarFreq: partial.radarFreq } : {}),
      ...(partial.radarPRF !== undefined ? { ewRadarPRF: partial.radarPRF } : {}),
    })),
  setRwrContacts: (contacts) => set({ rwrContacts: contacts }),
})
