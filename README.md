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
- **Player:** one dark panel along the bottom does read aloud and speed reading together. The top line shows what's being read, the speed (− 1.25× + with the voice, − 300 wpm + when muted), mute, show word, settings and close. Under it, a big word with a red focus letter follows the voice word by word, with a position slider and play, previous and next below it, plus the voice picker and Fast read.
- **Mute to speed read:** the speaker button stops the voice and the big word carries on by itself on a timer, at 100 to 1000 words a minute (faster than any voice), while the page keeps highlighting and scrolling along. Previous and next become ±10 words. Unmute and the voice picks up from the word you reached. <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>V</kbd> or right-click **Speed read** opens the player already muted. Same timing rules as the Feeder apps.
- **Click to read:** while reading or speed reading, click any word on the page to jump there. When paused, clicking a word shows **Read from here** and **Speed read** buttons.
- **Fast read:** the **Fast read** button on the player (or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>) bolds the start of every word on the page so your eyes can skim. It works while reading aloud; the highlights and click to read keep lining up, and turning it off puts the page back exactly. Same algorithm as the Feeder apps (a port of [text-vide](https://github.com/Gumball12/text-vide), MIT).
- **Media keys** (keyboard play/pause, next/previous) work while the natural voice is playing.
- **Settings** (gear button): default voice and speed, graphics card (WebGPU) mode, click to read, follow along scrolling. Shortcuts can be changed at `chrome://extensions/shortcuts`.

The first time you use the natural voice, the player shows the download progress. Chrome blocks extensions on its own pages (`chrome://…`, the Web Store), so those can't be read.

## How it works

| Part | File | Job |
| --- | --- | --- |
| Service worker | `src/background.ts` | Toolbar button, shortcuts, right-click menu; passes messages between pages and the voice engine |
| Content script | `src/content/` | Finds the text (`extract.ts`), splits sentences and highlights with the CSS Custom Highlight API (`reader.ts`), the player panel in a shadow root (`player.ts`), muted speed reading (`silent.ts`, rules in `src/rsvp.ts`), fast read (`fastread.ts`) |
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
