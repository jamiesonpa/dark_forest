import { create } from 'zustand'

interface EwTvStore {
  canvas: HTMLCanvasElement | null
  /** Number of UIs (WS MFD, EW MFD, …) that want the orbit feed rendered. */
  tvConsumers: number
  setCanvas: (c: HTMLCanvasElement | null) => void
  acquireTv: () => void
  releaseTv: () => void
}

export const useEwTvStore = create<EwTvStore>((set, get) => ({
  canvas: null,
  tvConsumers: 0,
  setCanvas: (c) => set({ canvas: c }),
  acquireTv: () => set({ tvConsumers: get().tvConsumers + 1 }),
  releaseTv: () => set({ tvConsumers: Math.max(0, get().tvConsumers - 1) }),
}))

/** 16:9 offscreen capture; larger than IRST so chaff / torpedoes / beams stay visible on the MFD. */
export const EW_ORBIT_FEED_W = 640
export const EW_ORBIT_FEED_H = 360
