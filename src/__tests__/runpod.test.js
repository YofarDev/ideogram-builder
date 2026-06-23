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
    vi.mock('../events.js', () => ({ emit: vi.fn(), on: vi.fn() }))
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
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/Submit failed \(500\)/)
  })

  it('calls onStatus with elapsed seconds during polling', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { id: 'j' } },
      { body: { status: 'IN_PROGRESS' } },
      { body: { status: 'COMPLETED', output: { images: [
        { filename: 'out.png', type: 'base64', data: 'AAAA' }
      ]}}},
      { body: new Blob() },
    ])
    const mod = await importModule()
    const ticks = []
    await mod.runJob(baseSnapshot(), { onStatus: (s) => ticks.push(s) })
    expect(ticks.length).toBeGreaterThan(0)
    expect(typeof ticks[0]).toBe('number')
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
