import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'

const DOM_HTML = `
  <button id="btn-generate-image">Generate</button>
  <textarea id="json-output">{"high_level_description":"test"}</textarea>
  <textarea id="moss-negative">nsfw</textarea>
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
  vi.doMock('../backend.js', () => ({ runJob: mocks.runJob }))
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

  it('enqueueImportJson enqueues a prompt without reading #json-output', async () => {
    document.getElementById('json-output').value = ''  // editor textarea is empty
    const emit = vi.fn()
    const mod = await loadQueue({ emit, runJob: okRunJob() })
    mod.enqueueImportJson('{"high_level_description":"from collection"}')
    expect(document.getElementById('queue-panel').children.length).toBe(1)
    expect(emit).not.toHaveBeenCalledWith('image:ready', expect.anything())  // no result emitted synchronously
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    expect(emit).toHaveBeenCalledWith('image:ready', expect.objectContaining({
      importJson: expect.stringContaining('from collection'),
    }))
  })

  it('enqueueImportJson ignores empty/whitespace prompts', async () => {
    const mod = await loadQueue({ runJob: okRunJob() })
    mod.enqueueImportJson('   ')
    expect(document.getElementById('queue-panel').children.length).toBe(0)
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

  it('emits image:ready with imageUrl and dataUrl on success', async () => {
    const emit = vi.fn()
    const mod = await loadQueue({
      emit,
      runJob: vi.fn(async (_snap, opts) => {
        opts?.onStatus?.(1)
        return { dataUrl: 'data:image/png;base64,ZZ', imageUrl: 'blob:success' }
      }),
    })
    mod.enqueue()
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    expect(emit).toHaveBeenNthCalledWith(2, 'image:ready', {
      imageUrl: 'blob:success',
      dataUrl: 'data:image/png;base64,ZZ',
      importJson: '{"high_level_description":"test"}',
      loras: [],
      source: 'generation',
      meta: {
        seed: -1,
        preset: 'Default',
        workflow: 'turbo',
        turboStrength: 0.8,
        width: 768,
        height: 1152,
        photoArtMode: 1,
        backend: 'runpod',
        loras: [],
        model: 'ideogram',
        negativePrompt: '',
        promptFormat: 'layout',
      },
    })
  })

  it('marks a job failed and surfaces the error on the card when runJob throws', async () => {
    const mod = await loadQueue({
      showToast: vi.fn(),
      runJob: vi.fn(async () => { throw new Error('GPU OOM') }),
    })
    mod.enqueue()
    await vi.waitFor(() => {
      const card = document.querySelector('.queue-card')
      expect(card).toBeTruthy()
      expect(card.classList.contains('queue-failed')).toBe(true)
      expect(card.getAttribute('title')).toContain('GPU OOM')
    })
    expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
  })
})

describe('buildSnapshot model fields', () => {
  // loadQueue() calls vi.resetModules(), so the queue module sees a FRESH
  // state.js instance — grab that instance to set model fields on it.
  async function loadQueueWithState(mocks) {
    const mod = await loadQueue(mocks)
    const fresh = await import('../state.js')
    return { mod, freshState: fresh.state }
  }

  it('moss snapshots carry model, moss preset, negative prompt and format', async () => {
    let captured
    const { mod, freshState } = await loadQueueWithState({ runJob: vi.fn(async (snap) => {
      captured = snap
      return { dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:m' }
    }) })
    freshState.model = 'moss'
    freshState.moss = { promptMode: 'caption', preset: 'Quality' }
    mod.enqueue()
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    expect(captured.model).toBe('moss')
    expect(captured.preset).toBe('Quality')
    expect(captured.negativePrompt).toBe('nsfw')
    expect(captured.promptFormat).toBe('caption')
  })

  it('ideogram snapshots use the UI preset and empty negativePrompt', async () => {
    let captured
    const { mod, freshState } = await loadQueueWithState({ runJob: vi.fn(async (snap) => {
      captured = snap
      return { dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:m' }
    }) })
    freshState.model = 'ideogram'
    freshState.preset = 'Quality'          // Ideogram steps-preset, not MOSS's
    freshState.moss = { promptMode: 'caption', preset: 'Turbo' }
    mod.enqueue()
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    expect(captured.model).toBe('ideogram')
    expect(captured.preset).toBe('Quality')
    expect(captured.negativePrompt).toBe('')
    expect(captured.promptFormat).toBe('layout')
  })

  it('enqueueImportJson can pass a collection item model', async () => {
    let captured
    const { mod, freshState } = await loadQueueWithState({ runJob: vi.fn(async (snap) => {
      captured = snap
      return { dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:m' }
    }) })
    freshState.model = 'ideogram'
    mod.enqueueImportJson('{"high_level_description":"coll"}', { model: 'moss' })
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    expect(captured.model).toBe('moss')
    expect(captured.importJson).toContain('coll')
  })
})

describe('image:ready meta model fields', () => {
  it('moss jobs carry model, negativePrompt, promptFormat and mossPreset', async () => {
    const emit = vi.fn()
    const { mod, freshState } = await (async () => {
      const m = await loadQueue({ emit, runJob: okRunJob() })
      return { mod: m, freshState: (await import('../state.js')).state }
    })()
    freshState.model = 'moss'
    freshState.moss = { promptMode: 'layout', preset: 'Quality' }
    mod.enqueue()
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    const meta = emit.mock.calls.find(c => c[0] === 'image:ready')[1].meta
    expect(meta.model).toBe('moss')
    expect(meta.mossPreset).toBe('Quality')
    expect(meta.negativePrompt).toBe('nsfw')
    expect(meta.promptFormat).toBe('layout')
    // ideogram-only key absent for moss, and preset stays the moss preset
    expect(meta.preset).toBe('Quality')
  })
})

describe('server-resolved seed and generation metadata', () => {
  // loadQueue() resets modules — grab the state instance the queue module sees.
  async function loadQueueWithFreshState(mocks) {
    const mod = await loadQueue(mocks)
    const freshState = (await import('../state.js')).state
    return { mod, freshState }
  }

  it('uses the server seed in saved meta when the backend returns one', async () => {
    // The submitted seed can stay -1 ("random"); reproducibility requires the
    // server-resolved seed in gallery metadata.
    const emit = vi.fn()
    const { mod, freshState } = await loadQueueWithFreshState({
      emit,
      runJob: vi.fn(async () => ({
        dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:s',
        seed: 777777, generation: { runtime_profile: 'baseline', preset_id: 'Fast', effective_steps: 25 },
      })),
    })
    freshState.model = 'moss'
    freshState.moss = { promptMode: 'layout', preset: 'Fast' }
    freshState.seed = -1
    mod.enqueue()
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    const { meta } = emit.mock.calls.find(c => c[0] === 'image:ready')[1]
    expect(meta.seed).toBe(777777)
    expect(meta.generation).toEqual({ runtime_profile: 'baseline', preset_id: 'Fast', effective_steps: 25 })
    // Queue card shows the resolved seed too.
    expect(document.querySelector('.queue-seed')?.textContent).toContain('777777')
  })

  it('keeps the submitted seed when the backend returns none (old backends)', async () => {
    const emit = vi.fn()
    const { mod, freshState } = await loadQueueWithFreshState({ emit, runJob: okRunJob() })
    freshState.seed = 42
    mod.enqueue()
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    const { meta } = emit.mock.calls.find(c => c[0] === 'image:ready')[1]
    expect(meta.seed).toBe(42)
    expect(meta.generation).toBeUndefined()
  })

  it('generation metadata persists only for moss jobs', async () => {
    const emit = vi.fn()
    const { mod, freshState } = await loadQueueWithFreshState({
      emit,
      runJob: vi.fn(async () => ({
        dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:s',
        seed: 1, generation: { runtime_profile: 'baseline' },
      })),
    })
    freshState.model = 'ideogram'
    mod.enqueue()
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    const { meta } = emit.mock.calls.find(c => c[0] === 'image:ready')[1]
    expect(meta.generation).toBeUndefined()  // ideogram meta shape unchanged
  })
})

describe('preset availability guard', () => {
  async function loadQueueWithFreshState(mocks) {
    const mod = await loadQueue(mocks)
    const freshState = (await import('../state.js')).state
    return { mod, freshState }
  }

  it('blocks enqueue when the selected moss preset is unavailable on this backend', async () => {
    const showToast = vi.fn()
    const runJob = vi.fn()
    const { mod, freshState } = await loadQueueWithFreshState({ showToast, runJob })
    freshState.model = 'moss'
    freshState.moss = { promptMode: 'layout', preset: 'Rapid' }  // no capabilities → unavailable
    mod.enqueue()
    await vi.waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Rapid β'), expect.anything())
    })
    expect(runJob).not.toHaveBeenCalled()
    expect(document.getElementById('queue-panel').children.length).toBe(0)
  })

  it('blocks oversize moss snapshots at enqueue with area numbers, recipe intact', async () => {
    const showToast = vi.fn()
    const runJob = vi.fn()
    const { mod, freshState } = await loadQueueWithFreshState({ showToast, runJob })
    const mossPresets = await import('../moss-presets.js')
    mossPresets.setCapabilities({ presets: [{ id: 'Fast' }, { id: 'Rapid', max_area_mp: 1 }] }, 'runpod')
    freshState.model = 'moss'
    freshState.moss = { promptMode: 'layout', preset: 'Rapid' }
    freshState.canvas = { width: 1024, height: 1536 }   // 1.5 MP > the 1 MP limit
    mod.enqueue()
    await vi.waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(
        expect.stringContaining('up to 1 MP'), 'error', expect.anything())
    })
    const message = showToast.mock.calls[0][0]
    expect(message).toContain('1024×1536')
    expect(message).toContain('1.50 MP')
    expect(runJob).not.toHaveBeenCalled()
    expect(document.getElementById('queue-panel').children.length).toBe(0)
  })

  it('re-validates a queued moss job at dispatch when capabilities changed', async () => {
    // Job enqueued while Rapid was advertised, queued behind a stalled run; by
    // its dispatch time capabilities no longer advertise it — the stale job is
    // dropped with an explicit message instead of being submitted.
    let resolveFirst
    const runJob = vi.fn()
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r }))
      .mockResolvedValueOnce({ dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:x' })
    const showToast = vi.fn()
    const { mod, freshState } = await loadQueueWithFreshState({ showToast, runJob })
    const mossPresets = await import('../moss-presets.js')
    mossPresets.setCapabilities({ presets: [{ id: 'Fast' }, { id: 'Rapid' }] }, 'runpod')
    freshState.model = 'moss'
    freshState.moss = { promptMode: 'layout', preset: 'Fast' }
    mod.enqueue()                                   // starts running (stalled)
    freshState.moss = { promptMode: 'layout', preset: 'Rapid' }
    mod.enqueue()                                   // queued; Rapid advertised at enqueue time
    expect(document.getElementById('queue-panel').children.length).toBe(2)
    mossPresets.setCapabilities(null, 'runpod')     // capabilities disappear before its dispatch
    resolveFirst({ dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:x' })
    await vi.waitFor(() => {
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Rapid β'), 'error', expect.anything())
    })
    expect(runJob).toHaveBeenCalledTimes(1)         // the stale Rapid job was never submitted
    expect(document.getElementById('queue-panel').children.length).toBe(1)  // only the done job remains
  })

  it('lets base presets enqueue without capabilities', async () => {
    const runJob = vi.fn(async (_s, opts) => {
      opts?.onStatus?.(1)
      return { dataUrl: 'data:image/png;base64,AA', imageUrl: 'blob:o' }
    })
    const { mod, freshState } = await loadQueueWithFreshState({ runJob })
    freshState.model = 'moss'
    freshState.moss = { promptMode: 'layout', preset: 'Fast' }
    mod.enqueue()
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generate')
    })
    expect(runJob).toHaveBeenCalledTimes(1)
  })
})
