/**
 * Finds what to read on a page: the main article (via Mozilla Readability, mapped back onto the
 * live page so it can be highlighted), or the current selection.
 */
import { Readability } from '@mozilla/readability'
import { FOOTNOTE_SECTION, isFootnoteLink, isFootnoteMarker, isSkippedLine, speechRemovals } from '../speechclean'

export interface Segment {
  node: Text
  /** Offset inside the node where this segment starts (a selection can start mid-node). */
  nodeStart: number
  start: number
  end: number
}

export interface Indexed {
  text: string
  segments: Segment[]
  /** The element that holds the content, used for click-to-read. */
  roots: Element[]
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'BUTTON', 'TEXTAREA', 'INPUT', 'SELECT', 'TEMPLATE', 'IFRAME', 'MATH'])
const BLOCK_TAGS =
  /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE|TD|TH|SECTION|ARTICLE|HEADER|FOOTER|FIGURE|FIGCAPTION|UL|OL|TABLE|TR|BR|HR|DT|DD|MAIN|ASIDE|NAV)$/
// Reading keeps to paragraphs, headings and lists: no captions or tables (as in Feeder)
const READ_BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dd,dt'
// In a whole page these are clutter; a selection reads whatever was selected
const PAGE_CLUTTER_TAGS = new Set(['FIGCAPTION', 'TABLE', 'CAPTION'])
const CHROME = 'nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],[hidden]'
const PLAYER_HOST = 'ash-speechify-player'

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

function visible(el: Element): boolean {
  if (!(el as HTMLElement).getClientRects().length) return false
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.display !== 'none'
}

/** Text before `el` in its paragraph, to tell an exponent (10⁶) from a footnote marker. */
function charBefore(el: Element): string | undefined {
  for (let n: Node | null = el; n; n = n.parentNode) {
    for (let p = n.previousSibling; p; p = p.previousSibling) {
      const t = p.textContent
      if (t) return t[t.length - 1]
    }
    if (n.parentElement && BLOCK_TAGS.test(n.parentElement.tagName)) return undefined
  }
  return undefined
}

/** A paragraph-like block with no blocks inside, so a credit check never drops a whole short article. */
function isLeafBlock(el: Element): boolean {
  if (!BLOCK_TAGS.test(el.tagName)) return false
  for (const c of el.children) if (BLOCK_TAGS.test(c.tagName) && c.tagName !== 'BR') return false
  return true
}

/**
 * Elements skipped with everything inside them: page chrome, and clutter like footnote markers,
 * footnote sections, photo credits and copyright lines (Feeder's read-aloud rules).
 */
function isSkippedElement(el: Element, page: boolean): boolean {
  if (SKIP_TAGS.has(el.tagName) || el.tagName.toLowerCase() === PLAYER_HOST || el.getAttribute('aria-hidden') === 'true') return true
  if (page && PAGE_CLUTTER_TAGS.has(el.tagName)) return true
  const role = el.getAttribute('role')
  if (role === 'doc-noteref' || role === 'doc-endnotes' || role === 'doc-footnote') return true
  if (el.id && FOOTNOTE_SECTION.test(el.id)) return true
  if (el.tagName === 'SUP') return isFootnoteMarker(el.textContent ?? '', !!el.closest('a'), charBefore(el))
  if (el.tagName === 'A') return isFootnoteLink(el.getAttribute('href') ?? '', el.textContent ?? '')
  return isLeafBlock(el) && isSkippedLine(el.textContent ?? '')
}

/** Collects text nodes inside `roots` (in order) into one string with paragraph breaks. */
function indexNodes(roots: Element[], range?: Range): Indexed {
  const raw: Segment[] = []
  let text = ''
  let lastBlock: Element | null = null
  const verdicts = new Map<Element, boolean>()
  const skipped = (n: Node, stopAt: Node | null) => {
    for (let p = n.parentElement; p && p !== stopAt; p = p.parentElement) {
      let v = verdicts.get(p)
      if (v === undefined) verdicts.set(p, (v = isSkippedElement(p, !range)))
      if (v) return true
    }
    return false
  }
  for (const root of roots) {
    // A picked block that is itself a credit or copyright line is skipped whole
    if (!range && isSkippedElement(root, true)) continue
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (!n.textContent) return NodeFilter.FILTER_REJECT
        if (range && !range.intersectsNode(n)) return NodeFilter.FILTER_REJECT
        if (skipped(n, root.parentElement)) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      let from = 0
      let to = n.textContent!.length
      if (range) {
        if (n === range.startContainer) from = range.startOffset
        if (n === range.endContainer) to = range.endOffset
        if (to <= from) continue
      }
      const parent = n.parentElement
      if (parent && !range && !visible(parent)) continue
      let block: Element | null = parent
      while (block && block !== root && !BLOCK_TAGS.test(block.tagName)) block = block.parentElement
      if (lastBlock && block !== lastBlock && text && !/\s$/.test(text)) text += '\n\n'
      lastBlock = block
      const start = text.length
      text += n.textContent!.slice(from, to)
      raw.push({ node: n, nodeStart: from, start, end: text.length })
    }
    // Keep separate roots in separate sentences
    if (text && !/\s$/.test(text)) text += '\n\n'
    lastBlock = null
  }
  return dropRemovals(text, raw, roots)
}

/**
 * Leaves reference numbers, URLs and citations out of the text that is read; the pieces around
 * them keep pointing at their text nodes, so highlights and click to read land on the right words.
 */
function dropRemovals(text: string, raw: Segment[], roots: Element[]): Indexed {
  const removed = new Uint8Array(text.length)
  for (const [s, e] of speechRemovals(text)) removed.fill(1, s, e)
  const newIndex = new Int32Array(text.length + 1)
  let kept = ''
  for (let i = 0; i < text.length; i++) {
    newIndex[i] = kept.length
    if (!removed[i]) kept += text[i]
  }
  newIndex[text.length] = kept.length
  const segments: Segment[] = []
  for (const g of raw) {
    for (let i = g.start; i < g.end; ) {
      if (removed[i]) {
        i++
        continue
      }
      let j = i
      while (j < g.end && !removed[j]) j++
      segments.push({ node: g.node, nodeStart: g.nodeStart + (i - g.start), start: newIndex[i], end: newIndex[i] + (j - i) })
      i = j
    }
  }
  return { text: kept, segments, roots }
}

/** Blocks of the live page that make up the main article. */
function articleBlocks(): Element[] {
  let articleText = ''
  let title = ''
  try {
    const clone = document.cloneNode(true) as Document
    clone.querySelectorAll(PLAYER_HOST).forEach((e) => e.remove())
    const parsed = new Readability(clone, { charThreshold: 200 }).parse()
    articleText = norm(parsed?.textContent ?? '')
    title = norm(parsed?.title ?? '')
  } catch (e) {
    console.warn('Readability failed', e)
  }

  const all = [...document.body.querySelectorAll(READ_BLOCKS)].filter((el) => !el.closest(PLAYER_HOST))
  const picked: Element[] = []
  const take = (el: Element) => {
    // A list item holding paragraphs is taken whole; skip what's inside something taken
    if (picked.some((p) => p.contains(el))) return
    picked.push(el)
  }

  if (articleText.length > 200) {
    // Long blocks that Readability kept mark the article; short ones (headings, captions) count
    // when they sit between the first and last of those
    const matches = all.map((el) => {
      const t = norm(el.textContent ?? '')
      const inArticle = t.length > 0 && (articleText.includes(t) || (/^H[1-3]$/.test(el.tagName) && t === title))
      return { el, t, hit: inArticle && visible(el) }
    })
    const strong = matches.filter((m) => m.hit && m.t.length >= 40)
    if (strong.length) {
      const first = matches.indexOf(strong[0])
      const last = matches.indexOf(strong[strong.length - 1])
      // Include the article's heading just above the first paragraph
      let from = first
      for (let i = first - 1; i >= 0 && i >= first - 15; i--) {
        if (/^H[1-3]$/.test(matches[i].el.tagName) && matches[i].hit) {
          from = i
          break
        }
      }
      for (let i = from; i <= last; i++) if (matches[i].hit) take(matches[i].el)
      if (picked.length) return picked
    }
  }

  // No article found: everything readable outside menus, headers and footers
  for (const el of all) if (!el.closest(CHROME) && visible(el) && norm(el.textContent ?? '')) take(el)
  return picked.length ? picked : [document.body]
}

export function indexPage(): Indexed {
  return indexNodes(articleBlocks())
}

/** The current selection, or null when nothing (or only whitespace) is selected. */
export function indexSelection(): Indexed | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount || !norm(sel.toString())) return null
  const range = sel.getRangeAt(0)
  let root: Node = range.commonAncestorContainer
  if (root.nodeType !== Node.ELEMENT_NODE) root = root.parentElement ?? document.body
  const indexed = indexNodes([root as Element], range)
  return indexed.text.trim() ? indexed : null
}

/** Plain text with nothing on the page to highlight (e.g. a selection Chrome told us about). */
export function indexText(text: string): Indexed {
  return dropRemovals(text, [], [])
}
