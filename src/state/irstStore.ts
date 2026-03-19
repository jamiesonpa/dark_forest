import { create } from 'zustand'

interface IRSTStore {
  canvas: HTMLCanvasElement | null
  stabilized: boolean
  pointTrackEnabled: boolean
  pointTrackTargetId: string | null
  setCanvas: (c: HTMLCanvasElement) => void
  setStabilized: (stabilized: boolean) => void
  setPointTrackEnabled: (enabled: boolean) => void
  setPointTrackTargetId: (targetId: string | null) => void
}

export const useIRSTStore = create<IRSTStore>((set) => ({
  canvas: null,
  stabilized: true,
  pointTrackEnabled: false,
  pointTrackTargetId: null,
  setCanvas: (c) => set({ canvas: c }),
  setStabilized: (stabilized) => set({ stabilized }),
  setPointTrackEnabled: (enabled) => set({ pointTrackEnabled: enabled }),
  setPointTrackTargetId: (targetId) => set({ pointTrackTargetId: targetId }),
}))
