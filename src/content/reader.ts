/**
 * Reads indexed page text aloud one sentence at a time, highlighting the sentence and the word.
 * Ported from Feeder Web's read-aloud engine. The natural voice runs in the extension's offscreen
 * document; browser voices (Web Speech) run right here in the page.
 */
import { isKokoroVoice, KOKORO_PREFIX, type EngineStatus, type FromEngine, type ToEngine } from '../shared'
import type { Indexed, Segment } from './extract'

interface Span {
  start: number
  end: number
}

export type ReaderStatus = 'idle' | 'loading' | 'playing' | 'paused'

export interface ReaderState {
  status: ReaderStatus
  sentence: number
  sentences: number
  rate: number
  engine: EngineStatus | null
  error: string | null
}

const HL_SENTENCE = 'ash-speechify-sentence'
const HL_WORD = 'ash-speechify-word'
const HL_TAP = 'ash-speechify-tap'

const highlights = () => (typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null)
const hasSpeech = () => 'speechSynthesis' in window
const cancelSpeech = () => {
  if (hasSpeech()) speechSynthesis.cancel()
}

/** Kokoro reads at most ~500 phonemes at once: split long sentences at punctuation, then spaces. */
export function chunkForKokoro(text: string, max = 280): Span[] {
  const out: Span[] = []
  let pos = 0
  while (pos < text.length) {
    let end = Math.min(text.length, pos + max)
    if (end < text.length) {
      const win = text.slice(pos, end)
      const punct = Math.max(win.lastIndexOf(', '), win.lastIndexOf('; '), win.lastIndexOf(': '), win.lastIndexOf(' – '), win.lastIndexOf(' — '))
      const space = win.lastIndexOf(' ')
      const cut = punct > max / 3 ? punct + 1 : space > 0 ? space : win.length
      end = pos + cut
    }
    if (text.slice(pos, end).trim()) out.push({ start: pos, end })
    pos = end
    while (pos < text.length && /\s/.test(text[pos])) pos++
  }
  return out
}

export function splitSentences(text: string, lang: string): Span[] {
  const out: Span[] = []
  const push = (start: number, end: number) => {
    const slice = text.slice(start, end)
    const re = /\S(?:[^\n]|\n(?!\s*\n))*/g
    for (let m = re.exec(slice); m; m = re.exec(slice)) {
      const body = m[0].trimEnd()
      if (/[\p{L}\p{N}]/u.test(body)) out.push({ start: start + m.index, end: start + m.index + body.length })
    }
  }
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(lang, { granularity: 'sentence' })
    for (const s of seg.segment(text)) push(s.index, s.index + s.segment.length)
  } else {
    const re = /[^.!?\n]+[.!?]*["')\]]*\s*/g
    for (let m = re.exec(text); m; m = re.exec(text)) push(m.index, m.index + m[0].length)
  }
  return out
}

type Listener = (s: ReaderState) => void

export class Reader {
  private text = ''
  private segments: Segment[] = []
  private sentences: Span[] = []
  private listeners = new Set<Listener>()
  private generation = 0
  private failures = 0
  private timer: number | null = null
  private frame: number | null = null
  private lang = 'en'
  private nextId = 1
  /** The natural-voice chunk being played, waiting for its end. */
  private chunk: { id: number; done: (ok: boolean) => void; pos: { time: number; rate: number; at: number; playing: boolean } | null } | null = null
  private lastUserScroll = 0

  voice = ''
  gpu = false
  autoScroll = true
  onSentence: ((i: number) => void) | null = null

  state: ReaderState = { status: 'idle', sentence: 0, sentences: 0, rate: 1, engine: null, error: null }

  constructor() {
    const mark = () => (this.lastUserScroll = performance.now())
    addEventListener('wheel', mark, { passive: true })
    addEventListener('touchmove', mark, { passive: true })
    addEventListener('keydown', (e: KeyboardEvent) => {
      if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(e.key)) mark()
    })
  }

  get usingKokoro() {
    return isKokoroVoice(this.voice)
  }

  get hasText() {
    return this.sentences.length > 0
  }

  get canHighlight() {
    return this.segments.length > 0
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    l(this.state)
    return () => this.listeners.delete(l)
  }

  private set(patch: Partial<ReaderState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l(this.state))
  }

  load(indexed: Indexed) {
    this.stop()
    this.text = indexed.text
    this.segments = indexed.segments
    this.lang = document.documentElement.lang || navigator.language || 'en'
    this.sentences = splitSentences(this.text, this.lang)
    this.set({ sentences: this.sentences.length, sentence: 0, error: null })
  }

  sentenceText(i: number) {
    const s = this.sentences[i]
    return s ? this.text.slice(s.start, s.end) : ''
  }

  // --- Mapping between text offsets and the page --------------------------------------------

  rangeFor(start: number, end: number): Range | null {
    const s = this.segments.find((g) => start >= g.start && start < g.end)
    let e: Segment | undefined
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const g = this.segments[i]
      if (end > g.start && end <= g.end) {
        e = g
        break
      }
    }
    if (!s || !e || !s.node.isConnected || !e.node.isConnected) return null
    try {
      const r = document.createRange()
      r.setStart(s.node, s.nodeStart + start - s.start)
      r.setEnd(e.node, e.nodeStart + end - e.start)
      return r
    } catch {
      return null
    }
  }

  offsetOf(node: Node, offset: number): number {
    const seg = this.segments.find((g) => g.node === node && offset >= g.nodeStart && offset <= g.nodeStart + (g.end - g.start))
    return seg ? seg.start + (offset - seg.nodeStart) : -1
  }

  offsetAtPoint(x: number, y: number): number {
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    }
    const pos = doc.caretPositionFromPoint?.(x, y)
    if (pos) return this.offsetOf(pos.offsetNode, pos.offset)
    const range = document.caretRangeFromPoint?.(x, y)
    return range ? this.offsetOf(range.startContainer, range.startOffset) : -1
  }

  wordAt(offset: number): Span | null {
    if (offset < 0 || offset > this.text.length) return null
    const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}'’-]/u.test(c)
    if (!isWord(this.text[offset]) && isWord(this.text[offset - 1])) offset--
    if (!isWord(this.text[offset])) return null
    let s = offset
    let e = offset
    while (s > 0 && isWord(this.text[s - 1])) s--
    while (e < this.text.length && isWord(this.text[e])) e++
    return { start: s, end: e }
  }

  sentenceIndexAt(offset: number): number {
    const i = this.sentences.findIndex((s) => offset < s.end)
    return i < 0 ? this.sentences.length - 1 : i
  }

  showTapWord(offset: number | null) {
    const hl = highlights()
    if (!hl) return
    hl.delete(HL_TAP)
    if (offset === null) return
    const w = this.wordAt(offset)
    const r = w && this.rangeFor(w.start, w.end)
    if (r) hl.set(HL_TAP, new Highlight(r))
  }

  private highlightSentence(i: number) {
    const hl = highlights()
    const s = this.sentences[i]
    if (!hl || !s) return
    hl.delete(HL_WORD)
    const r = this.rangeFor(s.start, s.end)
    if (!r) {
      hl.delete(HL_SENTENCE)
      return
    }
    hl.set(HL_SENTENCE, new Highlight(r))
    // Keep it in view, unless the reader scrolled away just now
    if (!this.autoScroll || performance.now() - this.lastUserScroll < 5000) return
    const rect = r.getBoundingClientRect()
    if (rect.top < 60 || rect.bottom > innerHeight - 140) {
      scrollBy({ top: rect.top - innerHeight * 0.35, behavior: 'smooth' })
    }
  }

  private highlightWord(start: number, end: number) {
    const hl = highlights()
    if (!hl) return
    const r = this.rangeFor(start, end)
    if (r) hl.set(HL_WORD, new Highlight(r))
  }

  private clearHighlights() {
    const hl = highlights()
    hl?.delete(HL_SENTENCE)
    hl?.delete(HL_WORD)
    hl?.delete(HL_TAP)
  }

  // --- Controls -------------------------------------------------------------------------------

  play(fromOffset?: number) {
    if (!this.sentences.length) return
    if (fromOffset !== undefined && fromOffset >= 0) {
      this.speakFrom(this.sentenceIndexAt(fromOffset), fromOffset)
      return
    }
    // A paused natural-voice sentence carries on where it stopped
    if (this.state.status === 'paused' && this.chunk?.pos) {
      this.send({ type: 'resume', id: this.chunk.id })
      this.set({ status: 'playing' })
      return
    }
    const i = this.state.sentence >= this.sentences.length ? 0 : this.state.sentence
    this.speakFrom(i, null)
  }

  pause() {
    if (this.usingKokoro && this.chunk?.pos) {
      this.send({ type: 'pause' })
      this.set({ status: 'paused' })
      return
    }
    this.halt()
    this.set({ status: 'paused' })
  }

  toggle() {
    if (this.state.status === 'playing' || this.state.status === 'loading') this.pause()
    else this.play()
  }

  stop() {
    this.halt()
    this.clearHighlights()
    this.set({ status: 'idle', sentence: 0 })
  }

  skip(delta: number) {
    if (!this.sentences.length) return
    const i = Math.max(0, Math.min(this.sentences.length - 1, this.state.sentence + delta))
    if (this.state.status === 'playing' || this.state.status === 'loading') this.speakFrom(i, null)
    else {
      this.halt()
      this.set({ sentence: i })
      this.highlightSentence(i)
    }
  }

  setRate(rate: number) {
    this.set({ rate })
    if (this.usingKokoro) this.send({ type: 'rate', rate })
    else if (this.state.status === 'playing') this.speakFrom(this.state.sentence, null)
  }

  setVoice(voice: string) {
    const was = this.state.status
    this.voice = voice
    if (was === 'playing' || was === 'loading') this.speakFrom(this.state.sentence, null)
    else if (was === 'paused') {
      this.halt()
      this.set({ status: 'paused' })
    }
    if (isKokoroVoice(voice)) this.send({ type: 'load', gpu: this.gpu })
  }

  /** Stops whatever is sounding, without changing the position. */
  private halt() {
    this.generation++
    cancelSpeech()
    this.clearTimers()
    if (this.chunk) {
      this.chunk.done(false)
      this.chunk = null
      this.send({ type: 'stop' })
    }
  }

  private clearTimers() {
    if (this.timer !== null) clearTimeout(this.timer)
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.timer = null
    this.frame = null
  }

  private send(msg: ToEngine) {
    chrome.runtime.sendMessage({ target: 'engine', msg }).catch(() => undefined)
  }

  private fail(message: string) {
    this.halt()
    this.set({ status: 'paused', error: message })
  }

  // --- Speaking ---------------------------------------------------------------------------------

  private speakFrom(index: number, fromOffset: number | null) {
    this.halt()
    const gen = this.generation
    const sentence = this.sentences[index]
    if (!sentence) {
      this.clearHighlights()
      this.set({ status: 'idle', sentence: 0 })
      return
    }
    const start = fromOffset !== null && fromOffset > sentence.start && fromOffset < sentence.end ? fromOffset : sentence.start
    const word = this.wordAt(start)
    const begin = word ? word.start : start
    this.set({ status: this.usingKokoro ? 'loading' : 'playing', sentence: index, error: null })
    this.highlightSentence(index)
    this.onSentence?.(index)
    if (this.usingKokoro) void this.speakKokoro(gen, index, begin, sentence.end)
    else this.speakBrowser(gen, index, begin, sentence.end)
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    const voices = speechSynthesis.getVoices()
    const v = voices.find((v) => v.voiceURI === this.voice)
    if (v) return v
    const base = this.lang.split('-')[0].toLowerCase()
    return voices.find((v) => v.default && v.lang.toLowerCase().startsWith(base)) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? null
  }

  private speakBrowser(gen: number, index: number, begin: number, end: number) {
    if (!hasSpeech()) {
      this.fail('This browser has no built-in voices. Pick a natural voice.')
      return
    }
    const u = new SpeechSynthesisUtterance(this.text.slice(begin, end))
    const voice = this.pickVoice()
    if (voice) {
      u.voice = voice
      u.lang = voice.lang
    } else u.lang = this.lang
    u.rate = this.state.rate
    let gotBoundary = false
    u.onboundary = (e) => {
      if (gen !== this.generation || e.name !== 'word') return
      if (!gotBoundary) {
        gotBoundary = true
        this.clearTimers()
      }
      const ws = begin + e.charIndex
      let we = e.charLength ? ws + e.charLength : ws
      if (!e.charLength) while (we < end && !/\s/.test(this.text[we])) we++
      this.highlightWord(ws, we)
    }
    u.onstart = () => {
      if (gen !== this.generation) return
      // No word events shortly after starting: estimate instead
      this.timer = window.setTimeout(() => {
        if (gen === this.generation && !gotBoundary) this.estimateWords(gen, begin, end, 350)
      }, 350)
    }
    u.onend = () => {
      if (gen !== this.generation) return
      this.failures = 0
      this.speakFrom(index + 1, null)
    }
    u.onerror = (e) => {
      if (gen !== this.generation || e.error === 'interrupted' || e.error === 'canceled') return
      if (++this.failures >= 3) {
        this.failures = 0
        this.fail(`The voice failed (${e.error}). Try another voice.`)
        return
      }
      this.speakFrom(index + 1, null)
    }
    speechSynthesis.speak(u)
  }

  /** Moves the word highlight along at an estimated pace (about 14 characters a second at 1x). */
  private estimateWords(gen: number, from: number, to: number, alreadyMs: number) {
    const words: Span[] = []
    const re = /\S+/g
    const slice = this.text.slice(from, to)
    for (let m = re.exec(slice); m; m = re.exec(slice)) words.push({ start: from + m.index, end: from + m.index + m[0].length })
    const msPerChar = 1000 / (14 * this.state.rate)
    let t = -alreadyMs
    const at: number[] = []
    for (const w of words) {
      at.push(Math.max(0, t))
      t += (w.end - w.start + 1) * msPerChar + 40 / this.state.rate
    }
    let i = 0
    const step = () => {
      if (gen !== this.generation || i >= words.length) return
      this.highlightWord(words[i].start, words[i].end)
      i++
      if (i < words.length) this.timer = window.setTimeout(step, at[i] - at[i - 1])
    }
    step()
  }

  private chunksOf(begin: number, end: number): Span[] {
    return chunkForKokoro(this.text.slice(begin, end)).map((c) => ({ start: begin + c.start, end: begin + c.end }))
  }

  private async speakKokoro(gen: number, index: number, begin: number, end: number) {
    const voice = this.voice.slice(KOKORO_PREFIX.length)
    const chunks = this.chunksOf(begin, end)
    let prefetched = false
    for (const c of chunks) {
      if (gen !== this.generation) return
      const id = this.nextId++
      const done = new Promise<boolean>((resolve) => {
        this.chunk = { id, done: resolve, pos: null }
      })
      this.send({ type: 'speak', id, text: this.text.slice(c.start, c.end), voice, rate: this.state.rate, gpu: this.gpu })
      if (!prefetched) {
        // Generate the next sentence while this one plays
        prefetched = true
        const next = this.sentences[index + 1]
        if (next) for (const n of this.chunksOf(next.start, next.end)) this.send({ type: 'prefetch', text: this.text.slice(n.start, n.end), voice, gpu: this.gpu })
      }
      const words = this.wordsOf(c.start, c.end)
      this.followWords(gen, id, words)
      const ok = await done
      if (gen !== this.generation) return
      if (!ok) {
        if (++this.failures >= 3) {
          this.failures = 0
          this.fail(this.state.error ?? 'The natural voice keeps failing. Try a browser voice.')
          return
        }
      }
    }
    if (gen !== this.generation) return
    this.chunk = null
    this.speakFrom(index + 1, null)
  }

  private wordsOf(from: number, to: number) {
    const words: { start: number; end: number; at: number }[] = []
    const re = /\S+/g
    const slice = this.text.slice(from, to)
    let total = 0
    for (let m = re.exec(slice); m; m = re.exec(slice)) {
      words.push({ start: from + m.index, end: from + m.index + m[0].length, at: total })
      total += m[0].length + 1
    }
    return words.map((w) => ({ ...w, at: w.at / Math.max(1, total) }))
  }

  /** Word highlight from the audio position: words get time in proportion to their length. */
  private followWords(gen: number, id: number, words: { start: number; end: number; at: number }[]) {
    let shown = -1
    let duration = 0
    const tick = () => {
      if (gen !== this.generation || this.chunk?.id !== id) return
      const p = this.chunk.pos
      if (p && duration > 0 && words.length) {
        const time = p.playing ? p.time + ((performance.now() - p.at) / 1000) * p.rate : p.time
        const lead = Math.min(0.15, duration * 0.05)
        const frac = (time - lead) / Math.max(0.1, duration - lead * 2)
        let i = 0
        while (i + 1 < words.length && words[i + 1].at <= frac) i++
        if (i !== shown) {
          shown = i
          this.highlightWord(words[i].start, words[i].end)
        }
      }
      this.frame = requestAnimationFrame(tick)
    }
    this.durationSetter = (d) => (duration = d)
    tick()
  }

  private durationSetter: ((d: number) => void) | null = null

  /** Events from the offscreen voice engine. */
  handleEngine(e: FromEngine) {
    if (e.type === 'engine-status') {
      this.set({ engine: e.status })
      if (e.status.state === 'error' && this.usingKokoro && this.state.status === 'loading') {
        this.fail(`The natural voice could not load: ${e.status.error}`)
      }
      return
    }
    if (e.type === 'media') {
      if (e.action === 'play') this.play()
      else if (e.action === 'pause') this.pause()
      else if (e.action === 'stop') {
        if (this.state.status === 'playing' || this.state.status === 'loading') this.pause()
      } else if (e.action === 'next') this.skip(1)
      else if (e.action === 'previous') this.skip(-1)
      return
    }
    if (!this.chunk || e.id !== this.chunk.id) return
    if (e.type === 'pos') {
      this.chunk.pos = { time: e.time, rate: e.rate, at: performance.now(), playing: e.playing }
      this.durationSetter?.(e.duration)
      if (e.playing && this.state.status === 'loading') this.set({ status: 'playing' })
    } else if (e.type === 'ended') {
      this.failures = 0
      const c = this.chunk
      this.chunk = null
      c.done(true)
    } else if (e.type === 'lost') {
      this.speakFrom(this.state.sentence, null)
    } else if (e.type === 'failed') {
      console.warn('Natural voice failed', e.message)
      this.set({ error: `The natural voice failed: ${e.message}` })
      const c = this.chunk
      this.chunk = null
      c.done(false)
    }
  }
}
