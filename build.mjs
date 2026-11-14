// Builds the unpacked extension into dist/ (or dist-test/ with --test, using a fake voice).
import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const test = process.argv.includes('--test')
const out = test ? 'dist-test' : 'dist'
rmSync(out, { recursive: true, force: true })
mkdirSync(`${out}/ort`, { recursive: true })

const common = { bundle: true, minify: !test, sourcemap: test ? 'inline' : false, target: 'chrome116', logLevel: 'info', legalComments: 'none' }

await build({ ...common, entryPoints: { content: 'src/content/index.ts' }, outdir: out, format: 'iife' })
await build({
  ...common,
  entryPoints: {
    background: 'src/background.ts',
    offscreen: 'src/offscreen.ts',
    options: 'src/options.ts',
    'tts.worker': test ? 'src/fake.worker.ts' : 'src/tts.worker.ts',
  },
  outdir: out,
  format: 'esm',
  platform: 'browser',
  mainFields: ['browser', 'module', 'main'],
})

cpSync('static', out, { recursive: true })
if (test) {
  // Tests start reading from the service worker, which needs access to the test page
  const m = JSON.parse(readFileSync(`${out}/manifest.json`, 'utf8'))
  m.host_permissions.push('<all_urls>')
  writeFileSync(`${out}/manifest.json`, JSON.stringify(m, null, 2))
}
// The WebAssembly runtime the voice model needs, packaged instead of fetched from a CDN
if (!test) {
  for (const f of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
    cpSync(`node_modules/onnxruntime-web/dist/${f}`, `${out}/ort/${f}`)
  }
}
