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
  await page.mouse.click(573, 726)
  await sleep(300)
  const rate = await sw.evaluate(async () => (await chrome.storage.sync.get('rate')).rate)
  assert(rate === 1.25, `+ raises the speed to 1.25x (got ${rate})`)
  // Close button stops and removes the highlight
  await page.mouse.click(860, 726)
  await sleep(300)
  assert((await hl('ash-speechify-sentence')) === null, 'close stops reading and clears highlights')
  console.log('all done')
  await ctx.close()
  server.close()
})().catch(async (e) => { console.error(e); process.exit(1) })
