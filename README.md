# ashish-speechify

A Chrome extension that reads any web page or selection aloud with a natural voice that runs **on your own computer**, highlighting each sentence and word as it goes.

It uses the same voice engine as Feeder Web's read aloud: [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) (82M parameters, Apache-2.0) through [kokoro-js](https://www.npmjs.com/package/kokoro-js). The model is downloaded once from Hugging Face (about 90 MB, or 310 MB for the faster graphics-card version) and cached by Chrome. After that, nothing you read leaves your computer. The browser's own voices are available too and start instantly.

## Install

1. Download `ashish-speechify.zip` from the [latest release](../../releases/latest) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode** (top right) and click **Load unpacked**.
3. Pick the unzipped folder. Pin the extension so its button stays in the toolbar.

To update, unzip the new release over the same folder and click the reload icon on the extension's card.

## Use

- **Read the page:** click the toolbar button or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>. It finds the article (Mozilla Readability) and skips menus, sidebars and footers. Press the shortcut again to pause or resume.
- **Read a selection:** select text, then press the shortcut, or right-click and choose **Read selection aloud** (<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>).
- **Player:** a floating bar with previous sentence, play/pause, next sentence, speed −/+, voice picker, settings and close, all visible. Drag it by the dots on the left.
- **Click to read:** while reading, click any sentence to jump there. When paused, clicking a word shows a **Read from here** button.
- **Fast read:** the **Fast read** button on the player (or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>) bolds the start of every word on the page so your eyes can skim. It works while reading aloud; the highlights and click to read keep lining up, and turning it off puts the page back exactly. Same algorithm as the Feeder apps (a port of [text-vide](https://github.com/Gumball12/text-vide), MIT).
- **Speed read:** the **Speed read** button (or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd>, or right-click) shows the text one word at a time with a red focus letter, starting at the sentence you're on. Space plays and pauses (pausing shows the sentence for context), ← → move, ↑ ↓ change the pace (100 to 1000 words a minute, remembered), Esc closes and marks where you stopped on the page. When paused, clicking a word also offers **Speed read** next to **Read from here**. Same timing rules as Feeder.
- **Media keys** (keyboard play/pause, next/previous) work while the natural voice is playing.
- **Settings** (gear button): default voice and speed, graphics card (WebGPU) mode, click to read, follow along scrolling. Shortcuts can be changed at `chrome://extensions/shortcuts`.

The first time you use the natural voice, the player shows the download progress. Chrome blocks extensions on its own pages (`chrome://…`, the Web Store), so those can't be read.

## How it works

| Part | File | Job |
| --- | --- | --- |
| Service worker | `src/background.ts` | Toolbar button, shortcuts, right-click menu; passes messages between pages and the voice engine |
| Content script | `src/content/` | Finds the text (`extract.ts`), splits sentences and highlights with the CSS Custom Highlight API (`reader.ts`), floating player in a shadow root (`player.ts`), fast read (`fastread.ts`), speed read overlay (`rsvp-view.ts`, rules in `src/rsvp.ts`) |
| Offscreen document | `src/offscreen.ts` | Runs the voice model in a worker, caches generated sentences, plays the audio |
| Worker | `src/tts.worker.ts` | Kokoro via kokoro-js / ONNX Runtime Web (WebAssembly, or WebGPU) |

Speech is generated a sentence at a time, with the next sentence generated while the current one plays. Word highlighting follows the audio position, giving each word time in proportion to its length (Kokoro doesn't report word timings), the same way Feeder Web does it. ONNX Runtime's WebAssembly files are packaged with the extension because Manifest V3 doesn't allow loading code from a CDN.

## Develop

```sh
npm install
npm run build      # unpacked extension in dist/
npm run zip        # dist/ zipped as ashish-speechify.zip
npm test           # builds with a fake voice and drives a test page in Chromium (Playwright)
```

Every push to `main` builds the zip and publishes it as the latest GitHub release.

## License

GPL-3.0-or-later, since the read-aloud engine is ported from Feeder Web (part of a GPL-3.0 Feeder fork). Kokoro and kokoro-js are Apache-2.0.
