import { KOKORO_PREFIX, KOKORO_VOICES, isKokoroVoice, loadSettings, saveSettings, type FromEngine, type Settings, type ToEngine } from './shared'

const send = (msg: ToEngine) => chrome.runtime.sendMessage({ target: 'engine', msg }).catch(() => undefined)

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const voiceSel = $<HTMLSelectElement>('voice')
const rate = $<HTMLInputElement>('rate')
const NATURAL_HINT = /natural|neural|online|google|premium|enhanced|siri/i

let settings: Settings

function fillVoices() {
  const browser = speechSynthesis.getVoices().sort((a, b) => Number(NATURAL_HINT.test(b.name)) - Number(NATURAL_HINT.test(a.name)) || a.lang.localeCompare(b.lang))
  voiceSel.innerHTML = ''
  const g1 = document.createElement('optgroup')
  g1.label = 'Natural voices (on this device)'
  for (const v of KOKORO_VOICES) g1.append(new Option(v.label, KOKORO_PREFIX + v.id))
  voiceSel.append(g1)
  if (browser.length) {
    const g2 = document.createElement('optgroup')
    g2.label = 'Browser voices'
    for (const v of browser) g2.append(new Option(`${NATURAL_HINT.test(v.name) ? '★ ' : ''}${v.name} (${v.lang})`, v.voiceURI))
    voiceSel.append(g2)
  }
  if (settings) voiceSel.value = settings.voice
}

async function init() {
  settings = await loadSettings()
  fillVoices()
  speechSynthesis.addEventListener('voiceschanged', fillVoices)
  rate.value = String(settings.rate)
  $('rateVal').textContent = `${settings.rate}×`
  const wpm = $<HTMLInputElement>('rsvpWpm')
  wpm.value = String(settings.rsvpWpm)
  $('wpmVal').textContent = `${settings.rsvpWpm} wpm`
  wpm.oninput = () => {
    $('wpmVal').textContent = `${wpm.value} wpm`
    void saveSettings({ rsvpWpm: Number(wpm.value) })
  }
  for (const k of ['gpu', 'clickToRead', 'autoScroll', 'fastRead', 'showWord'] as const) {
    const box = $<HTMLInputElement>(k)
    box.checked = settings[k]
    box.onchange = () => saveSettings({ [k]: box.checked })
  }
  voiceSel.onchange = () => {
    settings.voice = voiceSel.value
    void saveSettings({ voice: voiceSel.value })
  }
  rate.oninput = () => {
    settings.rate = Number(rate.value)
    $('rateVal').textContent = `${settings.rate}×`
    void saveSettings({ rate: settings.rate })
  }
  $('test').onclick = () => {
    const text = 'Hello! This is how pages will sound when I read them to you.'
    if (isKokoroVoice(settings.voice)) {
      send({ type: 'speak', id: Date.now(), text, voice: settings.voice.slice(KOKORO_PREFIX.length), rate: settings.rate, gpu: settings.gpu })
      return
    }
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    const v = speechSynthesis.getVoices().find((x) => x.voiceURI === settings.voice)
    if (v) u.voice = v
    u.rate = settings.rate
    speechSynthesis.speak(u)
  }
  $('download').onclick = () => send({ type: 'load', gpu: settings.gpu })
  chrome.runtime.onMessage.addListener((m: FromEngine) => {
    if (m.type !== 'engine-status') return
    const s = m.status
    const where = s.device === 'webgpu' ? 'graphics card' : 'processor'
    $('status').textContent =
      s.state === 'ready' ? `Ready, running on the ${where}` :
      s.state === 'loading' ? (s.progress > 0 && s.progress < 1 ? `Downloading… ${Math.round(s.progress * 100)}%` : 'Loading…') :
      s.state === 'error' ? `Could not load: ${s.error}` : 'Not loaded yet (downloads on first use)'
    $<HTMLButtonElement>('download').disabled = s.state === 'ready' || s.state === 'loading'
  })
  send({ type: 'status' })
  if (!('gpu' in navigator)) {
    $<HTMLInputElement>('gpu').disabled = true
    $('gpu').title = 'WebGPU is not available in this browser'
  }
}
void init()
