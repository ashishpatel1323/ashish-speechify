/**
 * The floating player: every control visible on one bar (back, play/pause, forward, speed,
 * voice, settings, close). Lives in a shadow root so page styles can't touch it.
 */
import { KOKORO_VOICES, KOKORO_PREFIX, SPEEDS, isKokoroVoice } from '../shared'
import type { ReaderState } from './reader'

const ICONS = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>',
  back: '<path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/>',
  forward: '<path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/>',
  close: '<path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/>',
  gear: '<path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/>',
  grip: '<circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="17" r="1.5"/><circle cx="15" cy="17" r="1.5"/>',
}
const svg = (name: keyof typeof ICONS) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`

const CSS_TEXT = `
:host { all: initial; }
.bar {
  position: fixed; z-index: 2147483646; left: 50%; bottom: 20px; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 6px;
  max-width: calc(100vw - 24px); box-sizing: border-box;
  padding: 10px 12px 10px 6px; border-radius: 18px;
  background: #16181d; color: #f2f3f5;
  box-shadow: 0 10px 34px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.06);
  font: 13px/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  user-select: none;
}
.row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
button, select {
  font: inherit; color: inherit; border: 0; background: transparent; cursor: pointer;
}
button.icon {
  width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
}
button.icon:hover, .chip:hover, select:hover { background: rgba(255,255,255,.09); }
button.icon svg { width: 20px; height: 20px; fill: currentColor; }
button.play {
  width: 44px; height: 44px; border-radius: 50%; background: #f7c948; color: #16181d;
}
button.play:hover { background: #ffd866; }
button.play svg { width: 24px; height: 24px; }
.grip { cursor: grab; width: 22px; color: #6b7280; display: grid; place-items: center; }
.grip svg { width: 18px; height: 18px; fill: currentColor; }
.sep { width: 1px; height: 26px; background: rgba(255,255,255,.12); margin: 0 2px; }
.speed { display: flex; align-items: center; background: rgba(255,255,255,.06); border-radius: 10px; }
.speed button { width: 28px; height: 32px; border-radius: 8px; font-size: 16px; }
.speed button:hover { background: rgba(255,255,255,.09); }
.speed .val { min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; }
select {
  height: 34px; max-width: 210px; padding: 0 8px; border-radius: 10px;
  background: rgba(255,255,255,.06); color: #f2f3f5;
}
select option, select optgroup { background: #16181d; color: #f2f3f5; }
.status { display: flex; align-items: center; gap: 8px; padding-left: 28px; color: #a1a7b3; font-size: 12px; }
.progress { flex: 1; height: 4px; min-width: 80px; border-radius: 2px; background: rgba(255,255,255,.1); overflow: hidden; }
.progress > div { height: 100%; width: 0; background: #f7c948; transition: width .3s; }
.count { font-variant-numeric: tabular-nums; white-space: nowrap; }
.msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 420px; }
.msg.err { color: #fca5a5; white-space: normal; }
.pill {
  position: fixed; z-index: 2147483647; display: none; align-items: center; gap: 6px;
  padding: 7px 12px 7px 9px; border-radius: 999px; background: #16181d; color: #f7c948;
  font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 6px 20px rgba(0,0,0,.3); cursor: pointer;
}
.pill svg { width: 16px; height: 16px; fill: currentColor; }
.pill.show { display: flex; }
@media (prefers-color-scheme: light) {
  .bar { background: #ffffff; color: #1b1d22; box-shadow: 0 10px 34px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.08); }
  button.icon:hover, .chip:hover, select:hover, .speed button:hover { background: rgba(0,0,0,.06); }
  .speed, select { background: rgba(0,0,0,.05); color: #1b1d22; }
  select option, select optgroup { background: #fff; color: #1b1d22; }
  .sep { background: rgba(0,0,0,.1); }
  .status { color: #5b6170; }
  .progress { background: rgba(0,0,0,.08); }
  .progress > div, button.play { background: #f2b705; }
  .msg.err { color: #b91c1c; }
}
`

export interface PlayerActions {
  toggle(): void
  skip(delta: number): void
  setRate(rate: number): void
  setVoice(voice: string): void
  close(): void
  openSettings(): void
  readFrom(): void
}

const NATURAL_HINT = /natural|neural|online|google|premium|enhanced|siri/i

export class Player {
  readonly host: HTMLElement
  private root: ShadowRoot
  private els: Record<string, HTMLElement> = {}
  private voice = ''

  constructor(private actions: PlayerActions) {
    this.host = document.createElement('ash-speechify-player')
    this.root = this.host.attachShadow({ mode: 'closed' })
    this.root.innerHTML = `
      <style>${CSS_TEXT}</style>
      <div class="bar" role="region" aria-label="Read aloud player">
        <div class="row">
          <div class="grip" data-el="grip" title="Drag to move">${svg('grip')}</div>
          <button class="icon" data-el="back" title="Previous sentence">${svg('back')}</button>
          <button class="icon play" data-el="play" title="Play (Alt+Shift+R)">${svg('play')}</button>
          <button class="icon" data-el="forward" title="Next sentence">${svg('forward')}</button>
          <div class="sep"></div>
          <div class="speed" title="Speed">
            <button data-el="slower" title="Slower" aria-label="Slower">−</button>
            <span class="val" data-el="rate">1×</span>
            <button data-el="faster" title="Faster" aria-label="Faster">+</button>
          </div>
          <select data-el="voice" title="Voice" aria-label="Voice"></select>
          <button class="icon" data-el="settings" title="Settings">${svg('gear')}</button>
          <button class="icon" data-el="close" title="Close and stop">${svg('close')}</button>
        </div>
        <div class="status">
          <span class="count" data-el="count"></span>
          <div class="progress"><div data-el="bar"></div></div>
          <span class="msg" data-el="msg"></span>
        </div>
      </div>
      <div class="pill" data-el="pill">${svg('play')}Read from here</div>
    `
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach((e) => (this.els[e.dataset.el!] = e))
    const on = (el: string, fn: () => void) => this.els[el].addEventListener('click', (e) => (e.stopPropagation(), fn()))
    on('play', () => actions.toggle())
    on('back', () => actions.skip(-1))
    on('forward', () => actions.skip(1))
    on('slower', () => this.stepRate(-1))
    on('faster', () => this.stepRate(1))
    on('close', () => actions.close())
    on('settings', () => actions.openSettings())
    on('pill', () => actions.readFrom())
    this.els.voice.addEventListener('change', () => actions.setVoice((this.els.voice as HTMLSelectElement).value))
    // Keep page shortcuts from firing while using the player
    this.root.addEventListener('keydown', (e) => e.stopPropagation())
    this.makeDraggable()
    this.fillVoices()
    if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', () => this.fillVoices())
  }

  private rate = 1

  private stepRate(dir: number) {
    let i = SPEEDS.findIndex((s) => s >= this.rate - 0.001)
    if (i < 0) i = SPEEDS.length - 1
    if (SPEEDS[i] > this.rate + 0.001 && dir > 0) i--
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))]
    this.actions.setRate(next)
  }

  private makeDraggable() {
    const bar = this.root.querySelector('.bar') as HTMLElement
    const grip = this.els.grip
    grip.addEventListener('pointerdown', (e) => {
      const rect = bar.getBoundingClientRect()
      const dx = e.clientX - rect.left
      const dy = e.clientY - rect.top
      grip.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent) => {
        const x = Math.max(4, Math.min(innerWidth - rect.width - 4, ev.clientX - dx))
        const y = Math.max(4, Math.min(innerHeight - rect.height - 4, ev.clientY - dy))
        Object.assign(bar.style, { left: `${x}px`, top: `${y}px`, bottom: 'auto', transform: 'none' })
      }
      const up = () => {
        grip.removeEventListener('pointermove', move)
        grip.removeEventListener('pointerup', up)
      }
      grip.addEventListener('pointermove', move)
      grip.addEventListener('pointerup', up)
    })
  }

  fillVoices() {
    const sel = this.els.voice as HTMLSelectElement
    const browser = 'speechSynthesis' in window ? speechSynthesis.getVoices() : []
    const lang = (document.documentElement.lang || navigator.language || 'en').split('-')[0].toLowerCase()
    const mine = browser
      .filter((v) => v.lang.toLowerCase().startsWith(lang))
      .sort((a, b) => Number(NATURAL_HINT.test(b.name)) - Number(NATURAL_HINT.test(a.name)) || a.name.localeCompare(b.name))
    const opt = (value: string, label: string) => `<option value="${value.replace(/"/g, '&quot;')}">${label.replace(/</g, '&lt;')}</option>`
    sel.innerHTML =
      `<optgroup label="Natural voices (on this device)">${KOKORO_VOICES.map((v) => opt(KOKORO_PREFIX + v.id, v.label)).join('')}</optgroup>` +
      (mine.length ? `<optgroup label="Browser voices">${mine.map((v) => opt(v.voiceURI, (NATURAL_HINT.test(v.name) ? '★ ' : '') + v.name)).join('')}</optgroup>` : '')
    this.setVoice(this.voice)
  }

  setVoice(voice: string) {
    this.voice = voice
    const sel = this.els.voice as HTMLSelectElement
    if ([...sel.options].some((o) => o.value === voice)) sel.value = voice
  }

  update(s: ReaderState, voice: string) {
    this.rate = s.rate
    this.setVoice(voice)
    const playing = s.status === 'playing' || s.status === 'loading'
    this.els.play.innerHTML = svg(playing ? 'pause' : 'play')
    this.els.play.title = playing ? 'Pause (Alt+Shift+R)' : 'Play (Alt+Shift+R)'
    this.els.rate.textContent = `${+s.rate.toFixed(2)}×`
    this.els.count.textContent = s.sentences ? `${Math.min(s.sentence + 1, s.sentences)} / ${s.sentences}` : 'Nothing to read'
    this.els.bar.style.width = s.sentences ? `${((s.sentence + (playing ? 0.5 : 0)) / s.sentences) * 100}%` : '0'
    const msg = this.els.msg
    msg.classList.toggle('err', !!s.error)
    if (s.error) msg.textContent = s.error
    else if (isKokoroVoice(voice) && s.engine?.state === 'loading')
      msg.textContent =
        s.engine.progress > 0 && s.engine.progress < 1
          ? `Downloading natural voice ${Math.round(s.engine.progress * 100)}% (one time)`
          : 'Loading natural voice…'
    else if (s.status === 'loading') msg.textContent = 'Preparing speech…'
    else msg.textContent = ''
  }

  showPill(x: number, y: number) {
    const pill = this.els.pill
    pill.classList.add('show')
    const w = pill.offsetWidth
    pill.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x - w / 2))}px`
    pill.style.top = `${Math.max(8, y - 48)}px`
  }

  hidePill() {
    this.els.pill.classList.remove('show')
  }
}
