/**
 * Finds what to read on a page: the main article (via Mozilla Readability, mapped back onto the
 * live page so it can be highlighted), or the current selection.
 */
import { Readability } from '@mozilla/readability'

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
const READ_BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,dd,dt,td,th,figcaption'
const CHROME = 'nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[aria-hidden=true],[hidden]'
const PLAYER_HOST = 'ash-speechify-player'

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

function visible(el: Element): boolean {
  if (!(el as HTMLElement).getClientRects().length) return false
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.display !== 'none'
}

function skipped(node: Node, stopAt: Node | null): boolean {
  for (let p = node.parentElement; p && p !== stopAt; p = p.parentElement) {
    if (SKIP_TAGS.has(p.tagName) || p.tagName.toLowerCase() === PLAYER_HOST || p.getAttribute('aria-hidden') === 'true') return true
  }
  return false
}

/** Collects text nodes inside `roots` (in order) into one string with paragraph breaks. */
function indexNodes(roots: Element[], range?: Range): Indexed {
  const segments: Segment[] = []
  let text = ''
  let lastBlock: Element | null = null
  for (const root of roots) {
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
      segments.push({ node: n, nodeStart: from, start, end: text.length })
    }
    // Keep separate roots in separate sentences
    if (text && !/\s$/.test(text)) text += '\n\n'
    lastBlock = null
  }
  return { text, segments, roots }
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
  return { text, segments: [], roots: [] }
}
