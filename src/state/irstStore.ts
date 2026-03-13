import { create } from 'zustand'

interface IRSTStore {
  canvas: HTMLCanvasElement | null
  setCanvas: (c: HTMLCanvasElement) => void
}

export const useIRSTStore = create<IRSTStore>((set) => ({
  canvas: null,
  setCanvas: (c) => set({ canvas: c }),
}))
