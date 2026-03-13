export function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x))
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function shortestAngleDelta(current: number, target: number): number {
  return ((target - current + 540) % 360) - 180
}
