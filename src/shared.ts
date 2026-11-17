/** Things shared by every part of the extension: settings, voices and the messages they send. */

export const KOKORO_PREFIX = 'kokoro:'

/** The better-rated Kokoro voices from the model card, best first. */
export const KOKORO_VOICES: { id: string; label: string }[] = [
  { id: 'af_heart', label: 'Heart (US, female)' },
  { id: 'af_bella', label: 'Bella (US, female)' },
  { id: 'af_nicole', label: 'Nicole (US, female, soft)' },
  { id: 'am_fenrir', label: 'Fenrir (US, male)' },
  { id: 'am_michael', label: 'Michael (US, male)' },
  { id: 'am_puck', label: 'Puck (US, male)' },
  { id: 'bf_emma', label: 'Emma (UK, female)' },
  { id: 'bf_isabella', label: 'Isabella (UK, female)' },
  { id: 'bm_george', label: 'George (UK, male)' },
  { id: 'bm_fable', label: 'Fable (UK, male)' },
]

export const isKokoroVoice = (v: string) => v.startsWith(KOKORO_PREFIX)

export interface Settings {
  /** "kokoro:<id>" for the natural voice, otherwise a Web Speech voiceURI. */
  voice: string
  rate: number
  /** Use WebGPU for the natural voice when the browser has it. */
  gpu: boolean
  /** Clicking a sentence while the player is open jumps there. */
  clickToRead: boolean
  /** Scroll the page to keep the sentence being read in view. */
  autoScroll: boolean
  /** Bold the start of every word on the page being read. */
  fastRead: boolean
  /** Speed reading pace, in words per minute. */
  rsvpWpm: number
}

export const DEFAULT_SETTINGS: Settings = {
  voice: 'kokoro:af_heart',
  rate: 1,
  gpu: false,
  clickToRead: true,
  autoScroll: true,
  fastRead: false,
  rsvpWpm: 300,
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS as unknown as Record<string, unknown>)
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) }
}

export function saveSettings(patch: Partial<Settings>): Promise<void> {
  return chrome.storage.sync.set(patch)
}

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]

export type EngineDevice = 'wasm' | 'webgpu'

export interface EngineStatus {
  state: 'idle' | 'loading' | 'ready' | 'error'
  progress: number
  device: EngineDevice | null
  error: string | null
}

/** Page (content script) -> background -> offscreen document. */
export type ToEngine =
  | { type: 'load'; gpu: boolean }
  | { type: 'speak'; id: number; text: string; voice: string; rate: number; gpu: boolean }
  | { type: 'prefetch'; text: string; voice: string; gpu: boolean }
  | { type: 'pause' }
  | { type: 'resume'; id: number }
  | { type: 'stop' }
  | { type: 'rate'; rate: number }
  | { type: 'status' }

/** Offscreen document -> background -> page. */
export type FromEngine =
  | { type: 'engine-status'; status: EngineStatus }
  /** Playback position of the audio for request `id`, sent on every change and a few times a second. */
  | { type: 'pos'; id: number; time: number; duration: number; rate: number; playing: boolean }
  | { type: 'ended'; id: number }
  | { type: 'failed'; id: number; message: string }
  /** The engine no longer has the audio for `id` (Chrome closed it while paused): start the sentence again. */
  | { type: 'lost'; id: number }
  /** The player's media keys (lock screen, keyboard) asked for this. */
  | { type: 'media'; action: 'play' | 'pause' | 'next' | 'previous' | 'stop' }

/** Background -> page: start reading. */
export interface StartMessage {
  type: 'start'
  mode: 'auto' | 'page' | 'selection' | 'toggle' | 'fast-read' | 'speed-read'
  text?: string
}
