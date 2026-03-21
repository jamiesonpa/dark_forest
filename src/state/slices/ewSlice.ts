import type { StateCreator } from 'zustand'
import type { GameStore } from '@/state/types'
import { B_SCOPE_AZ_LIMIT_DEG } from '@/systems/ew/bScopeConstants'

function dedupeCelestialIds(ids: string[]) {
  const seen = new Set<string>()
  const next: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string') continue
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    next.push(trimmed)
  }
  return next
}

export const createEwSlice: StateCreator<GameStore, [], [], Partial<GameStore>> = (set) => ({
  rwrContacts: [],
  ewLockState: {},
  ewIffState: {},
  ewRadarOn: false,
  ewRadarMode: 'RWS',
  ewRadarPower: 50,
  ewRadarFreq: 0.5,
  ewRadarFreqCommitted: 0.5,
  ewRadarPRF: 'MED',
  ewRadarTrackMode: 'TWS',
  ewUpperScannerOn: true,
  ewLowerScannerOn: true,
  ewRwrPowered: true,
  ewRwrVolume: 1,
  ewRwrMuted: false,
  irstCameraOn: true,
  ewActiveGravAnalysis: null,
  ewLastGravAnalysisResult: null,
  ewRevealedCelestialIds: [],
  ewRdneFieldEffect: null,
  ewRdneShipDrift: {},
  setEwRdneFieldEffect: (effect) => set({ ewRdneFieldEffect: effect }),
  setEwRdneShipDrift: (drift) => set({ ewRdneShipDrift: drift }),
  ewJammers: [
    { mode: null, active: false, freq: 0.2 },
    { mode: null, active: false, freq: 0.4 },
    { mode: null, active: false, freq: 0.6 },
    { mode: null, active: false, freq: 0.8 },
  ],
  setEwJammers: (jammers) => set({ ewJammers: jammers }),
  setEwUpperScannerOn: (on) => set({ ewUpperScannerOn: on }),
  setEwLowerScannerOn: (on) => set({ ewLowerScannerOn: on }),
  setEwRwrPowered: (on) => set({ ewRwrPowered: on }),
  setEwRwrVolume: (volume) =>
    set({
      ewRwrVolume: Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0)),
    }),
  setEwRwrMuted: (muted) => set({ ewRwrMuted: !!muted }),
  setIrstCameraOn: (on) => set({ irstCameraOn: on }),
  startEwGravAnalysis: (session) =>
    set({
      ewActiveGravAnalysis: session,
      ewLastGravAnalysisResult: null,
    }),
  completeEwGravAnalysis: () =>
    set((s) => {
      const session = s.ewActiveGravAnalysis
      if (!session) {
        return {}
      }

      return {
        ewActiveGravAnalysis: null,
        ewLastGravAnalysisResult: {
          celestialId: session.celestialId,
          completedAt: Date.now(),
          durationMs: session.durationMs,
          clarity: session.clarity,
        },
        ewRevealedCelestialIds: s.ewRevealedCelestialIds.includes(session.celestialId)
          ? s.ewRevealedCelestialIds
          : [...s.ewRevealedCelestialIds, session.celestialId],
      }
    }),
  cancelEwGravAnalysis: () => set({ ewActiveGravAnalysis: null }),
  revealEwCelestial: (celestialId) =>
    set((s) => ({
      ewRevealedCelestialIds: s.ewRevealedCelestialIds.includes(celestialId)
        ? s.ewRevealedCelestialIds
        : [...s.ewRevealedCelestialIds, celestialId],
    })),
  setEwRevealedCelestialIds: (celestialIds) =>
    set({
      ewRevealedCelestialIds: dedupeCelestialIds(celestialIds),
    }),
  setEwRadarTrackMode: (mode) => set({ ewRadarTrackMode: mode }),
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
      ...(partial.radarFreqCommitted !== undefined
        ? {
            ewRadarFreqCommitted: Math.max(
              0,
              Math.min(1, Number.isFinite(partial.radarFreqCommitted) ? partial.radarFreqCommitted : 0),
            ),
          }
        : {}),
      ...(partial.radarPRF !== undefined ? { ewRadarPRF: partial.radarPRF } : {}),
    })),
  setRwrContacts: (contacts) => set({ rwrContacts: contacts }),
  bScopeViewMinDeg: -B_SCOPE_AZ_LIMIT_DEG,
  bScopeViewMaxDeg: B_SCOPE_AZ_LIMIT_DEG,
  setBScopeView: (minDeg, maxDeg) => set({ bScopeViewMinDeg: minDeg, bScopeViewMaxDeg: maxDeg }),
})
