import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'

const DOM_HTML = `
  <button id="btn-generate-image">Generate</button>
  <textarea id="json-output">{"high_level_description":"test"}</textarea>
  <div id="generate-status"></div>
  <div id="queue-panel"></div>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.preset = 'Default'
  state.workflow = 'turbo'
  state.turboStrength = 0.8
  state.loras = []
  state.seed = -1
})

async function loadQueue(mocks) {
  vi.resetModules()
  vi.doMock('../toast.js', () => ({ showToast: mocks.showToast }))
  vi.doMock('../events.js', () => ({ emit: mocks.emit ?? vi.fn(), on: vi.fn() }))
  vi.doMock('../runpod.js', () => ({ runJob: mocks.runJob }))
  return import('../queue.js')
}

const okRunJob = () => vi.fn(async (snap, opts) => {
  opts?.onStatus?.(1)
  return { dataUrl: 'data:image/png;base64,AAAA', imageUrl: 'blob:mock' }
})

describe('queue', () => {
  it('enqueue rejects empty JSON with toast and adds no row', async () => {
    document.getElementById('json-output').value = ''
    const showToast = vi.fn()
    const mod = await loadQueue({ showToast, runJob: vi.fn() })
    mod.enqueue()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Create a prompt'), expect.anything())
    expect(document.getElementById('queue-panel').children.length).toBe(0)
  })

  it('enqueue adds a queued row and the worker drains it to done', async () => {
    const mod = await loadQueue({ runJob: okRunJob() })
    mod.enqueue()
    expect(document.getElementById('queue-panel').children.length).toBe(1)
    expect(document.getElementById('btn-generate-image').textContent).toContain('+1 queued')
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    const card = document.querySelector('.queue-card')
    expect(card.querySelector('img.queue-thumb')).toBeTruthy()
  })

  it('drains multiple jobs in FIFO order', async () => {
    const mod = await loadQueue({ runJob: okRunJob() })
    mod.enqueue()
    state.seed = 42
    mod.enqueue()
    expect(document.getElementById('queue-panel').children.length).toBe(2)
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    const seeds = [...document.querySelectorAll('.queue-seed')].map(e => e.textContent)
    expect(seeds.length).toBe(2)
  })

  it('remove drops a queued job before it runs', async () => {
    let resolveFirst
    const runJob = vi.fn(() => new Promise(r => { resolveFirst = r }))
    const mod = await loadQueue({ runJob })
    mod.enqueue()   // starts running (stalled)
    state.seed = 7
    mod.enqueue()   // queued behind it
    expect(document.getElementById('queue-panel').children.length).toBe(2)
    mod.removeJob(2) // remove the queued one
    expect(document.getElementById('queue-panel').children.length).toBe(1)
    resolveFirst({ dataUrl: 'data:image/png;base64,BB', imageUrl: 'blob:x' })
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
  })

  it('cancel a running job aborts and continues to next', async () => {
    const runJob = vi.fn()
      .mockImplementationOnce(() => new Promise((_, rej) => {
        setTimeout(() => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })), 10)
      }))
      .mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,CC', imageUrl: 'blob:y' })
    const mod = await loadQueue({ runJob })
    mod.enqueue()
    state.seed = 99
    mod.enqueue()
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    expect(runJob).toHaveBeenCalledTimes(2)
    expect(document.querySelectorAll('.queue-card').length).toBe(1)
  })

  it('removeJob on a running job aborts it and continues to next', async () => {
    const runJob = vi.fn()
      .mockImplementationOnce((_snap, opts) => new Promise((_, rej) => {
        opts.signal.addEventListener('abort', () =>
          rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      }))
      .mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,DD', imageUrl: 'blob:z' })
    const mod = await loadQueue({ runJob })
    mod.enqueue()
    state.seed = 5
    mod.enqueue()
    expect(runJob).toHaveBeenCalledTimes(1)
    mod.removeJob(1)
    await vi.waitFor(() => {
      expect(runJob).toHaveBeenCalledTimes(2)
    })
    expect(document.querySelectorAll('.queue-card').length).toBe(1)
  })
})
