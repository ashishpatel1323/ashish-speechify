/**
 * Service worker: starts reading on the toolbar button, the keyboard shortcut and the right-click
 * menu, and passes messages between pages and the offscreen voice engine.
 */
import type { FromEngine, StartMessage, ToEngine } from './shared'

const OFFSCREEN_URL = 'offscreen.html'
let creating: Promise<void> | null = null

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  })
  if (contexts.length) return
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK, chrome.offscreen.Reason.WORKERS],
      justification: 'Generates natural speech on this device and plays it while reading a page aloud.',
    })
    .finally(() => {
      creating = null
    })
  await creating
}

async function injectAndStart(tab: chrome.tabs.Tab | undefined, message: StartMessage) {
  if (!tab?.id) return
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['highlight.css'] })
    await chrome.tabs.sendMessage(tab.id, message)
  } catch (e) {
    // Chrome pages, the Web Store and PDFs in the built-in viewer can't be scripted
    console.warn('Could not read this page', e)
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' })
    await chrome.action.setTitle({ tabId: tab.id, title: "This page can't be read aloud (Chrome blocks extensions here)" })
  }
}

// Lets automated tests start reading without a toolbar click
;(globalThis as Record<string, unknown>).ashStart = injectAndStart

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll()
  chrome.contextMenus.create({ id: 'read-selection', title: 'Read selection aloud', contexts: ['selection'] })
  chrome.contextMenus.create({ id: 'read-page', title: 'Read this page aloud', contexts: ['page'] })
  chrome.contextMenus.create({ id: 'speed-read-selection', title: 'Speed read selection', contexts: ['selection'] })
  chrome.contextMenus.create({ id: 'speed-read', title: 'Speed read this page', contexts: ['page'] })
  chrome.contextMenus.create({ id: 'fast-read', title: 'Fast read this page (bold word starts)', contexts: ['page'] })
})

chrome.action.onClicked.addListener((tab) => injectAndStart(tab, { type: 'start', mode: 'toggle' }))

chrome.commands.onCommand.addListener(async (command, tab) => {
  tab ??= (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
  if (command === 'toggle-reading') await injectAndStart(tab, { type: 'start', mode: 'toggle' })
  if (command === 'read-selection') await injectAndStart(tab, { type: 'start', mode: 'selection' })
  if (command === 'fast-read') await injectAndStart(tab, { type: 'start', mode: 'fast-read' })
  if (command === 'speed-read') await injectAndStart(tab, { type: 'start', mode: 'speed-read' })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'read-selection') injectAndStart(tab, { type: 'start', mode: 'selection', text: info.selectionText })
  if (info.menuItemId === 'read-page') injectAndStart(tab, { type: 'start', mode: 'page' })
  if (info.menuItemId === 'speed-read-selection' || info.menuItemId === 'speed-read') injectAndStart(tab, { type: 'start', mode: 'speed-read' })
  if (info.menuItemId === 'fast-read') injectAndStart(tab, { type: 'start', mode: 'fast-read' })
})

chrome.runtime.onMessage.addListener(
  (raw: { target?: string; tabId?: number; event?: FromEngine; msg?: ToEngine }, sender, reply) => {
    if (raw?.target === 'engine' && raw.msg && sender.tab?.id !== undefined) {
      // Page -> engine
      const tabId = sender.tab.id
      ensureOffscreen()
        .then(() => chrome.runtime.sendMessage({ target: 'offscreen', tabId, msg: raw.msg }))
        .then(() => reply({ ok: true }))
        .catch((e) => reply({ ok: false, error: String(e) }))
      return true
    }
    if (raw?.target === 'bg' && raw.event && raw.tabId !== undefined) {
      // Engine -> page
      chrome.tabs.sendMessage(raw.tabId, raw.event).catch(() => undefined)
    }
    if (raw?.target === 'open-options') chrome.runtime.openOptionsPage()
    return undefined
  },
)
