let audioCtx: AudioContext | null = null
let hoverBuffer: AudioBuffer | null = null
let clickBuffer: AudioBuffer | null = null
let initialized = false

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

async function loadBuffer(url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url)
    const arrayBuf = await res.arrayBuffer()
    return await getCtx().decodeAudioData(arrayBuf)
  } catch {
    console.warn(`[buttonAudio] failed to load ${url}`)
    return null
  }
}

function playBuffer(buffer: AudioBuffer | null) {
  if (!buffer) return
  const ctx = getCtx()
  void ctx.resume()
  const source = ctx.createBufferSource()
  const gain = ctx.createGain()
  gain.gain.value = 0.4
  source.buffer = buffer
  source.connect(gain)
  gain.connect(ctx.destination)
  source.start()
}

function isButton(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.closest('button') !== null
}

function handleMouseEnter(e: MouseEvent) {
  if (isButton(e.target)) playBuffer(hoverBuffer)
}

function handleClick(e: MouseEvent) {
  if (isButton(e.target)) playBuffer(clickBuffer)
}

export function initButtonAudio() {
  if (initialized) return
  initialized = true

  document.addEventListener('mouseenter', handleMouseEnter, true)
  document.addEventListener('click', handleClick, true)

  void (async () => {
    hoverBuffer = await loadBuffer('/mouse_over.mp3')
    clickBuffer = await loadBuffer('/click_action.mp3')
  })()
}

export function teardownButtonAudio() {
  document.removeEventListener('mouseenter', handleMouseEnter, true)
  document.removeEventListener('click', handleClick, true)
  initialized = false
}
