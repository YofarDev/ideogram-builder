import { describe, it, expect, beforeEach, vi } from 'vitest'

function mockFetchSequence(responses) {
  const fn = vi.fn(async (url, opts) => {
    const resp = responses.shift()
    if (resp?.throw) throw resp.throw
    if (url.startsWith('data:')) {
      return { ok: true, blob: () => Promise.resolve(new Blob()) }
    }
    return {
      ok: resp?.ok ?? true,
      status: resp?.status ?? 200,
      json: () => Promise.resolve(resp?.body ?? {}),
      text: () => Promise.resolve(resp?.text ?? ''),
    }
  })
  return fn
}

const CONFIG_RESP = {
  modal: {
    endpoint_url: 'https://modal.example/generate',
    auth_token: 'tok-xyz',
  },
}

function baseSnapshot(over = {}) {
  return {
    importJson: '{"high_level_description":"test"}',
    width: 1024, height: 1024,
    preset: 'Default', workflow: 'turbo', turboStrength: 0.8,
    loras: [], seed: -1,
    ...over,
  }
}

beforeEach(() => {
  vi.resetModules()
})

describe('modal runJob', () => {
  async function importModule() {
    return await import('../modal.js')
  }

  it('fetches config and submits with correct payload', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { call_id: 'call-1' } },
      { body: { status: 'completed', result: { output: { images: [
        { filename: 'out.png', data: 'AAAA' }
      ]}}} },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')

    const mod = await importModule()
    const result = await mod.runJob(baseSnapshot())
    expect(result.dataUrl).toContain('data:image/png;base64,AAAA')
    expect(result.imageUrl).toBe('blob:mock')
  })

  it('throws when modal not configured', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({}),
    })
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/not configured/)
  })

  it('rejects on submit 401', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { ok: false, status: 401, text: 'unauthorized' },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/auth/)
  })

  it('rejects on submit 403', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { ok: false, status: 403, text: 'forbidden' },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/auth/)
  })

  it('rejects on submit generic error', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { ok: false, status: 500, text: 'server error' },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/Modal submit failed \(500\)/)
  })

  it('rejects failed generation', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { call_id: 'c1' } },
      { body: { status: 'failed', error: 'GPU OOM' } },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow('GPU OOM')
  })

  it('rejects empty images', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { call_id: 'c1' } },
      { body: { status: 'completed', result: { output: { images: [] } } } },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow('No images returned')
  })

  it('polls status every 3s until completed', async () => {
    vi.useFakeTimers()
    try {
      global.fetch = mockFetchSequence([
        { body: CONFIG_RESP },
        { body: { call_id: 'c1' } },
        { body: { status: 'processing' } },
        { body: { status: 'completed', result: { output: { images: [
          { filename: 'out.png', data: 'BBBB' }
        ]}}} },
      ])
      global.URL.createObjectURL = vi.fn(() => 'blob:m')
      const mod = await importModule()
      const p = mod.runJob(baseSnapshot())
      // Advance past two poll cycles (2 × 3000ms) to get past 'processing' to 'completed'
      await vi.advanceTimersByTimeAsync(6000)
      await p
    } finally {
      vi.useRealTimers()
    }
  })

  it('times out after 15 minutes', async () => {
    vi.useFakeTimers()
    try {
      global.fetch = mockFetchSequence([
        { body: CONFIG_RESP },
        { body: { call_id: 'c1' } },
        { body: { status: 'processing' } },
      ])
      const mod = await importModule()
      const p = mod.runJob(baseSnapshot())
      p.catch(() => {}) // eager catch to prevent unhandled rejection during timer advancement
      await vi.advanceTimersByTimeAsync(16 * 60 * 1000)
      await expect(p).rejects.toThrow(/timed out/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('calls onStatus callback during polling', async () => {
    vi.useFakeTimers()
    try {
      global.fetch = mockFetchSequence([
        { body: CONFIG_RESP },
        { body: { call_id: 'c1' } },
        { body: { status: 'processing' } },
        { body: { status: 'completed', result: { output: { images: [
          { filename: 'o.png', data: 'CC' }
        ]}}} },
      ])
      global.URL.createObjectURL = vi.fn(() => 'blob:m')
      const mod = await importModule()
      const statuses = []
      const p = mod.runJob(baseSnapshot(), { onStatus: (s) => statuses.push(s) })
      // Advance past two poll cycles to get past 'processing' to 'completed'
      await vi.advanceTimersByTimeAsync(6000)
      await p
      expect(statuses.length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
