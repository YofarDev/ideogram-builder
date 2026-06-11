import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <button id="btn-generate-image">Generate Image</button>
  <textarea id="json-output">{"high_level_description":"test"}</textarea>
  <div id="generate-status"></div>
`

const CONFIG_RESP = { runpod: { api_key: 'test-key', endpoint_id: 'ep-123' } }

function mockFetchSequence(responses) {
  const calls = []
  const fn = vi.fn().mockImplementation(async (url, opts) => {
    calls.push({ url, opts })
    const resp = responses.shift()
    if (!resp) throw new Error('unexpected fetch call')
    if (resp.throw) throw resp.throw
    return {
      ok: resp.ok ?? true,
      status: resp.status ?? 200,
      json: () => Promise.resolve(resp.body),
      text: () => Promise.resolve(resp.text || JSON.stringify(resp.body)),
    }
  })
  return { fn, calls }
}

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.boxes = []
  state.selectedBoxId = null
  state.boxCounter = 0
  state.globalPalette = []
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.photoArtMode = 1
})

describe('generateImage', () => {
  async function importModule() {
    // Re-import for fresh module state (config cache)
    vi.resetModules()
    vi.mock('../toast.js', () => ({ showToast: vi.fn() }))
    vi.mock('../events.js', () => ({ emit: vi.fn(), on: vi.fn() }))
    const mod = await import('../runpod.js')
    return mod
  }

  it('fetches config then submits with correct payload', async () => {
    const { fn, calls } = mockFetchSequence([
      { body: CONFIG_RESP },                                    // getConfig
      { body: { id: 'job-1' } },                               // submit
      { body: { status: 'COMPLETED', output: { images: [       // poll
        { filename: 'out.png', type: 'base64', data: 'AAAA' }
      ]}}},
    ])
    // fetch for data URL conversion
    fn.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(CONFIG_RESP) })
    fn.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'job-1' }) })
    fn.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
      status: 'COMPLETED', output: { images: [{ filename: 'out.png', type: 'base64', data: 'AAAA' }]}
    })})
    fn.mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob()) })

    global.fetch = fn
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')

    const mod = await importModule()
    await mod.generateImage()

    // Verify config fetch
    expect(fn).toHaveBeenNthCalledWith(1, '/api/config')
    // Verify submit payload
    const submitCall = fn.mock.calls[1]
    expect(submitCall[0]).toBe('https://api.runpod.ai/v2/ep-123/run')
    const body = JSON.parse(submitCall[1].body)
    expect(body.input.import_json).toBeTruthy()
    expect(body.input.width).toBe(1024)
    expect(body.input.height).toBe(1024)
    expect(submitCall[1].headers.Authorization).toBe('Bearer test-key')
  })

  it('shows toast error when no JSON in output', async () => {
    document.getElementById('json-output').value = ''
    const mod = await importModule()
    const toast = await import('../toast.js')
    await mod.generateImage()
    expect(toast.showToast).toHaveBeenCalledWith(expect.stringContaining('Create a prompt'), expect.anything())
  })

  it('shows toast error when config missing api_key', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ runpod: { endpoint_id: 'ep' } }),
    })
    const mod = await importModule()
    await mod.generateImage()
    const toast = await import('../toast.js')
    expect(toast.showToast).toHaveBeenCalledWith(expect.stringContaining('not configured'), expect.anything())
  })

  it('FAILED status throws error', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(CONFIG_RESP) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'j' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'FAILED', error: 'OOM' }) })

    const mod = await importModule()
    await mod.generateImage()
    const statusEl = document.getElementById('generate-status')
    expect(statusEl.textContent).toContain('OOM')
  })

  it('empty images throws "No images returned"', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(CONFIG_RESP) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'j' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'COMPLETED', output: { images: [] } }) })

    const mod = await importModule()
    await mod.generateImage()
    const statusEl = document.getElementById('generate-status')
    expect(statusEl.textContent).toContain('No images returned')
  })

  it('always resets button and emits runpod:done in finally', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(CONFIG_RESP) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve('server error') })
    const mod = await importModule()
    await mod.generateImage()
    // Button re-enabled after error
    expect(document.getElementById('btn-generate-image').disabled).toBe(false)
    expect(document.getElementById('btn-generate-image').textContent).toBe('Generate Image')
    const { emit } = await import('../events.js')
    expect(emit).toHaveBeenCalledWith('runpod:done')
  })

  it('shows "Generating..." text while running', async () => {
    let resolvePoll
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(CONFIG_RESP) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'j' }) })
      .mockImplementationOnce(() => new Promise(r => { resolvePoll = r }))

    const mod = await importModule()
    const p = mod.generateImage()
    // Button text changes during generation
    await vi.waitFor(() => {
      expect(document.getElementById('btn-generate-image').textContent).toBe('Generating...')
    })
    resolvePoll({ ok: true, json: () => Promise.resolve({ status: 'COMPLETED', output: { images: [] } }) })
    await p
    expect(document.getElementById('btn-generate-image').textContent).toBe('Generate Image')
  })
})
