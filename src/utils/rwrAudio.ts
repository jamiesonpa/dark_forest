let audioCtx: AudioContext | null = null
let isMuted = false
let masterVolume = 0.5

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

export function setMuted(muted: boolean) {
  isMuted = muted
}

export function setVolume(v: number) {
  masterVolume = Math.max(0, Math.min(1, v))
}

let lockInterval: ReturnType<typeof setInterval> | null = null

function playChirp() {
  if (isMuted) return
  const ctx = getCtx()
  const now = ctx.currentTime

  const osc1 = ctx.createOscillator()
  const osc2 = ctx.createOscillator()
  const gain = ctx.createGain()

  osc1.type = 'square'
  osc1.frequency.setValueAtTime(2800, now)
  osc1.frequency.setValueAtTime(3400, now + 0.04)

  osc2.type = 'square'
  osc2.frequency.setValueAtTime(1400, now)
  osc2.frequency.setValueAtTime(1700, now + 0.04)

  gain.gain.setValueAtTime(0.06 * masterVolume, now)
  gain.gain.linearRampToValueAtTime(0.075 * masterVolume, now + 0.02)
  gain.gain.linearRampToValueAtTime(0, now + 0.08)

  osc1.connect(gain)
  osc2.connect(gain)
  gain.connect(ctx.destination)

  osc1.start(now)
  osc2.start(now)
  osc1.stop(now + 0.08)
  osc2.stop(now + 0.08)
}

export function startLockTone() {
  if (lockInterval) return
  playChirp()
  lockInterval = setInterval(playChirp, 250)
}

export function stopLockTone() {
  if (lockInterval) {
    clearInterval(lockInterval)
    lockInterval = null
  }
}

export function playNewContactTone() {
  if (isMuted) return
  const ctx = getCtx()
  const now = ctx.currentTime

  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.setValueAtTime(1800, now)
  osc.frequency.linearRampToValueAtTime(1200, now + 0.15)

  gain.gain.setValueAtTime(0.04 * masterVolume, now)
  gain.gain.linearRampToValueAtTime(0.05 * masterVolume, now + 0.03)
  gain.gain.linearRampToValueAtTime(0, now + 0.15)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(now)
  osc.stop(now + 0.15)

  const osc2 = ctx.createOscillator()
  const gain2 = ctx.createGain()

  osc2.type = 'sine'
  osc2.frequency.setValueAtTime(1600, now + 0.2)
  osc2.frequency.linearRampToValueAtTime(1000, now + 0.35)

  gain2.gain.setValueAtTime(0, now)
  gain2.gain.setValueAtTime(0.035 * masterVolume, now + 0.2)
  gain2.gain.linearRampToValueAtTime(0, now + 0.35)

  osc2.connect(gain2)
  gain2.connect(ctx.destination)

  osc2.start(now + 0.2)
  osc2.stop(now + 0.35)
}

let missileInterval: ReturnType<typeof setInterval> | null = null

function playMissileHorn() {
  if (isMuted) return
  const ctx = getCtx()
  const now = ctx.currentTime

  const osc1 = ctx.createOscillator()
  const osc2 = ctx.createOscillator()
  const osc3 = ctx.createOscillator()
  const gain = ctx.createGain()

  osc1.type = 'sawtooth'
  osc1.frequency.setValueAtTime(400, now)
  osc1.frequency.linearRampToValueAtTime(500, now + 0.3)
  osc1.frequency.linearRampToValueAtTime(400, now + 0.6)

  osc2.type = 'sawtooth'
  osc2.frequency.setValueAtTime(800, now)
  osc2.frequency.linearRampToValueAtTime(1000, now + 0.3)
  osc2.frequency.linearRampToValueAtTime(800, now + 0.6)

  osc3.type = 'square'
  osc3.frequency.setValueAtTime(200, now)
  osc3.frequency.linearRampToValueAtTime(250, now + 0.3)
  osc3.frequency.linearRampToValueAtTime(200, now + 0.6)

  gain.gain.setValueAtTime(0.07 * masterVolume, now)
  gain.gain.linearRampToValueAtTime(0.09 * masterVolume, now + 0.15)
  gain.gain.linearRampToValueAtTime(0.07 * masterVolume, now + 0.3)
  gain.gain.linearRampToValueAtTime(0.09 * masterVolume, now + 0.45)
  gain.gain.linearRampToValueAtTime(0, now + 0.6)

  osc1.connect(gain)
  osc2.connect(gain)
  osc3.connect(gain)
  gain.connect(ctx.destination)

  osc1.start(now)
  osc2.start(now)
  osc3.start(now)
  osc1.stop(now + 0.65)
  osc2.stop(now + 0.65)
  osc3.stop(now + 0.65)
}

export function startMissileAlarm() {
  if (missileInterval) return
  playMissileHorn()
  missileInterval = setInterval(playMissileHorn, 800)
}

export function stopMissileAlarm() {
  if (missileInterval) {
    clearInterval(missileInterval)
    missileInterval = null
  }
}

export function playDeceptionTone() {
  if (isMuted) return
  const ctx = getCtx()
  const now = ctx.currentTime

  const notes = [
    { freq: 1600, start: 0, dur: 0.1 },
    { freq: 800, start: 0.12, dur: 0.18 },
    { freq: 600, start: 0.35, dur: 0.12 },
    { freq: 900, start: 0.5, dur: 0.08 },
    { freq: 500, start: 0.6, dur: 0.2 },
  ]

  for (const n of notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(n.freq, now + n.start)
    osc.frequency.linearRampToValueAtTime(n.freq * 0.7, now + n.start + n.dur)
    gain.gain.setValueAtTime(0, now)
    gain.gain.setValueAtTime(0.05 * masterVolume, now + n.start)
    gain.gain.linearRampToValueAtTime(0, now + n.start + n.dur)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now + n.start)
    osc.stop(now + n.start + n.dur + 0.01)
  }
}
