/**
 * Content script, injected when reading starts (toolbar button, shortcut or right-click menu).
 *
 * One player does read aloud and speed reading together, like the Feeder Android player: the big
 * word follows the voice; mute hands the position to a silent, timer-driven speed reader (any
 * pace), and unmute hands it back so the voice carries on from the word reached. The page
 * highlights and scrolls along in both.
 */
import { RSVP_MAX_WPM, RSVP_MIN_WPM } from '../rsvp'
import { loadSettings, saveSettings, SPEEDS, type FromEngine, type Settings, type StartMessage } from '../shared'
import { indexPage, indexSelection, indexText, type Indexed } from './extract'
import { applyFastRead, fastReadOn, removeFastRead } from './fastread'
import { Player } from './player'
import { Reader } from './reader'
import { SilentReader, WPM_STEP } from './silent'

declare global {
  interface Window {
    __ashSpeechify?: boolean
  }
}

const SKIP_WORDS = 10
// Rough speaking pace at 1×, for "min left" with the voice
const VOICE_WPM = 170

const formatLeft = (mins: number) => (mins < 1 ? `${Math.max(1, Math.round(mins * 60))} s left` : `${Math.round(mins)} min left`)

function main() {
  const reader = new Reader()
  const silent = new SilentReader()
  let settings: Settings | null = null
  let player: Player | null = null
  let roots: Element[] = []
  let pillOffset = -1
  let muted = false
  let restorePad: (() => void) | null = null
  const remap = (old: Text, pieces: { node: Text; from: number }[]) => reader.remap(old, pieces)

  // --- Showing state ------------------------------------------------------------------------

  const voiceMinutesLeft = () => {
    const rest = reader.fullText.slice(reader.currentOffset)
    const words = rest.match(/\S+/g)?.length ?? 0
    return words / (VOICE_WPM * reader.state.rate)
  }

  const render = () => {
    if (!player) return
    const s = reader.state
    const voice = reader.voice
    let message = ''
    if (!muted) {
      if (s.error) message = s.error
      else if (reader.usingKokoro && s.engine?.state === 'loading')
        message =
          s.engine.progress > 0 && s.engine.progress < 1
            ? `Downloading natural voice ${Math.round(s.engine.progress * 100)}% (one time)`
            : 'Loading natural voice…'
      else if (s.status === 'loading') message = 'Preparing speech…'
    }
    const count = muted ? silent.words.length : s.sentences
    player.render(
      muted
        ? {
            muted,
            playing: silent.playing,
            label: 'Speed read',
            title: silent.words.length ? formatLeft(silent.minutesLeft) : 'Nothing to read',
            speed: `${silent.wpm} wpm`,
            slowerEnabled: silent.wpm > RSVP_MIN_WPM,
            fasterEnabled: silent.wpm < RSVP_MAX_WPM,
            position: silent.index,
            count,
            leftText: `Word ${silent.index + 1}`,
            rightText: `${count} words`,
            message,
            error: false,
            voice,
            showWord: !!settings?.showWord,
            fastRead: fastReadOn(),
          }
        : {
            muted,
            playing: s.status === 'playing' || s.status === 'loading',
            label: 'Now reading',
            title: document.title || location.hostname,
            speed: `${+s.rate.toFixed(2)}×`,
            slowerEnabled: s.rate > SPEEDS[0],
            fasterEnabled: s.rate < SPEEDS[SPEEDS.length - 1],
            position: s.sentence,
            count,
            leftText: count ? `Sentence ${Math.min(s.sentence + 1, count)} of ${count}` : 'Nothing to read',
            rightText: count ? formatLeft(voiceMinutesLeft()) : '',
            message,
            error: !!s.error,
            voice,
            showWord: !!settings?.showWord,
            fastRead: fastReadOn(),
          },
    )
    updateInset()
  }

  /** Keeps the line being read above the panel, with room at the end of the page to get there. */
  const updateInset = () => {
    if (!player?.host.isConnected) return
    const h = Math.ceil(player.height)
    reader.bottomInset = h + 8
    const html = document.documentElement
    if (!restorePad) {
      const old = html.style.paddingBottom
      restorePad = () => (html.style.paddingBottom = old)
    }
    html.style.paddingBottom = `${h}px`
  }

  reader.subscribe(() => render())
  reader.onWord = (start, end) => {
    if (!muted) player?.showWord(reader.fullText.slice(start, end))
  }
  silent.onWord = (w) => {
    player?.showWord(w.text)
    if (reader.canHighlight) reader.followAt(w.start)
  }
  silent.onChange = () => render()

  // --- Fast read --------------------------------------------------------------------------------

  const setFastRead = (on: boolean) => {
    // Applying again only bolds text that isn't bold yet (a new selection, say)
    if (on) applyFastRead(reader.textNodes, remap)
    if (!on && fastReadOn()) removeFastRead(remap)
    reader.refreshHighlight()
    render()
  }

  const toggleFastRead = () => {
    const on = !fastReadOn()
    setFastRead(on)
    if (settings) settings.fastRead = on
    void saveSettings({ fastRead: on })
  }

  // --- Voice / speed read hand-over -------------------------------------------------------------

  /** Mutes the voice and speed reads from where it was (or from `offset`). */
  const mute = (offset?: number, play?: boolean) => {
    const voicePlaying = reader.state.status === 'playing' || reader.state.status === 'loading'
    const at = offset ?? (reader.state.status === 'idle' ? reader.currentOffset : reader.currentWordOffset)
    if (voicePlaying) reader.pause()
    muted = true
    silent.wpm = settings?.rsvpWpm ?? 300
    player?.hidePill()
    reader.showTapWord(null)
    silent.start(reader.fullText, at, play ?? voicePlaying)
  }

  /** Turns the voice back on from the word reached; it keeps playing if speed read was. */
  const unmute = (offset?: number, play?: boolean) => {
    const at = offset ?? silent.currentOffset
    const wasPlaying = play ?? silent.playing
    silent.stop()
    muted = false
    if (wasPlaying) reader.play(at)
    else reader.moveTo(at)
    render()
  }

  const setMuted = (m: boolean) => (m ? mute() : unmute())

  const togglePlay = () => (muted ? silent.toggle() : reader.toggle())

  // --- Player -----------------------------------------------------------------------------------

  const applySettings = (s: Settings) => {
    settings = s
    reader.voice = s.voice
    reader.gpu = s.gpu
    reader.autoScroll = s.autoScroll
    if (reader.state.rate !== s.rate) reader.setRate(s.rate)
    if (silent.wpm !== s.rsvpWpm) silent.setWpm(s.rsvpWpm)
  }

  const stepRate = (dir: number) => {
    const rate = reader.state.rate
    let i = SPEEDS.findIndex((x) => x >= rate - 0.001)
    if (i < 0) i = SPEEDS.length - 1
    if (SPEEDS[i] > rate + 0.001 && dir > 0) i--
    const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))]
    reader.setRate(next)
    void saveSettings({ rate: next })
  }

  const stepWpm = (dir: number) => {
    silent.setWpm(silent.wpm + dir * WPM_STEP)
    if (settings) settings.rsvpWpm = silent.wpm
    void saveSettings({ rsvpWpm: silent.wpm })
  }

  const close = () => {
    silent.stop()
    muted = false
    reader.stop()
    setFastRead(false)
    player?.hidePill()
    player?.host.remove()
    restorePad?.()
    restorePad = null
    reader.bottomInset = 140
  }

  const ensurePlayer = () => {
    if (player) {
      if (!player.host.isConnected) document.documentElement.appendChild(player.host)
      return player
    }
    player = new Player({
      toggle: togglePlay,
      back: () => (muted ? silent.skipWords(-SKIP_WORDS) : reader.skip(-1)),
      forward: () => (muted ? silent.skipWords(SKIP_WORDS) : reader.skip(1)),
      seek: (i) => (muted ? silent.jumpTo(i) : reader.seek(i)),
      slower: () => (muted ? stepWpm(-1) : stepRate(-1)),
      faster: () => (muted ? stepWpm(1) : stepRate(1)),
      setMuted,
      setShowWord: (show) => {
        if (settings) settings.showWord = show
        void saveSettings({ showWord: show })
        render()
      },
      setVoice: (voice) => {
        reader.setVoice(voice)
        if (settings) settings.voice = voice
        void saveSettings({ voice })
      },
      close,
      openSettings: () => chrome.runtime.sendMessage({ target: 'open-options' }),
      readFrom: () => {
        player?.hidePill()
        reader.showTapWord(null)
        if (pillOffset < 0) return
        if (muted) unmute(pillOffset, true)
        else reader.play(pillOffset)
      },
      speedReadFrom: () => mute(pillOffset >= 0 ? pillOffset : undefined, true),
      toggleFastRead,
    })
    document.documentElement.appendChild(player.host)
    return player
  }

  const isOpen = () => !!player?.host.isConnected

  async function start(msg: StartMessage) {
    if (!settings) applySettings(await loadSettings())
    if (isOpen() && reader.hasText) {
      // Already open: the shortcuts act on the player
      if (msg.mode === 'toggle') return togglePlay()
      if (msg.mode === 'fast-read') return toggleFastRead()
      if (msg.mode === 'speed-read') return muted ? unmute() : mute(undefined, true)
    }
    let indexed: Indexed | null = null
    if (msg.mode !== 'page') indexed = indexSelection()
    if (!indexed && msg.mode === 'selection' && msg.text) indexed = indexText(msg.text)
    if (!indexed) indexed = indexPage()
    window.getSelection()?.removeAllRanges()
    silent.stop()
    muted = false
    roots = indexed.roots
    ensurePlayer()
    reader.load(indexed)
    setFastRead(!!settings?.fastRead)
    if (msg.mode === 'fast-read') toggleFastRead()
    else if (msg.mode === 'speed-read') mute(0, true)
    else reader.play()
    render()
  }

  chrome.runtime.onMessage.addListener((m: StartMessage | FromEngine) => {
    if (m.type === 'start') void start(m)
    else if (m.type === 'media' && muted) {
      // Media keys drive whichever is active
      if (m.action === 'play') silent.play()
      else if (m.action === 'pause' || m.action === 'stop') silent.pause()
      else if (m.action === 'next') silent.skipWords(SKIP_WORDS)
      else if (m.action === 'previous') silent.skipWords(-SKIP_WORDS)
    } else reader.handleEngine(m)
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !settings) return
    const next = { ...settings }
    for (const [k, v] of Object.entries(changes)) (next as Record<string, unknown>)[k] = v.newValue
    applySettings(next)
    if (changes.voice) reader.setVoice(next.voice)
    if (changes.gpu && reader.usingKokoro) reader.setVoice(next.voice)
    if (changes.fastRead && isOpen()) setFastRead(next.fastRead)
    render()
  })

  // Click a word: jump there (voice or speed read), or offer "Read from here" / "Speed read" when paused
  document.addEventListener(
    'click',
    (e) => {
      if (!isOpen() || !settings?.clickToRead || !reader.canHighlight || e.button !== 0) return
      if (e.composedPath().includes(player!.host)) return
      const target = e.target as Element | null
      if (!target || target.closest('a,button,input,textarea,select,label,summary,[contenteditable],[role=button]')) return
      if (!roots.some((r) => r.contains(target))) return
      if (!window.getSelection()?.isCollapsed) return
      const offset = reader.offsetAtPoint(e.clientX, e.clientY)
      if (offset < 0) return
      if (muted) {
        silent.jumpToOffset(offset)
        return
      }
      if (reader.state.status === 'playing' || reader.state.status === 'loading') {
        reader.play(offset)
        player!.hidePill()
      } else {
        pillOffset = offset
        reader.showTapWord(offset)
        player!.showPill(e.clientX, e.clientY)
      }
    },
    true,
  )
  addEventListener(
    'scroll',
    () => {
      if (pillOffset >= 0) {
        player?.hidePill()
        reader.showTapWord(null)
        pillOffset = -1
      }
    },
    { passive: true },
  )
  addEventListener('resize', () => updateInset())
}

if (!window.__ashSpeechify) {
  window.__ashSpeechify = true
  main()
}
