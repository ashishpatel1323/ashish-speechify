/**
 * Speed read dock: one word at a time at a fixed spot, with a red focus letter, in a bar along
 * the bottom of the page, while the page above highlights the word and scrolls along (like read
 * aloud does). The same controls, keys and timing as Feeder Web's speed reading (components/Rsvp.tsx).
 */
import {
  focusIndex,
  minutesLeft,
  RSVP_MAX_WPM,
  RSVP_MIN_WPM,
  rsvpWords,
  sentenceStartBefore,
  wordDelay,
  wordIndexAt,
  type RsvpWord,
} from '../rsvp'

const WPM_STEP = 25
// The first words after (re)starting are shown a little longer so the eye can settle
const RAMP = [1.8, 1.4, 1.15]

const ICONS: Record<string, string> = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/>',
  replay: '<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>',
  prev: '<path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/>',
  next: '<path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/>',
  close: '<path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4z"/>',
}
const svg = (n: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`

export const RSVP_CSS = `
.rsvp {
  --bg: #ffffff; --bg2: #f4f5f7; --fg: #1b1d22; --fg2: #4a4f5a; --fg3: #7a808c; --line: #e2e4e9;
  --pivot: #d1342f; --accent: #f2b705;
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 8px 16px 10px; box-sizing: border-box;
  background: var(--bg); color: var(--fg); outline: none;
  border-top: 1px solid var(--line); border-radius: 16px 16px 0 0;
  box-shadow: 0 -8px 28px rgba(0,0,0,.18);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  .rsvp { --bg: #16181d; --bg2: #1d2026; --fg: #f2f3f5; --fg2: #c3c7cf; --fg3: #8b919c; --line: #2a2e35; --pivot: #ff8a80; --accent: #f7c948; }
}
.rsvp button { font: inherit; color: inherit; background: transparent; border: 0; cursor: pointer; }
.rsvp .ib { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; }
.rsvp .ib:hover, .rsvp .chip:hover { background: rgba(127,127,127,.15); }
.rsvp .ib svg { width: 20px; height: 20px; fill: currentColor; }
.rsvp-stage { width: 100%; display: flex; justify-content: center; cursor: pointer; user-select: none; }
.rsvp-frame { width: min(100%, 560px); }
.rsvp-guide { position: relative; height: 8px; border: 0 solid var(--line); }
.rsvp-guide.top { border-top-width: 2px; }
.rsvp-guide.bottom { border-bottom-width: 2px; }
.rsvp-guide::after { content: ''; position: absolute; left: 40%; width: 2px; height: 6px; background: var(--fg3); }
.rsvp-guide.top::after { top: 0; }
.rsvp-guide.bottom::after { bottom: 0; }
.rsvp-word {
  display: grid; grid-template-columns: 2fr auto 3fr; align-items: baseline;
  font-size: clamp(26px, 4.5vw, 40px); font-weight: 500; line-height: 1.35; white-space: pre; color: var(--fg);
}
.rsvp-l { text-align: right; overflow: hidden; }
.rsvp-pivot { color: var(--pivot); font-weight: 700; }
.rsvp-r { text-align: left; overflow: hidden; }
.rsvp-empty { color: var(--fg3); text-align: center; margin: 8px 0; }
.rsvp-progress { width: min(100%, 900px); accent-color: var(--accent); margin: 4px 0 0; }
.rsvp-row { width: min(100%, 900px); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: center; }
.rsvp-buttons { display: flex; align-items: center; gap: 2px; }
.rsvp .play { width: 44px; height: 44px; border-radius: 50%; background: var(--accent); color: #16181d; display: grid; place-items: center; }
.rsvp .play svg { width: 24px; height: 24px; fill: currentColor; }
.rsvp-speed { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 220px; max-width: 380px; }
.rsvp-speed input { flex: 1; min-width: 0; accent-color: var(--accent); }
.rsvp .chip { min-width: 32px; height: 30px; border-radius: 8px; font-size: 17px; background: rgba(127,127,127,.1); }
.rsvp-wpm { flex: none; min-width: 68px; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.rsvp-info { display: flex; flex-direction: column; align-items: flex-end; min-width: 120px; font-size: 12px; color: var(--fg3); font-variant-numeric: tabular-nums; }
.rsvp-info b { color: var(--fg2); font-weight: 600; }
`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export interface RsvpOptions {
  text: string
  startOffset: number
  title: string
  wpm: number
  onWpm(wpm: number): void
  /** Each word as it's shown, by its offset in the text, so the page can follow along. */
  onWord?(offset: number): void
  /** Called with the offset of the word reached. */
  onClose(offset: number): void
}

export class RsvpView {
  private el: HTMLDivElement
  private words: RsvpWord[]
  private index: number
  private playing = false
  private wpm: number
  private shownSincePlay = 0
  private timer: number | null = null
  private lastShown = -1
  private q = (sel: string) => this.el.querySelector(sel) as HTMLElement

  constructor(
    private root: ShadowRoot,
    private opts: RsvpOptions,
  ) {
    this.words = rsvpWords(opts.text)
    this.index = Math.min(wordIndexAt(this.words, opts.startOffset), Math.max(0, this.words.length - 1))
    this.wpm = opts.wpm
    this.el = document.createElement('div')
    this.el.className = 'rsvp'
    this.el.tabIndex = -1
    this.el.setAttribute('role', 'dialog')
    this.el.setAttribute('aria-label', 'Speed read')
    this.el.innerHTML = `
      <div class="rsvp-stage" data-a="toggle" title="Click to play or pause">
        <div class="rsvp-frame">
          <div class="rsvp-guide top"></div>
          <div class="rsvp-word"><span class="rsvp-l"></span><span class="rsvp-pivot"></span><span class="rsvp-r"></span></div>
          <div class="rsvp-guide bottom"></div>
        </div>
      </div>
      <input class="rsvp-progress" type="range" min="0" aria-label="Position" />
      <div class="rsvp-row">
        <div class="rsvp-buttons">
          <button class="ib" data-a="sentence" title="Back one sentence (←)">${svg('replay')}</button>
          <button class="ib" data-a="prev" title="Back one word (Shift ←)">${svg('prev')}</button>
          <button class="play" data-a="toggle"></button>
          <button class="ib" data-a="next" title="Forward one word (→)">${svg('next')}</button>
        </div>
        <div class="rsvp-speed">
          <button class="chip" data-a="slower" title="Slower (↓)">−</button>
          <input class="rsvp-rate" type="range" min="${RSVP_MIN_WPM}" max="${RSVP_MAX_WPM}" step="${WPM_STEP}" aria-label="Words per minute" />
          <button class="chip" data-a="faster" title="Faster (↑)">+</button>
          <span class="rsvp-wpm"></span>
        </div>
        <div class="rsvp-info"><b class="rsvp-hint"></b><span class="rsvp-left"></span></div>
        <button class="ib" data-a="close" title="Close speed read (Esc)">${svg('close')}</button>
      </div>`
    if (!this.words.length) {
      this.q('.rsvp-stage').innerHTML = `<p class="rsvp-empty">There's no text to speed read here.</p>`
    }
    this.el.addEventListener('click', (e) => {
      const a = (e.target as Element).closest<HTMLElement>('[data-a]')?.dataset.a
      if (!a) return
      if (a === 'close') this.close()
      else if (a === 'toggle') this.toggle()
      else if (a === 'sentence') this.jump(sentenceStartBefore(this.words, this.index))
      else if (a === 'prev') this.jump(this.index - 1)
      else if (a === 'next') this.jump(this.index + 1)
      else if (a === 'slower') this.setWpm(this.wpm - WPM_STEP)
      else if (a === 'faster') this.setWpm(this.wpm + WPM_STEP)
    })
    const progress = this.q('.rsvp-progress') as HTMLInputElement
    progress.max = String(Math.max(0, this.words.length - 1))
    progress.addEventListener('input', () => this.jump(Number(progress.value)))
    const rate = this.q('.rsvp-rate') as HTMLInputElement
    rate.addEventListener('input', () => this.setWpm(Number(rate.value)))
    addEventListener('keydown', this.onKey, true)
    root.appendChild(this.el)
    this.el.focus()
    if (this.words.length) this.play()
    else this.render()
  }

  private get done() {
    return this.index >= this.words.length - 1 && !this.playing
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.composedPath()[0] as HTMLElement | undefined
    if (t?.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return
    switch (e.key) {
      case ' ':
        this.toggle()
        break
      case 'ArrowLeft':
        this.jump(e.shiftKey ? this.index - 1 : sentenceStartBefore(this.words, this.index))
        break
      case 'ArrowRight':
        this.jump(this.index + 1)
        break
      case 'ArrowUp':
        this.setWpm(this.wpm + WPM_STEP)
        break
      case 'ArrowDown':
        this.setWpm(this.wpm - WPM_STEP)
        break
      case 'Escape':
        this.close()
        break
      default:
        // Keep the page's own single-key shortcuts quiet while speed reading
        if (e.key.length !== 1) return
    }
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  private setWpm(v: number) {
    this.wpm = Math.min(RSVP_MAX_WPM, Math.max(RSVP_MIN_WPM, Math.round(v / WPM_STEP) * WPM_STEP))
    this.opts.onWpm(this.wpm)
    this.render()
  }

  private play() {
    this.shownSincePlay = 0
    if (this.index >= this.words.length - 1) this.index = 0
    this.playing = true
    this.schedule()
  }

  private pause() {
    this.playing = false
    this.clear()
    this.render()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  private jump(to: number) {
    this.shownSincePlay = 0
    this.index = Math.min(Math.max(0, to), Math.max(0, this.words.length - 1))
    if (this.playing) this.schedule()
    else this.render()
  }

  private clear() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule() {
    this.clear()
    this.render()
    const word = this.words[this.index]
    if (!this.playing || !word) return
    const ramp = RAMP[this.shownSincePlay] ?? 1
    this.timer = window.setTimeout(() => {
      this.shownSincePlay++
      if (this.index >= this.words.length - 1) this.pause()
      else {
        this.index++
        this.schedule()
      }
    }, wordDelay(word, this.wpm) * ramp)
  }

  private render() {
    const word = this.words[this.index]
    if (word && this.q('.rsvp-l')) {
      const focus = focusIndex(word.text)
      const len = Array.from(word.text.slice(focus))[0]?.length ?? 1
      this.q('.rsvp-l').textContent = word.text.slice(0, focus)
      this.q('.rsvp-pivot').textContent = word.text.slice(focus, focus + len)
      this.q('.rsvp-r').textContent = word.text.slice(focus + len)
    }
    const playBtn = this.q('.play')
    playBtn.innerHTML = svg(this.playing ? 'pause' : this.done ? 'replay' : 'play')
    playBtn.title = this.playing ? 'Pause (Space)' : 'Play (Space)'
    ;(this.q('.rsvp-progress') as HTMLInputElement).value = String(this.index)
    ;(this.q('.rsvp-rate') as HTMLInputElement).value = String(this.wpm)
    this.q('.rsvp-wpm').textContent = `${this.wpm} wpm`
    if (this.words.length) {
      const mins = minutesLeft(this.words, this.index, this.wpm)
      this.q('.rsvp-left').textContent = mins < 1 ? `${Math.max(1, Math.round(mins * 60))} s left` : `${Math.round(mins)} min left`
      this.q('.rsvp-hint').textContent = this.playing ? 'Speed reading' : this.done ? 'Finished' : 'Paused'
    }
    if (word && this.index !== this.lastShown) {
      this.lastShown = this.index
      this.opts.onWord?.(word.start)
    }
  }

  /** Jumps to the word at or after `offset` in the text (a click on the page). */
  jumpToOffset(offset: number) {
    this.jump(wordIndexAt(this.words, offset))
  }

  /** Offset in the text of the word on screen. */
  get currentOffset() {
    return this.words[this.index]?.start ?? this.opts.startOffset
  }

  /** Height of the dock, so the page can keep the current line above it. */
  get height() {
    return this.el.getBoundingClientRect().height
  }

  close() {
    this.clear()
    removeEventListener('keydown', this.onKey, true)
    this.el.remove()
    this.opts.onClose(this.words[this.index]?.start ?? this.opts.startOffset)
  }
}
