/**
 * Speed reading with the voice muted: moves through the words on a timer, which can go faster
 * than any voice. Read aloud hands over its position when muted and takes it back when unmuted.
 * Same behaviour as Feeder's SilentSpeedReader (Android) and speed reading rules (src/rsvp.ts).
 */
import { minutesLeft, RSVP_MAX_WPM, RSVP_MIN_WPM, rsvpWords, sentenceStartBefore, wordDelay, wordIndexAt, type RsvpWord } from '../rsvp'

export const WPM_STEP = 25
// The first words after (re)starting are shown a little longer so the eye can settle
const RAMP = [1.8, 1.4, 1.15]

export class SilentReader {
  words: RsvpWord[] = []
  index = 0
  playing = false
  active = false
  wpm = 300
  private timer: number | null = null
  private shownSincePlay = 0
  /** Something changed (play state, position, speed). */
  onChange: (() => void) | null = null
  /** A new word is on screen. */
  onWord: ((w: RsvpWord) => void) | null = null

  get word(): RsvpWord | undefined {
    return this.active ? this.words[this.index] : undefined
  }

  get atEnd() {
    return this.index >= this.words.length - 1
  }

  get currentOffset() {
    return this.words[this.index]?.start ?? 0
  }

  get minutesLeft() {
    return minutesLeft(this.words, this.index, this.wpm)
  }

  /** Starts at the word at `offset` in `text`. */
  start(text: string, offset: number, play: boolean) {
    this.clear()
    this.words = rsvpWords(text)
    this.index = Math.min(wordIndexAt(this.words, offset), Math.max(0, this.words.length - 1))
    this.active = this.words.length > 0
    this.playing = false
    this.show()
    if (play) this.play()
    else this.onChange?.()
  }

  stop() {
    this.clear()
    this.active = false
    this.playing = false
    this.onChange?.()
  }

  play() {
    if (!this.active) return
    if (this.atEnd) {
      this.index = 0
      this.show()
    }
    this.playing = true
    this.run()
    this.onChange?.()
  }

  pause() {
    this.clear()
    this.playing = false
    this.onChange?.()
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  jumpTo(i: number) {
    this.index = Math.min(Math.max(0, i), Math.max(0, this.words.length - 1))
    this.show()
    if (this.playing) this.run()
    this.onChange?.()
  }

  jumpToOffset(offset: number) {
    this.jumpTo(wordIndexAt(this.words, offset))
  }

  skipWords(n: number) {
    this.jumpTo(this.index + n)
  }

  backSentence() {
    this.jumpTo(sentenceStartBefore(this.words, this.index))
  }

  setWpm(v: number) {
    this.wpm = Math.min(RSVP_MAX_WPM, Math.max(RSVP_MIN_WPM, Math.round(v / WPM_STEP) * WPM_STEP))
    this.onChange?.()
  }

  private show() {
    const w = this.word
    if (w) this.onWord?.(w)
  }

  private clear() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private run() {
    this.clear()
    this.shownSincePlay = 0
    const step = () => {
      const w = this.words[this.index]
      if (!this.playing || !w) return
      const ramp = RAMP[this.shownSincePlay] ?? 1
      this.timer = window.setTimeout(() => {
        this.shownSincePlay++
        if (this.atEnd) {
          this.playing = false
          this.timer = null
          this.onChange?.()
          return
        }
        this.index++
        this.show()
        this.onChange?.()
        step()
      }, wordDelay(w, this.wpm) * ramp)
    }
    step()
  }
}
