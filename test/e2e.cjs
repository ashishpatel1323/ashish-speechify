// Loads the test build in Chromium, reads test/article.html aloud with the fake voice and checks
// what gets read, the highlights, skip, pause/resume, click-to-read and the player.
const { chromium } = require('playwright')
const http = require('http')
const fs = require('fs')
const path = require('path')

const ext = path.resolve(__dirname, '../dist-test')
const shots = process.argv[2] || path.resolve(__dirname, '../shots')
fs.mkdirSync(shots, { recursive: true })
const server = http.createServer((q, r) => {
  r.setHeader('content-type', 'text/html')
  r.end(fs.readFileSync(path.join(__dirname, 'article.html')))
}).listen(8765)

const assert = (c, m) => { if (!c) throw new Error('FAILED: ' + m); console.log('ok -', m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const ctx = await chromium.launchPersistentContext('', {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--autoplay-policy=no-user-gesture-required'],
    viewport: { width: 1200, height: 800 },
  })
  let [sw] = ctx.serviceWorkers()
  sw ??= await ctx.waitForEvent('serviceworker')
  const page = await ctx.newPage()
  page.on('console', (m) => console.log('[page]', m.text()))
  await page.goto('http://localhost:8765/')
  const start = (mode) => sw.evaluate(async (mode) => {
    const [tab] = await chrome.tabs.query({ url: 'http://localhost:8765/*' })
    await globalThis.ashStart(tab, { type: 'start', mode })
  }, mode)
  const hl = (name) => page.evaluate((n) => { const h = CSS.highlights.get(n); return h ? [...h][0].toString() : null }, name)

  await start('toggle')
  await page.waitForSelector('ash-speechify-player', { state: 'attached' })
  await sleep(1500)
  const s1 = await hl('ash-speechify-sentence')
  assert(s1 && s1.startsWith('The quiet return'), `first sentence is the headline: ${JSON.stringify(s1)}`)
  const w1 = await hl('ash-speechify-word')
  assert(!!w1, `a word is highlighted: ${JSON.stringify(w1)}`)
  await page.screenshot({ path: `${shots}/1-reading.png` })

  // Skip forward via the player (closed shadow root: click by position)
  await start('toggle') // pause
  await sleep(400)
  const pausedSentence = await hl('ash-speechify-sentence')
  await sleep(800)
  assert((await hl('ash-speechify-sentence')) === pausedSentence, 'paused stays on the sentence')
  await start('toggle') // resume
  await sleep(300)

  // Wait until it moves past the headline and byline
  let s
  for (let i = 0; i < 40; i++) { s = await hl('ash-speechify-sentence'); if (s && s.startsWith('Across Europe')) break; await sleep(250) }
  assert(s && s.startsWith('Across Europe'), `moves on to the article body: ${JSON.stringify(s)}`)

  // Click-to-read: click inside the "Prices" paragraph while playing
  const p = await page.locator('p', { hasText: 'Prices remain' }).boundingBox()
  await page.mouse.click(p.x + 40, p.y + 10)
  await sleep(1200)
  s = await hl('ash-speechify-sentence')
  assert(s && s.startsWith('Prices remain'), `click jumps to that sentence: ${JSON.stringify(s)}`)
  await page.screenshot({ path: `${shots}/2-click-to-read.png` })

  // pause then click shows pill
  await start('toggle')
  await sleep(400)
  const q = await page.locator('blockquote').boundingBox()
  await page.mouse.click(q.x + 60, q.y + 10)
  await sleep(300)
  assert(!!(await hl('ash-speechify-tap')), 'paused click marks the word for "Read from here"')
  await page.screenshot({ path: `${shots}/3-read-from-here.png` })
  // Click the pill (it sits ~48px above the click point, centred)
  await page.mouse.click(q.x + 60, q.y + 10 - 48 + 14)
  await sleep(1200)
  s = await hl('ash-speechify-sentence')
  assert(s && s.includes('It feels like'), `pill reads from the quote: ${JSON.stringify(s)}`)

  // Selection mode
  await start('toggle') // pause
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((e) => e.textContent.startsWith('The revival'))
    const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 80)
    getSelection().removeAllRanges(); getSelection().addRange(r)
  })
  // close player first so toggle does a fresh start
  await page.evaluate(() => document.querySelector('ash-speechify-player').remove())
  await start('toggle')
  await sleep(1200)
  s = await hl('ash-speechify-sentence')
  assert(s && s.startsWith('The revival started in Austria') && s.length <= 80, `reads only the selection: ${JSON.stringify(s)}`)

  // Check the sidebar is never read: jump to the end
  await page.evaluate(() => document.querySelector('ash-speechify-player').remove())
  await page.evaluate(() => getSelection().removeAllRanges())
  await start('page')
  await sleep(500)
  await page.screenshot({ path: `${shots}/4-player.png`, clip: { x: 200, y: 640, width: 800, height: 160 } })
  // Speed: the + button on the player saves the new rate
  await page.click('ash-speechify-player [data-el=faster]')
  await sleep(300)
  const rate = await sw.evaluate(async () => (await chrome.storage.sync.get('rate')).rate)
  assert(rate === 1.25, `+ raises the speed to 1.25x (got ${rate})`)
  // Close button stops and removes the highlight
  // Fast read while reading: words get bold starts, the highlight still lines up, and the text is unchanged
  const before = await page.evaluate(() => document.querySelector('article').textContent)
  await page.click('ash-speechify-player [data-el=fastread]')
  await sleep(300)
  const bolds = await page.evaluate(() => [...document.querySelectorAll('b.ash-speechify-fr')].slice(0, 6).map((b) => b.textContent))
  assert(bolds.length >= 5 && bolds[0] === 'T' && bolds[1] === 'qui', `fast read bolds word starts: ${JSON.stringify(bolds)}`)
  assert((await page.evaluate(() => document.querySelector('article').textContent)) === before, 'fast read leaves the text itself unchanged')
  assert((await page.evaluate(() => getComputedStyle(document.querySelector('b.ash-speechify-fr')).fontWeight)) === '700', 'bold parts are bold')
  await sleep(1500)
  s = await hl('ash-speechify-sentence')
  assert(s && s.length > 10 && before.includes(s), `sentence highlight still matches the page text: ${JSON.stringify(s)}`)
  assert(!!(await hl('ash-speechify-word')), 'word highlight follows bolded text')
  await page.screenshot({ path: `${shots}/5-fast-read.png` })
  const fr = await sw.evaluate(async () => (await chrome.storage.sync.get('fastRead')).fastRead)
  assert(fr === true, 'fast read setting is saved')

  // Click to read still works on bolded words
  const p2 = await page.locator('p', { hasText: 'For now' }).boundingBox()
  await page.mouse.click(p2.x + 30, p2.y + 10)
  await sleep(1000)
  s = await hl('ash-speechify-sentence')
  assert(s && s.startsWith('For now'), `click to read works with fast read on: ${JSON.stringify(s)}`)

  // Speed read from the player: pauses reading, starts at the current sentence
  await page.click('ash-speechify-player [data-el=speedread]')
  await sleep(200)
  const shown = () => page.evaluate(() => {
    const r = document.querySelector('ash-speechify-player').shadowRoot
    return ['.rsvp-l', '.rsvp-pivot', '.rsvp-r'].map((c) => r.querySelector(c)?.textContent).join('|')
  })
  const w0 = await shown()
  assert(w0.replace(/\|/g, '') === 'For', `speed read starts at the current sentence: ${w0}`)
  await sleep(1400)
  const wNext = await shown()
  assert(wNext !== w0, `words advance: ${wNext}`)
  await page.screenshot({ path: `${shots}/6-speed-read.png` })
  await page.keyboard.press('Space')
  await sleep(200)
  // Subtitle mode: the page stays visible and follows the word being shown
  const dock = await page.evaluate(() => document.querySelector('ash-speechify-player').shadowRoot.querySelector('.rsvp').getBoundingClientRect().height)
  assert(dock < 260, `speed read is a dock at the bottom (${Math.round(dock)}px tall), the page stays visible`)
  const shownWord = (await shown()).replace(/\|/g, '')
  const pageWord = await hl('ash-speechify-word')
  assert(pageWord === shownWord, `the page highlights the word being shown: page ${JSON.stringify(pageWord)}, dock ${JSON.stringify(shownWord)}`)
  s = await hl('ash-speechify-sentence')
  assert(s && s.startsWith('For now'), `the page highlights the sentence too: ${JSON.stringify(s)}`)
  await page.screenshot({ path: `${shots}/7-speed-read-paused.png` })
  // Clicking a word on the page moves speed read there
  const pq = await page.locator('blockquote').boundingBox()
  await page.mouse.click(pq.x + 60, pq.y + 10)
  await sleep(200)
  assert((await hl('ash-speechify-word')) === (await shown()).replace(/\|/g, ''), `clicking the page moves speed read to that word: ${await shown()}`)
  s = await hl('ash-speechify-sentence')
  assert(s && s.includes('It feels like'), `and its sentence: ${JSON.stringify(s)}`)
  await page.keyboard.press('Space')
  await sleep(900)
  await page.keyboard.press('Space')
  assert((await hl('ash-speechify-word')) === (await shown()).replace(/\|/g, ''), `while playing the page keeps up with the dock: ${await shown()}`)
  await page.keyboard.press('ArrowUp')
  await sleep(200)
  const wpm = await sw.evaluate(async () => (await chrome.storage.sync.get('rsvpWpm')).rsvpWpm)
  assert(wpm === 325, `arrow up raises speed read pace (got ${wpm})`)
  await page.keyboard.press('Escape')
  await sleep(300)
  assert(!(await page.evaluate(() => !!document.querySelector('ash-speechify-player').shadowRoot.querySelector('.rsvp'))), 'Esc closes speed read')
  s = await hl('ash-speechify-sentence')
  assert(s && s.includes('It feels like'), `the page marks where speed reading stopped: ${JSON.stringify(s)}`)

  // Turning fast read off restores the page exactly
  const htmlBefore = await page.evaluate(() => document.querySelector('article').innerHTML)
  await page.click('ash-speechify-player [data-el=fastread]')
  await sleep(200)
  assert((await page.evaluate(() => document.querySelectorAll('b.ash-speechify-fr').length)) === 0, 'fast read off removes the bold')
  assert((await page.evaluate(() => document.querySelector('article').textContent)) === before, 'text is back as it was')
  // Reading still works after restoring
  await page.click('ash-speechify-player [data-el=play]')
  await sleep(1200)
  s = await hl('ash-speechify-sentence')
  assert(s && before.includes(s), `read aloud works after fast read is off: ${JSON.stringify(s)}`)

  // Speed read from the "Read from here" pill
  await page.click('ash-speechify-player [data-el=play]') // pause
  await sleep(300)
  const p3 = await page.locator('p', { hasText: 'Why now?' }).boundingBox()
  await page.mouse.click(p3.x + 10, p3.y + 10)
  await sleep(300)
  await page.click('ash-speechify-player [data-el=pillspeed]')
  await sleep(200)
  const w2 = await shown()
  assert(w2.replace(/\|/g, '') === 'Why', `pill starts speed read at the tapped word: ${w2}`)
  await page.keyboard.press('Escape')

  await page.click('ash-speechify-player [data-el=close]')
  await sleep(300)
  assert((await hl('ash-speechify-sentence')) === null, 'close stops reading and clears highlights')

  // Keyboard-shortcut path: speed read straight from a fresh page
  await page.reload()
  await start('speed-read')
  await sleep(300)
  const w3 = await shown()
  assert(w3.replace(/\|/g, '') === 'The', `speed read shortcut opens on a fresh page at the headline: ${w3}`)
  console.log('all done')
  await ctx.close()
  server.close()
})().catch(async (e) => { console.error(e); process.exit(1) })
