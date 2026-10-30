import { describe, it, expect, beforeEach, vi } from 'vitest'

const CONFIG_RESP = { runpod: { api_key: 'test-key', endpoint_id: 'ep-123' } }

function baseSnapshot(over = {}) {
  return {
    importJson: '{"high_level_description":"test"}',
    width: 1024, height: 1024,
    preset: 'Default', workflow: 'turbo', turboStrength: 0.8,
    loras: [], seed: -1,
    ...over,
  }
}

function mockFetchSequence(responses) {
  const fn = vi.fn(async (url, opts) => {
    const resp = responses.shift()
    if (!resp) throw new Error('unexpected fetch call: ' + url)
    if (resp.throw) throw resp.throw
    return {
      ok: resp.ok ?? true,
      status: resp.status ?? 200,
      json: () => Promise.resolve(resp.body),
      text: () => Promise.resolve(resp.text || JSON.stringify(resp.body)),
      blob: () => Promise.resolve(new Blob()),
    }
  })
  return fn
}

beforeEach(() => {
  vi.resetModules()
})

describe('runJob', () => {
  async function importModule() {
    vi.resetModules()
    return await import('../runpod.js')
  }

  it('fetches config then submits with correct payload', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'job-1' } },
      { body: { status: 'COMPLETED', output: { images: [
        { filename: 'out.png', type: 'base64', data: 'AAAA' }
      ]}}},
      { body: new Blob() },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')

    const mod = await importModule()
    const result = await mod.runJob(baseSnapshot())

    expect(result.dataUrl).toContain('base64,AAAA')
    expect(result.imageUrl).toBe('blob:mock')
    const submitCall = global.fetch.mock.calls[1]
    expect(submitCall[0]).toBe('https://api.runpod.ai/v2/ep-123/run')
    const body = JSON.parse(submitCall[1].body)
    expect(body.input.import_json).toBeTruthy()
    expect(body.input.width).toBe(1024)
    expect(body.input.height).toBe(1024)
    expect(submitCall[1].headers.Authorization).toBe('Bearer test-key')
  })

  it('throws when config missing api_key', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ runpod: { endpoint_id: 'ep' } }),
    })
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/not configured/)
  })

  it('FAILED status rejects with error message', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'j' } },
      { body: { status: 'FAILED', error: 'OOM' } },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow('OOM')
  })

  it('empty images rejects with "No images returned"', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'j' } },
      { body: { status: 'COMPLETED', output: { images: [] } } },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow('No images returned')
  })

  it('submit error rejects with status', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { ok: false, status: 500, text: 'server error' },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/server error \(500\)/)
  })

  it('submit 409 paused endpoint rejects with recovery sentence', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { ok: false, status: 409, text: JSON.stringify({ status: 409, title: 'Conflict', detail: 'Endpoint is paused (max_workers=0)' }) },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/paused or scaled to zero workers/)
  })

  it('calls onStatus with elapsed seconds during polling', async () => {
    vi.useFakeTimers()
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'j' } },
      { body: { status: 'IN_PROGRESS' } },
      { body: { status: 'COMPLETED', output: { images: [
        { filename: 'out.png', type: 'base64', data: 'AAAA' }
      ]}}},
      { body: new Blob() },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')

    const mod = await importModule()
    const ticks = []
    const p = mod.runJob(baseSnapshot(), { onStatus: (s) => ticks.push(s) })
    // Advance the 3s poll-loop sleep between IN_PROGRESS and COMPLETED
    await vi.advanceTimersByTimeAsync(3000)
    await p
    vi.useRealTimers()

    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks[1]).toBeGreaterThan(ticks[0])
  })

  it('aborts via signal', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'j' } },
      { body: { status: 'IN_PROGRESS' } },
    ])
    const mod = await importModule()
    const ac = new AbortController()
    const p = mod.runJob(baseSnapshot(), { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toThrow(/Aborted|abort/i)
  })
})

describe('runJob moss routing', () => {
  async function importModule() {
    vi.resetModules()
    return await import('../runpod.js')
  }

  it('submits to endpoints.moss with model and negative_prompt', async () => {
    global.fetch = mockFetchSequence([
      { body: { runpod: { api_key: 'k', endpoint_id: 'ep-ideo', endpoints: { moss: 'ep-moss' } } } },
      { body: { id: 'job-1' } },
      { body: { status: 'COMPLETED', output: { images: [
        { filename: 'out.png', type: 'base64', data: 'AAAA' }
      ]}}},
      { body: new Blob() },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')

    const mod = await importModule()
    const result = await mod.runJob(baseSnapshot({ model: 'moss', preset: 'Fast', negativePrompt: 'nsfw' }))
    expect(result.dataUrl).toContain('base64,AAAA')
    const submitCall = global.fetch.mock.calls[1]
    expect(submitCall[0]).toBe('https://api.runpod.ai/v2/ep-moss/run')
    const body = JSON.parse(submitCall[1].body)
    expect(body.input.model).toBe('moss')
    expect(body.input.negative_prompt).toBe('nsfw')
    expect(body.input.preset).toBe('Fast')
  })

  it('throws naming runpod.endpoints.moss when it is missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ runpod: { api_key: 'k', endpoint_id: 'ep' } }),
    })
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot({ model: 'moss' }))).rejects.toThrow(/runpod\.endpoints\.moss/)
  })

  it('ideogram payload carries no model/negative_prompt keys', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'job-1' } },
      { body: { status: 'COMPLETED', output: { images: [
        { filename: 'out.png', type: 'base64', data: 'AAAA' }
      ]}}},
      { body: new Blob() },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')

    const mod = await importModule()
    await mod.runJob(baseSnapshot())
    const body = JSON.parse(global.fetch.mock.calls[1][1].body)
    expect(body.input).not.toHaveProperty('model')
    expect(body.input).not.toHaveProperty('negative_prompt')
  })
})

describe('runpod enhance_caption', () => {
  async function importModule() {
    vi.resetModules()
    return await import('../runpod.js')
  }

  it('sends enhance_caption inside input for moss snapshots', async () => {
    global.fetch = mockFetchSequence([
      { body: { runpod: { api_key: 'k', endpoint_id: 'ep-ideo', endpoints: { moss: 'ep-moss' } } } },
      { body: { id: 'job-1' } },
      { body: { status: 'COMPLETED', output: { images: [
        { filename: 'moss.png', type: 'base64', data: 'AAAA' }
      ]}}},
      { body: new Blob() },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')
    const mod = await importModule()
    await mod.runJob(baseSnapshot({ model: 'moss', preset: 'Fast', negativePrompt: '', enhanceCaption: true }))
    const input = JSON.parse(global.fetch.mock.calls[1][1].body).input
    expect(input.enhance_caption).toBe(true)
    expect(input.model).toBe('moss')
  })

  it('omits enhance_caption for ideogram snapshots', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'job-1' } },
      { body: { status: 'COMPLETED', output: { images: [
        { filename: 'x.png', type: 'base64', data: 'AAAA' }
      ]}}},
      { body: new Blob() },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')
    const mod = await importModule()
    await mod.runJob(baseSnapshot({}))
    const input = JSON.parse(global.fetch.mock.calls[1][1].body).input
    expect(input).not.toHaveProperty('enhance_caption')
    expect(input).not.toHaveProperty('model')
  })
})
