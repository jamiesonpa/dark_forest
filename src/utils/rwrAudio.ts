let audioCtx: AudioContext | null = null
let isMuted = false
/** RWR slider 0…1 — scales new-contact and lock tones. */
let masterVolume = 0.5
/** RWR hardware power (EW / pilot); when false, no RWR tones. */
let rwrReceiverPowered = true

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

export function setRwrReceiverPowered(powered: boolean) {
  rwrReceiverPowered = powered
}

const RWR_NEW_HZ = 465
const RWR_LOCK_HZ_A = 575
const RWR_LOCK_HZ_B = 375
const RWR_NEW_BEEP_S = 0.35
const RWR_LOCK_BEEP_S = 0.25
/** Peak gain at volume=1 (sine); scaled by `masterVolume`. */
const RWR_SINE_PEAK = 0.08

function playRwrSineBeep(freqHz: number, durationSec: number) {
  if (!rwrReceiverPowered || masterVolume <= 0) return
  const ctx = getCtx()
  void ctx.resume()
  const now = ctx.currentTime
  const peak = RWR_SINE_PEAK * masterVolume
  const attack = Math.min(0.004, durationSec * 0.1)
  const release = Math.min(0.02, durationSec * 0.15)

  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freqHz, now)

  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(peak, now + attack)
  const holdEnd = Math.max(now + attack, now + durationSec - release)
  gain.gain.setValueAtTime(peak, holdEnd)
  gain.gain.linearRampToValueAtTime(0, now + durationSec)

  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + durationSec + 0.02)
}

let lockInterval: ReturnType<typeof setInterval> | null = null
let lockPhase = 0

function playAlternatingLockBeep() {
  const freq = lockPhase % 2 === 0 ? RWR_LOCK_HZ_A : RWR_LOCK_HZ_B
  lockPhase += 1
  playRwrSineBeep(freq, RWR_LOCK_BEEP_S)
}

/** Alternating 575 Hz / 375 Hz beeps, 0.25 s each, while lock is active. */
export function startLockTone() {
  stopTorpedoWarnTone()
  if (lockInterval) return
  lockPhase = 0
  playAlternatingLockBeep()
  lockInterval = setInterval(playAlternatingLockBeep, RWR_LOCK_BEEP_S * 1000)
}

export function stopLockTone() {
  if (lockInterval) {
    clearInterval(lockInterval)
    lockInterval = null
  }
  lockPhase = 0
}

const RWR_TORP_WARN_BEEP_S = 0.1

let torpWarnInterval: ReturnType<typeof setInterval> | null = null
let torpWarnPhase = 0

function playAlternatingTorpWarnBeep() {
  const freq = torpWarnPhase % 2 === 0 ? RWR_LOCK_HZ_A : RWR_LOCK_HZ_B
  torpWarnPhase += 1
  playRwrSineBeep(freq, RWR_TORP_WARN_BEEP_S)
}

/** Alternating 575 Hz / 375 Hz, 0.1 s each, while an enemy torpedo is homing on you. */
export function startTorpedoWarnTone() {
  stopLockTone()
  if (torpWarnInterval) return
  torpWarnPhase = 0
  playAlternatingTorpWarnBeep()
  torpWarnInterval = setInterval(playAlternatingTorpWarnBeep, RWR_TORP_WARN_BEEP_S * 1000)
}

export function stopTorpedoWarnTone() {
  if (torpWarnInterval) {
    clearInterval(torpWarnInterval)
    torpWarnInterval = null
  }
  torpWarnPhase = 0
}

/** Single 465 Hz beep, 0.35 s, when a new RWR contact appears. */
export function playNewContactTone() {
  playRwrSineBeep(RWR_NEW_HZ, RWR_NEW_BEEP_S)
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
