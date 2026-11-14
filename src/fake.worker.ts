/// <reference lib="webworker" />
/**
 * Test stand-in for the Kokoro worker (built with `npm run build:test`): "speaks" a soft tone as
 * long as the text would take to say, so the extension can be tested without the model download.
 */
import type { WorkerRequest, WorkerResponse } from './tts.worker'

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (m: WorkerResponse, t: Transferable[] = []) => scope.postMessage(m, t)

scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const m = e.data
  if (m.type === 'load') {
    for (let i = 1; i <= 4; i++) {
      await new Promise((r) => setTimeout(r, 100))
      post({ type: 'progress', loaded: i, total: 4 })
    }
    post({ type: 'ready', device: m.device })
    return
  }
  await new Promise((r) => setTimeout(r, 150))
  const sampleRate = 24000
  const seconds = 0.2 + m.text.length / 15
  const samples = new Float32Array(Math.round(seconds * sampleRate))
  for (let i = 0; i < samples.length; i++) samples[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / sampleRate)
  post({ type: 'audio', id: m.id, samples, sampleRate }, [samples.buffer])
}
