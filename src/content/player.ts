/**
 * The player: one dark panel along the bottom that does read aloud and speed reading together,
 * like the Feeder Android player (design C). The big word follows the voice word by word; mute
 * stops the voice and the word carries on by itself on a timer (speed read), at any pace.
 * Every control is visible. Lives in a shadow root so page styles can't touch it.
 */
import { KOKORO_VOICES, KOKORO_PREFIX } from '../shared'
import { focusIndex } from '../rsvp'

const ICONS = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>',
  back: '<path d="M6 6h2v12H6zM9.5 12l8.5 6V6z"/>',
  forward: '<path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/>',
  back10: '<path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12.2" y="16.3" font-size="7.2" font-weight="700" text-anchor="middle" font-family="system-ui,sans-serif">10</text>',
  fwd10: '<path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="11.8" y="16.3" font-size="7.2" font-weight="700" text-anchor="middle" font-family="system-ui,sans-serif">10</text>',
  close: '<path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/>',
  gear: '<path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4-2-1.6zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9zm12.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/>',
  muted: '<path d="M4 9v6h4l5 4V5L8 9zm12.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z" transform="translate(1 0)"/>',
  word: '<path d="M3 6h18v2H3zm0 10h18v2H3zM10.5 9h3v6h-3z"/>',
  bold: '<path d="M7 4h6.2a4.3 4.3 0 0 1 3 7.4A4.6 4.6 0 0 1 14 20H7zm3 3v3.6h3a1.8 1.8 0 0 0 0-3.6zm0 6.4V17h3.6a1.8 1.8 0 0 0 0-3.6z"/>',
  speed: '<path d="M12 4a9 9 0 0 0-7.8 13.5l.3.5h15l.3-.5A9 9 0 0 0 12 4zm0 2a7 7 0 0 1 6.3 10H5.7A7 7 0 0 1 12 6zm4.2 2.4-5.3 4.2a1.6 1.6 0 1 0 2.3 2.1z"/>',
}
type IconName = keyof typeof ICONS
const svg = (name: IconName) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`

const CSS_TEXT = `
:host { all: initial; }
.panel {
  --bg: #1f2025; --fg: #f1f2f4; --dim: #a9adb6; --accent: #f7c948; --btn: #2d2f36; --track: #42454e; --focus: #ff8a80;
  position: fixed; z-index: 2147483646; left: 50%; bottom: 0; transform: translateX(-50%);
  width: min(760px, 100vw); box-sizing: border-box;
  padding: 8px 14px 6px 18px; border-radius: 26px 26px 0 0;
  background: var(--bg); color: var(--fg);
  box-shadow: 0 -10px 34px rgba(0,0,0,.35);
  font: 14px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  user-select: none;
}
button, select { font: inherit; color: inherit; border: 0; background: transparent; cursor: pointer; }
.top { display: flex; align-items: center; gap: 6px; height: 46px; }
.label { flex: none; color: var(--accent); font-size: 11.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.round { width: 34px; height: 34px; border-radius: 50%; background: var(--btn); display: grid; place-items: center; flex: none; }
.round:hover { background: #3a3d45; }
.round svg { width: 19px; height: 19px; fill: currentColor; }
.round[aria-pressed="true"] { background: var(--accent); color: #16181d; }
.speed { flex: none; display: flex; align-items: center; height: 34px; border-radius: 17px; background: var(--btn); }
.speed button { width: 30px; height: 34px; font-size: 17px; border-radius: 17px; }
.speed button:hover { background: #3a3d45; }
.speed button:disabled { color: var(--track); cursor: default; background: transparent; }
.speed .val { min-width: 52px; text-align: center; font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; }
.wordbox { padding: 2px 4px 4px 0; cursor: pointer; }
.wordbox[hidden] { display: none; }
.guide { position: relative; height: 9px; }
.guide::after { content: ''; position: absolute; left: 40%; width: 2px; height: 7px; background: var(--dim); opacity: .7; }
.guide.top::after { top: 0; }
.guide.bottom::after { bottom: 0; }
.word {
  display: grid; grid-template-columns: 2fr auto 3fr; align-items: baseline;
  font-size: 38px; font-weight: 500; line-height: 1.3; white-space: pre; min-height: 50px;
}
.word .l { text-align: right; overflow: hidden; }
.word .p { color: var(--focus); font-weight: 700; }
.word .r { text-align: left; overflow: hidden; }
.seek { width: 100%; margin: 4px 0 0; accent-color: var(--accent); height: 18px; cursor: pointer; }
.times { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--dim); font-variant-numeric: tabular-nums; padding-right: 4px; }
.msg { font-size: 12.5px; color: var(--dim); min-height: 0; }
.msg:empty { display: none; }
.msg.err { color: #ffb4ab; }
.controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; height: 70px; }
.left, .right { display: flex; align-items: center; gap: 6px; }
.right { justify-content: flex-end; }
.mid { display: flex; align-items: center; gap: 10px; }
.icon { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; }
.icon:hover { background: #2d2f36; }
.icon:disabled { color: var(--track); cursor: default; background: transparent; }
.icon svg { width: 26px; height: 26px; fill: currentColor; }
.play { width: 60px; height: 60px; border-radius: 50%; background: var(--accent); color: #16181d; display: grid; place-items: center; }
.play:hover { background: #ffd866; }
.play svg { width: 30px; height: 30px; fill: currentColor; }
select {
  height: 34px; max-width: 170px; padding: 0 8px; border-radius: 17px; background: var(--btn); color: var(--fg);
}
select option, select optgroup { background: #1f2025; color: #f1f2f4; }
.chip { height: 34px; padding: 0 12px 0 9px; border-radius: 17px; background: var(--btn); display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12.5px; }
.chip svg { width: 17px; height: 17px; fill: currentColor; }
.chip:hover { background: #3a3d45; }
.chip[aria-pressed="true"] { background: var(--accent); color: #16181d; }
.pills { position: fixed; z-index: 2147483647; display: none; gap: 6px; }
.pills.show { display: flex; }
.pill {
  display: flex; align-items: center; gap: 6px; padding: 7px 12px 7px 9px; border-radius: 999px;
  background: #1f2025; color: #f7c948; font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  box-shadow: 0 6px 20px rgba(0,0,0,.3); cursor: pointer;
}
.pill svg { width: 16px; height: 16px; fill: currentColor; }
.pill.secondary { background: #f7c948; color: #16181d; }
@media (max-width: 560px) {
  .chip span { display: none; }
  .chip { padding: 0 9px; }
  select { max-width: 110px; }
  .word { font-size: 30px; }
}
`

export interface PlayerActions {
  toggle(): void
  back(): void
  forward(): void
  seek(i: number): void
  slower(): void
  faster(): void
  setMuted(muted: boolean): void
  setShowWord(show: boolean): void
  setVoice(voice: string): void
  close(): void
  openSettings(): void
  readFrom(): void
  speedReadFrom(): void
  toggleFastRead(): void
}

/** Everything the panel shows, apart from the word. */
export interface PlayerView {
  muted: boolean
  playing: boolean
  label: string
  title: string
  speed: string
  slowerEnabled: boolean
  fasterEnabled: boolean
  position: number
  count: number
  leftText: string
  rightText: string
  message: string
  error: boolean
  voice: string
  showWord: boolean
  fastRead: boolean
}

const NATURAL_HINT = /natural|neural|online|google|premium|enhanced|siri/i

export class Player {
  readonly host: HTMLElement
  readonly root: ShadowRoot
  private els: Record<string, HTMLElement> = {}
  private voice = ''
  private seeking = false
  private view: PlayerView | null = null

  constructor(private actions: PlayerActions) {
    this.host = document.createElement('ash-speechify-player')
    this.root = this.host.attachShadow({ mode: 'open' })
    this.root.innerHTML = `
      <style>${CSS_TEXT}</style>
      <div class="panel" data-el="panel" role="region" aria-label="Read aloud and speed read player">
        <div class="top">
          <span class="label" data-el="label"></span>
          <span class="title" data-el="title"></span>
          <div class="speed">
            <button data-el="slower" aria-label="Slower">−</button>
            <span class="val" data-el="speed"></span>
            <button data-el="faster" aria-label="Faster">+</button>
          </div>
          <button class="round" data-el="mute"></button>
          <button class="round" data-el="showword" title="Show the big word">${svg('word')}</button>
          <button class="round" data-el="settings" title="Settings">${svg('gear')}</button>
          <button class="round" data-el="close" title="Close">${svg('close')}</button>
        </div>
        <div class="wordbox" data-el="wordbox" title="Click to play or pause">
          <div class="guide top"></div>
          <div class="word"><span class="l" data-el="wl"></span><span class="p" data-el="wp"></span><span class="r" data-el="wr"></span></div>
          <div class="guide bottom"></div>
        </div>
        <input class="seek" data-el="seek" type="range" min="0" value="0" aria-label="Position" />
        <div class="times"><span data-el="lefttext"></span><span data-el="righttext"></span></div>
        <div class="msg" data-el="msg"></div>
        <div class="controls">
          <div class="left"><select data-el="voice" title="Voice" aria-label="Voice"></select></div>
          <div class="mid">
            <button class="icon" data-el="back"></button>
            <button class="play" data-el="play"></button>
            <button class="icon" data-el="forward"></button>
          </div>
          <div class="right">
            <button class="chip" data-el="fastread" aria-pressed="false" title="Fast read: bold the start of every word (Alt+Shift+B)">${svg('bold')}<span>Fast read</span></button>
          </div>
        </div>
      </div>
      <div class="pills" data-el="pills">
        <div class="pill" data-el="pill">${svg('play')}Read from here</div>
        <div class="pill secondary" data-el="pillspeed">${svg('speed')}Speed read</div>
      </div>
    `
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach((e) => (this.els[e.dataset.el!] = e))
    const on = (el: string, fn: () => void) => this.els[el].addEventListener('click', (e) => (e.stopPropagation(), fn()))
    on('play', () => actions.toggle())
    on('wordbox', () => actions.toggle())
    on('back', () => actions.back())
    on('forward', () => actions.forward())
    on('slower', () => actions.slower())
    on('faster', () => actions.faster())
    on('mute', () => actions.setMuted(!this.view?.muted))
    on('showword', () => actions.setShowWord(!this.view?.showWord))
    on('close', () => actions.close())
    on('settings', () => actions.openSettings())
    on('pill', () => actions.readFrom())
    on('pillspeed', () => actions.speedReadFrom())
    on('fastread', () => actions.toggleFastRead())
    const seek = this.els.seek as HTMLInputElement
    seek.addEventListener('input', () => (this.seeking = true))
    seek.addEventListener('change', () => {
      this.seeking = false
      actions.seek(Number(seek.value))
    })
    this.els.voice.addEventListener('change', () => actions.setVoice((this.els.voice as HTMLSelectElement).value))
    // Keep page shortcuts from firing while using the player
    this.root.addEventListener('keydown', (e) => e.stopPropagation())
    this.fillVoices()
    if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', () => this.fillVoices())
  }

  /** Height of the panel, so the page can keep the line being read above it. */
  get height() {
    return this.els.panel.getBoundingClientRect().height
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

  private setVoice(voice: string) {
    this.voice = voice
    const sel = this.els.voice as HTMLSelectElement
    if ([...sel.options].some((o) => o.value === voice)) sel.value = voice
  }

  private icon(el: string, name: IconName, label: string) {
    const b = this.els[el]
    b.innerHTML = svg(name)
    b.title = label
    b.setAttribute('aria-label', label)
  }

  render(v: PlayerView) {
    this.view = v
    this.setVoice(v.voice)
    this.els.label.textContent = v.label
    this.els.title.textContent = v.title
    this.els.title.title = v.title
    this.els.speed.textContent = v.speed
    ;(this.els.slower as HTMLButtonElement).disabled = !v.slowerEnabled
    ;(this.els.faster as HTMLButtonElement).disabled = !v.fasterEnabled
    this.els.slower.title = v.muted ? 'Slower (fewer words a minute)' : 'Slower'
    this.els.faster.title = v.muted ? 'Faster (more words a minute)' : 'Faster'
    this.icon('mute', v.muted ? 'muted' : 'volume', v.muted ? 'Turn the voice back on' : 'Mute the voice and speed read')
    this.els.mute.setAttribute('aria-pressed', String(v.muted))
    this.els.showword.setAttribute('aria-pressed', String(v.showWord))
    this.els.wordbox.hidden = !v.showWord
    this.icon('play', v.playing ? 'pause' : 'play', v.playing ? 'Pause (Alt+Shift+R)' : 'Play (Alt+Shift+R)')
    this.icon('back', v.muted ? 'back10' : 'back', v.muted ? 'Back 10 words' : 'Previous sentence')
    this.icon('forward', v.muted ? 'fwd10' : 'forward', v.muted ? 'Forward 10 words' : 'Next sentence')
    const seek = this.els.seek as HTMLInputElement
    seek.max = String(Math.max(0, v.count - 1))
    if (!this.seeking) seek.value = String(v.position)
    seek.disabled = v.count < 2
    this.els.lefttext.textContent = v.leftText
    this.els.righttext.textContent = v.rightText
    this.els.msg.textContent = v.message
    this.els.msg.classList.toggle('err', v.error)
    this.els.fastread.setAttribute('aria-pressed', String(v.fastRead))
  }

  /** The big word, with its focus letter at a fixed spot. */
  showWord(text: string) {
    const focus = text ? focusIndex(text) : 0
    const len = Array.from(text.slice(focus))[0]?.length ?? 0
    this.els.wl.textContent = text.slice(0, focus)
    this.els.wp.textContent = text.slice(focus, focus + len)
    this.els.wr.textContent = text.slice(focus + len)
  }

  showPill(x: number, y: number) {
    const pills = this.els.pills
    pills.classList.add('show')
    const w = pills.offsetWidth
    pills.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x - w / 2))}px`
    pills.style.top = `${Math.max(8, y - 48)}px`
  }

  hidePill() {
    this.els.pills.classList.remove('show')
  }
}
