/**
 * Content script, injected when reading starts (toolbar button, shortcut or right-click menu).
 */
import { loadSettings, saveSettings, type FromEngine, type Settings, type StartMessage } from '../shared'
import { indexPage, indexSelection, indexText, type Indexed } from './extract'
import { Player } from './player'
import { applyFastRead, fastReadOn, removeFastRead } from './fastread'
import { Reader } from './reader'
import { RsvpView } from './rsvp-view'

declare global {
  interface Window {
    __ashSpeechify?: boolean
  }
}

function main() {
  const reader = new Reader()
  let settings: Settings | null = null
  let player: Player | null = null
  let roots: Element[] = []
  let pillOffset = -1
  let rsvp: RsvpView | null = null
  const remap = (old: Text, pieces: { node: Text; from: number }[]) => reader.remap(old, pieces)

  const setFastRead = (on: boolean) => {
    // Applying again only bolds text that isn't bold yet (a new selection, say)
    if (on) applyFastRead(reader.textNodes, remap)
    if (!on && fastReadOn()) removeFastRead(remap)
    reader.refreshHighlight()
    player?.setFastRead(on)
  }

  const toggleFastRead = () => {
    const on = !fastReadOn()
    setFastRead(on)
    if (settings) settings.fastRead = on
    void saveSettings({ fastRead: on })
  }

  const speedRead = (offset?: number) => {
    if (rsvp || !player) return
    if (reader.state.status === 'playing' || reader.state.status === 'loading') reader.pause()
    player.hidePill()
    reader.showTapWord(null)
    const from = offset ?? (reader.state.status === 'idle' ? 0 : reader.currentOffset)
    rsvp = new RsvpView(player.root, {
      text: reader.fullText,
      startOffset: from,
      title: document.title,
      wpm: settings?.rsvpWpm ?? 300,
      onWpm: (wpm) => {
        if (settings) settings.rsvpWpm = wpm
        void saveSettings({ rsvpWpm: wpm })
      },
      onClose: (reached) => {
        rsvp = null
        if (reader.canHighlight) reader.moveTo(reached)
      },
    })
  }

  const applySettings = (s: Settings) => {
    settings = s
    reader.voice = s.voice
    reader.gpu = s.gpu
    reader.autoScroll = s.autoScroll
    if (reader.state.rate !== s.rate) reader.setRate(s.rate)
  }

  const ensurePlayer = () => {
    if (player) {
      if (!player.host.isConnected) document.documentElement.appendChild(player.host)
      return player
    }
    player = new Player({
      toggle: () => reader.toggle(),
      skip: (d) => reader.skip(d),
      setRate: (rate) => {
        reader.setRate(rate)
        void saveSettings({ rate })
      },
      setVoice: (voice) => {
        reader.setVoice(voice)
        if (settings) settings.voice = voice
        void saveSettings({ voice })
      },
      close: () => {
        reader.stop()
        setFastRead(false)
        player?.hidePill()
        player?.host.remove()
      },
      openSettings: () => chrome.runtime.sendMessage({ target: 'open-options' }),
      readFrom: () => {
        player?.hidePill()
        reader.showTapWord(null)
        if (pillOffset >= 0) reader.play(pillOffset)
      },
      speedReadFrom: () => speedRead(pillOffset >= 0 ? pillOffset : undefined),
      toggleFastRead,
      speedRead: () => speedRead(),
    })
    document.documentElement.appendChild(player.host)
    reader.subscribe((s) => player?.update(s, reader.voice))
    return player
  }

  const isOpen = () => !!player?.host.isConnected

  async function start(msg: StartMessage) {
    if (!settings) applySettings(await loadSettings())
    if (msg.mode === 'toggle' && isOpen() && reader.hasText) {
      reader.toggle()
      return
    }
    // Fast read and speed read work on what's already open, or open the page without speaking
    const extra = msg.mode === 'fast-read' || msg.mode === 'speed-read'
    if (extra && isOpen() && reader.hasText) {
      if (msg.mode === 'fast-read') toggleFastRead()
      else if (rsvp) rsvp.close()
      else speedRead()
      return
    }
    let indexed: Indexed | null = null
    if (msg.mode !== 'page') indexed = indexSelection()
    if (!indexed && msg.mode === 'selection' && msg.text) indexed = indexText(msg.text)
    if (!indexed) indexed = indexPage()
    window.getSelection()?.removeAllRanges()
    rsvp?.close()
    roots = indexed.roots
    ensurePlayer()
    reader.load(indexed)
    setFastRead(!!settings?.fastRead)
    if (msg.mode === 'fast-read') toggleFastRead()
    else if (msg.mode === 'speed-read') speedRead()
    else reader.play()
  }

  chrome.runtime.onMessage.addListener((m: StartMessage | FromEngine) => {
    if (m.type === 'start') void start(m)
    else reader.handleEngine(m)
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !settings) return
    const next = { ...settings }
    for (const [k, v] of Object.entries(changes)) (next as Record<string, unknown>)[k] = v.newValue
    applySettings(next)
    if (changes.voice) reader.setVoice(next.voice)
    if (changes.gpu && reader.usingKokoro) reader.setVoice(next.voice)
    if (changes.fastRead && isOpen()) setFastRead(next.fastRead)
  })

  // Click a sentence: jump there while reading, or offer "Read from here" when paused
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
  addEventListener('scroll', () => {
    if (pillOffset >= 0) {
      player?.hidePill()
      reader.showTapWord(null)
      pillOffset = -1
    }
  }, { passive: true })
}

if (!window.__ashSpeechify) {
  window.__ashSpeechify = true
  main()
}
