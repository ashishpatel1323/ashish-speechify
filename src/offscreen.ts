/**
 * The hidden extension page that owns the natural voice: it runs the Kokoro worker, keeps a small
 * cache of generated sentences and plays them. Pages talk to it through the background worker,
 * because an offscreen document can't message tabs itself.
 */
import type { EngineDevice, EngineStatus, FromEngine, ToEngine } from './shared'
import type { WorkerRequest, WorkerResponse } from './tts.worker'

interface Audio16 {
  samples: Float32Array
  sampleRate: number
}

let worker: Worker | null = null
let nextReq = 1
const pending = new Map<number, { resolve: (a: Audio16) => void; reject: (e: Error) => void }>()
let status: EngineStatus = { state: 'idle', progress: 0, device: null, error: null }
let readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = []
const cache = new Map<string, Promise<Audio16>>()

/** The tab being read to; events go there. */
let ownerTab: number | null = null
let current: { id: number; url: string } | null = null
const audio = new Audio()
audio.preservesPitch = true
let posTimer: number | null = null

function emit(event: FromEngine, tabId = ownerTab) {
  if (tabId === null) return
  chrome.runtime.sendMessage({ target: 'bg', tabId, event }).catch(() => undefined)
}

function setStatus(patch: Partial<EngineStatus>) {
  status = { ...status, ...patch }
  emit({ type: 'engine-status', status })
}

const webGpuAvailable = () => 'gpu' in navigator

function ensureWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./tts.worker.js', location.href), { type: 'module' })
  w.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const m = e.data
    if (m.type === 'progress') {
      setStatus({ progress: m.total ? Math.min(1, m.loaded / m.total) : 0 })
    } else if (m.type === 'ready') {
      setStatus({ state: 'ready', progress: 1, device: m.device })
      readyWaiters.forEach((r) => r.resolve())
      readyWaiters = []
    } else if (m.type === 'audio') {
      pending.get(m.id)?.resolve({ samples: m.samples, sampleRate: m.sampleRate })
      pending.delete(m.id)
    } else if (m.type === 'error') {
      const err = new Error(m.message)
      if (m.id !== undefined) {
        pending.get(m.id)?.reject(err)
        pending.delete(m.id)
      } else {
        setStatus({ state: 'error', error: m.message })
        readyWaiters.forEach((r) => r.reject(err))
        readyWaiters = []
      }
    }
  }
  w.onerror = (e) => {
    const err = new Error(e.message || 'Voice worker failed')
    setStatus({ state: 'error', error: err.message })
    pending.forEach((p) => p.reject(err))
    pending.clear()
    readyWaiters.forEach((r) => r.reject(err))
    readyWaiters = []
  }
  worker = w
  return w
}

function resetWorker() {
  worker?.terminate()
  worker = null
  const err = new Error('Voice model restarted')
  pending.forEach((p) => p.reject(err))
  pending.clear()
  readyWaiters.forEach((w) => w.reject(err))
  readyWaiters = []
  cache.clear()
  status = { state: 'idle', progress: 0, device: null, error: null }
}

function load(gpu: boolean): Promise<void> {
  const device: EngineDevice = gpu && webGpuAvailable() ? 'webgpu' : 'wasm'
  if (status.state === 'ready' && status.device === device) return Promise.resolve()
  if (status.state === 'ready' || (status.state === 'loading' && status.device !== device)) resetWorker()
  const wait = new Promise<void>((resolve, reject) => readyWaiters.push({ resolve, reject }))
  if (status.state !== 'loading') {
    setStatus({ state: 'loading', progress: 0, device, error: null })
    ensureWorker().postMessage({ type: 'load', device } satisfies WorkerRequest)
  }
  return wait
}

function generate(text: string, voice: string): Promise<Audio16> {
  const key = `${voice}\n${text}`
  let p = cache.get(key)
  if (!p) {
    const id = nextReq++
    p = new Promise<Audio16>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      ensureWorker().postMessage({ type: 'generate', id, text, voice } satisfies WorkerRequest)
    })
    p.catch(() => cache.delete(key))
    cache.set(key, p)
    // Keep the last few sentences (going back is common), drop older ones
    while (cache.size > 12) cache.delete(cache.keys().next().value!)
  }
  return p
}

/** 16-bit PCM WAV, so it plays in a normal audio element (speed with pitch kept, media keys). */
function wavBlob({ samples, sampleRate }: Audio16): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

function sendPos() {
  if (!current) return
  emit({
    type: 'pos',
    id: current.id,
    time: audio.currentTime,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    rate: audio.playbackRate,
    playing: !audio.paused,
  })
}

function stopAudio() {
  audio.pause()
  audio.onended = null
  if (current) URL.revokeObjectURL(current.url)
  current = null
  if (posTimer !== null) clearInterval(posTimer)
  posTimer = null
}

audio.addEventListener('playing', sendPos)
audio.addEventListener('pause', sendPos)
audio.addEventListener('ratechange', sendPos)

let speakToken = 0

async function speak(tabId: number, m: Extract<ToEngine, { type: 'speak' }>) {
  const token = ++speakToken
  if (ownerTab !== null && ownerTab !== tabId) emit({ type: 'media', action: 'stop' })
  ownerTab = tabId
  stopAudio()
  try {
    await load(m.gpu)
    const a = await generate(m.text, m.voice)
    if (token !== speakToken) return
    const url = URL.createObjectURL(wavBlob(a))
    current = { id: m.id, url }
    audio.src = url
    audio.playbackRate = m.rate
    audio.onended = () => {
      if (current?.id !== m.id) return
      stopAudio()
      emit({ type: 'ended', id: m.id }, tabId)
    }
    await audio.play()
    posTimer = window.setInterval(sendPos, 400)
    setMediaSession()
  } catch (e) {
    if (token !== speakToken) return
    emit({ type: 'failed', id: m.id, message: e instanceof Error ? e.message : String(e) }, tabId)
  }
}

function setMediaSession() {
  if (!('mediaSession' in navigator)) return
  const ms = navigator.mediaSession
  ms.metadata = new MediaMetadata({ title: 'Reading aloud', artist: 'ashish-speechify' })
  const map: [MediaSessionAction, FromEngine & { type: 'media' }][] = [
    ['play', { type: 'media', action: 'play' }],
    ['pause', { type: 'media', action: 'pause' }],
    ['stop', { type: 'media', action: 'stop' }],
    ['nexttrack', { type: 'media', action: 'next' }],
    ['previoustrack', { type: 'media', action: 'previous' }],
    ['seekforward', { type: 'media', action: 'next' }],
    ['seekbackward', { type: 'media', action: 'previous' }],
  ]
  for (const [action, ev] of map) {
    try {
      ms.setActionHandler(action, () => emit(ev))
    } catch {
      // not supported here
    }
  }
}

chrome.runtime.onMessage.addListener((raw: { target?: string; tabId?: number; msg?: ToEngine }, _sender, reply) => {
  if (raw?.target !== 'offscreen' || !raw.msg || raw.tabId === undefined) return
  const tabId = raw.tabId
  const m = raw.msg
  switch (m.type) {
    case 'load':
      ownerTab ??= tabId
      load(m.gpu).catch(() => undefined)
      emit({ type: 'engine-status', status }, tabId)
      break
    case 'status':
      emit({ type: 'engine-status', status }, tabId)
      break
    case 'speak':
      void speak(tabId, m)
      break
    case 'prefetch':
      load(m.gpu)
        .then(() => generate(m.text, m.voice))
        .catch(() => undefined)
      break
    case 'pause':
      if (tabId === ownerTab) audio.pause()
      break
    case 'resume':
      if (tabId === ownerTab && current?.id === m.id) void audio.play().catch(() => undefined)
      else emit({ type: 'lost', id: m.id }, tabId)
      break
    case 'stop':
      if (tabId === ownerTab) {
        speakToken++
        stopAudio()
      }
      break
    case 'rate':
      if (tabId === ownerTab) audio.playbackRate = m.rate
      break
  }
  reply({ ok: true })
})
