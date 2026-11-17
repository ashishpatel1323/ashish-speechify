/*
 * Fast read: the first part of every word is bold, so the eye can jump between these fixation
 * points and the brain fills in the rest of the word.
 *
 * Ported from text-vide by Gumball12 (https://github.com/Gumball12/text-vide), MIT License,
 * Copyright (c) 2022 Gumball12, via Feeder (web/src/lib/fastReading.ts), so the extension bolds
 * the same letters as the reader apps.
 *
 * Unlike Feeder, this works on a live page: text nodes are split and wrapped in place, and every
 * change is recorded so it can be undone exactly and so read aloud can follow the new nodes.
 */

/** How much of each word is bold, from 1 (most) to 5 (least), as in text-vide. */
export const FAST_READING_FIXATION_POINT = 3

const FIXATION_BOUNDARIES: number[][] = [
  [0, 4, 12, 17, 24, 29, 35, 42, 48],
  [1, 2, 7, 10, 13, 14, 19, 22, 25, 28, 31, 34, 37, 40, 43, 46, 49],
  [1, 2, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 49],
  [0, 2, 4, 5, 6, 8, 9, 11, 14, 15, 17, 18, 20, 0, 21, 23, 24, 26, 27, 29, 30, 32, 33, 35, 36, 38, 39, 41, 42, 44, 45, 47, 48],
  [0, 2, 3, 5, 6, 7, 8, 10, 11, 12, 14, 15, 17, 19, 20, 21, 23, 24, 25, 26, 28, 29, 30, 32, 33, 34, 35, 37, 38, 39, 41, 42, 43, 44, 46, 47, 48],
]

// A word holds at least one letter; digits only count inside words
const WORD = /[\p{L}\p{Nd}]*\p{L}[\p{L}\p{Nd}]*/gu

export function fixationLength(wordLength: number, fixationPoint = FAST_READING_FIXATION_POINT): number {
  const boundaries = FIXATION_BOUNDARIES[fixationPoint - 1] ?? FIXATION_BOUNDARIES[0]
  const index = boundaries.findIndex((b) => wordLength <= b)
  const bold = index === -1 ? wordLength - boundaries.length : wordLength - index
  return Math.max(bold, 0)
}

/** The parts of `text` to make bold, as [start, end) pairs. */
export function fastReadingRanges(text: string, fixationPoint = FAST_READING_FIXATION_POINT): [number, number][] {
  const out: [number, number][] = []
  for (const m of text.matchAll(WORD)) {
    const length = fixationLength(m[0].length, fixationPoint)
    if (length > 0) out.push([m.index!, m.index! + length])
  }
  return out
}

/** A text node after splitting: the new node and where it starts in the old node's text. */
export interface Piece {
  node: Text
  from: number
}

/** Called for every replaced text node, so whoever indexed the old node can follow. */
export type Remap = (old: Text, pieces: Piece[]) => void

// Code keeps its own look
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON', 'MATH'])
export const FAST_READ_CLASS = 'ash-speechify-fr'

interface Applied {
  data: string
  /** What replaced the text node, in order: text nodes and <b> elements. */
  parts: Node[]
  pieces: Piece[]
}

let applied: Applied[] = []
/** Text nodes this module made, which must never be split again. */
let made = new WeakSet<Text>()

export const fastReadOn = () => applied.length > 0

/** Bolds word starts in these text nodes (each node once). */
export function applyFastRead(nodes: Iterable<Text>, remap: Remap) {
  const seen = new Set<Text>()
  for (const node of nodes) {
    if (seen.has(node) || made.has(node) || !node.isConnected || !node.parentElement) continue
    seen.add(node)
    let skip = false
    for (let p: Element | null = node.parentElement; p; p = p.parentElement) {
      if (SKIP.has(p.tagName.toUpperCase()) || p.classList.contains(FAST_READ_CLASS) || (p as HTMLElement).isContentEditable) {
        skip = true
        break
      }
    }
    if (skip) continue
    const text = node.data
    const ranges = fastReadingRanges(text)
    if (!ranges.length) continue
    const parts: Node[] = []
    const pieces: Piece[] = []
    let last = 0
    const plain = (from: number, to: number) => {
      const t = document.createTextNode(text.slice(from, to))
      parts.push(t)
      pieces.push({ node: t, from })
    }
    for (const [start, end] of ranges) {
      if (start > last) plain(last, start)
      const b = document.createElement('b')
      b.className = FAST_READ_CLASS
      const t = document.createTextNode(text.slice(start, end))
      b.append(t)
      parts.push(b)
      pieces.push({ node: t, from: start })
      last = end
    }
    if (last < text.length) plain(last, text.length)
    for (const pc of pieces) made.add(pc.node)
    node.replaceWith(...parts)
    applied.push({ data: text, parts, pieces })
    remap(node, pieces)
  }
}

/** Puts every changed text node back as it was. */
export function removeFastRead(remap: Remap) {
  for (const a of applied) {
    const first = a.parts[0]
    if (!first?.parentNode) continue
    const t = document.createTextNode(a.data)
    first.parentNode.insertBefore(t, first)
    for (const p of a.parts) p.parentNode?.removeChild(p)
    // Each piece now lives inside the restored node at its old offset
    for (const piece of a.pieces) remap(piece.node, [{ node: t, from: -piece.from }])
  }
  applied = []
  made = new WeakSet()
}
