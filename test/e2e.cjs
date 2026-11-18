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
  r.end(fs.readFileSync(path.join(__dirname, q.url.startsWith('/clutter') ? 'clutter.html' : 'article.html')))
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

  // Combined player: the big word follows the voice
  const shown = () => page.evaluate(() => {
    const r = document.querySelector('ash-speechify-player').shadowRoot
    return ['wl', 'wp', 'wr'].map((c) => r.querySelector(`[data-el=${c}]`).textContent).join('')
  })
  const panelText = (el) => page.evaluate((el) => document.querySelector('ash-speechify-player').shadowRoot.querySelector(`[data-el=${el}]`).textContent, el)
  await sleep(300)
  let big = await shown()
  let pageWord = await hl('ash-speechify-word')
  assert(big && big === pageWord, `the big word follows the voice: big ${JSON.stringify(big)}, page ${JSON.stringify(pageWord)}`)
  assert((await panelText('speed')).endsWith('×'), `speed shows as × with the voice: ${await panelText('speed')}`)
  await page.screenshot({ path: `${shots}/6-player-voice.png` })

  // Mute: the voice stops and speed read carries on from the same word, on a timer
  const voiceAt = await hl('ash-speechify-word')
  await page.click('ash-speechify-player [data-el=mute]')
  await sleep(100)
  const firstMuted = await shown()
  // (the fake voice is fast, so it may have moved on a word between reading it and the click)
  const sw0 = (await hl('ash-speechify-sentence')).split(/\s+/)
  const gap = sw0.indexOf(firstMuted) - sw0.indexOf(voiceAt)
  assert(gap >= 0 && gap <= 1, `muting picks up at the word the voice reached: ${JSON.stringify(firstMuted)} vs ${JSON.stringify(voiceAt)}`)
  assert((await panelText('speed')) === '300 wpm', `speed shows as wpm when muted: ${await panelText('speed')}`)
  assert((await panelText('label')).toLowerCase() === 'speed read', 'the panel says speed read')
  await sleep(1300)
  big = await shown()
  assert(big !== firstMuted, `muted, words keep moving on their own: ${JSON.stringify(big)}`)
  assert((await hl('ash-speechify-word')).replace(/\|/g, '') === big, `the page follows the speed read word: ${JSON.stringify(await hl('ash-speechify-word'))} vs ${JSON.stringify(big)}`)
  const voiceSentenceStill = await page.evaluate(() => speechSynthesis.speaking)
  // +/− step words per minute while muted
  await page.click('ash-speechify-player [data-el=faster]')
  assert((await panelText('speed')) === '325 wpm', `+ raises wpm while muted: ${await panelText('speed')}`)
  const wpm = await sw.evaluate(async () => (await chrome.storage.sync.get('rsvpWpm')).rsvpWpm)
  assert(wpm === 325, `wpm is saved (got ${wpm})`)
  // ±10 words
  await page.click('ash-speechify-player [data-el=play]') // pause speed read
  await sleep(100)
  const idx = Number((await panelText('lefttext')).replace(/\D/g, ''))
  await page.click('ash-speechify-player [data-el=forward]')
  await sleep(100)
  const idx2 = Number((await panelText('lefttext')).replace(/\D/g, ''))
  assert(idx2 === idx + 10 || idx2 > idx, `forward skips 10 words: word ${idx} -> ${idx2}`)
  await page.click('ash-speechify-player [data-el=back]')
  await sleep(100)
  assert(Number((await panelText('lefttext')).replace(/\D/g, '')) === idx, 'back skips 10 words')
  await page.screenshot({ path: `${shots}/7-player-muted.png` })
  // Clicking a word on the page moves speed read there
  const pq = await page.locator('blockquote').boundingBox()
  await page.mouse.click(pq.x + 60, pq.y + 10)
  await sleep(150)
  big = await shown()
  assert(big === (await hl('ash-speechify-word')), `clicking the page moves speed read to that word: ${big}`)
  s = await hl('ash-speechify-sentence')
  assert(s && s.includes('It feels like'), `and its sentence: ${JSON.stringify(s)}`)

  // Unmute: the voice resumes from the word reached
  await page.click('ash-speechify-player [data-el=play]') // play speed read
  await sleep(500)
  const reached = await shown()
  await page.click('ash-speechify-player [data-el=mute]')
  await sleep(1200)
  s = await hl('ash-speechify-sentence')
  assert(s && s.includes('It feels like'), `unmuted, the voice carries on in the same sentence: ${JSON.stringify(s)}`)
  assert((await panelText('speed')).endsWith('×'), 'speed is × again')
  console.log('   (reached', JSON.stringify(reached), 'voice now at', JSON.stringify(await hl('ash-speechify-word')), ')')

  // Show word off hides the big word
  await page.click('ash-speechify-player [data-el=showword]')
  await sleep(100)
  assert(await page.evaluate(() => document.querySelector('ash-speechify-player').shadowRoot.querySelector('[data-el=wordbox]').hidden), 'show word off hides the big word')
  await page.click('ash-speechify-player [data-el=showword]')

  // Turning fast read off restores the page exactly
  const htmlBefore = await page.evaluate(() => document.querySelector('article').innerHTML)
  await page.click('ash-speechify-player [data-el=fastread]')
  await sleep(200)
  assert((await page.evaluate(() => document.querySelectorAll('b.ash-speechify-fr').length)) === 0, 'fast read off removes the bold')
  assert((await page.evaluate(() => document.querySelector('article').textContent)) === before, 'text is back as it was')
  // Reading (still playing since unmute) carries on after restoring
  await sleep(1200)
  s = await hl('ash-speechify-sentence')
  assert(s && before.includes(s), `read aloud works after fast read is off: ${JSON.stringify(s)}`)

  // "Speed read" on the tapped-word pill mutes and speed reads from that word
  await page.click('ash-speechify-player [data-el=play]') // pause
  await sleep(300)
  const p3 = await page.locator('p', { hasText: 'Why now?' }).boundingBox()
  await page.mouse.click(p3.x + 10, p3.y + 10)
  await sleep(300)
  await page.click('ash-speechify-player [data-el=pillspeed]')
  await sleep(100)
  assert((await shown()) === 'Why', `pill starts speed read at the tapped word: ${await shown()}`)
  assert((await panelText('speed')).endsWith('wpm'), 'and the player is muted')

  await page.click('ash-speechify-player [data-el=close]')
  await sleep(300)
  assert((await hl('ash-speechify-sentence')) === null, 'close stops everything and clears highlights')
  assert((await page.evaluate(() => document.documentElement.style.paddingBottom)) === '', 'close removes the room added at the end of the page')

  // Speed read shortcut on a fresh page opens the player muted at the headline
  await page.reload()
  await start('speed-read')
  await sleep(200)
  assert((await shown()) === 'The', `speed read shortcut opens muted at the headline: ${await shown()}`)
  // Clutter is skipped: footnote markers and sections, [1] refs, URLs, citations, captions, tables, credits
  await page.goto('http://localhost:8765/clutter')
  await start('page')
  await sleep(600)
  const said = await page.evaluate(() => document.documentElement.getAttribute('data-ash-text'))
  const flat = said.replace(/\s+/g, ' ').trim()
  console.log('   read:', JSON.stringify(flat))
  for (const gone of ['sixteen hours a day.1', '[2]', 'Smith, 2020', 'https://', 'Getty', 'Table 1', 'Kittens', 'Jones', 'Measured in a lab', '©', 'All rights reserved', 'Subscribe', 'Privacy'])
    assert(!flat.includes(gone), `skips ${JSON.stringify(gone)}`)
  for (const kept of ['Why cats sleep so much', 'sixteen hours a day. Researchers think this saves energy for hunting.', 'about 102 grams', 'The full study is online at and is free', 'as later work also found.', 'The film (2019) about them was fine'])
    assert(flat.includes(kept), `keeps ${JSON.stringify(kept)}`)
  // Highlights and click to read still land on the right words around skipped parts
  // Jump to "Researchers" (just after the skipped footnote 1), then wait for "hunting" (before the skipped [2])
  const rp = await page.evaluate(() => {
    const p = document.querySelector('article p')
    const t = [...p.childNodes].find((n) => n.nodeType === 3 && n.data.includes('Researchers'))
    const r = document.createRange()
    const i = t.data.indexOf('Researchers')
    r.setStart(t, i + 2); r.setEnd(t, i + 3)
    const b = r.getBoundingClientRect()
    return { x: b.x + 1, y: b.y + b.height / 2 }
  })
  await page.mouse.click(rp.x, rp.y)
  await sleep(300)
  s = await hl('ash-speechify-sentence')
  assert(s && s.startsWith('Researchers'), `click right after a skipped footnote lands on the next sentence: ${JSON.stringify(s)}`)
  let found = null
  for (let i = 0; i < 80 && !found; i++) {
    const w = await hl('ash-speechify-word')
    if (w && w.startsWith('hunting')) found = 'hunting'
    else await sleep(100)
  }
  assert(found === 'hunting', 'the word highlight lands on the right word after a skipped footnote')
  await page.evaluate(() => [...document.querySelectorAll('p')].find((p) => p.textContent.startsWith('Older')).scrollIntoView({ block: 'center' }))
  await sleep(800)
  const cp = await page.evaluate(() => {
    const t = [...document.querySelectorAll('p')].find((p) => p.textContent.startsWith('Older')).firstChild
    const r = document.createRange(); r.setStart(t, 2); r.setEnd(t, 3)
    const b = r.getBoundingClientRect()
    return { x: b.x + 1, y: b.y + b.height / 2 }
  })
  await page.mouse.click(cp.x, cp.y)
  await sleep(500)
  s = await hl('ash-speechify-sentence')
  assert(s && s.startsWith('Older cats'), `click to read works on a paragraph with a skipped citation: ${JSON.stringify(s)}`)
  await page.screenshot({ path: `${shots}/8-clutter.png` })
  console.log('all done')
  await ctx.close()
  server.close()
})().catch(async (e) => { console.error(e); process.exit(1) })
