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

function completedBody(over = {}) {
  return {
    status: 'completed',
    result: {
      output: { images: [{ filename: 'out.png', data: 'AAAA' }] },
      ...over,
    },
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
      { body: completedBody() },
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

  it('surfaces handler errors inside completed responses', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { call_id: 'c1' } },
      { body: { status: 'completed', result: { error: "Preset 'Rapid' is not enabled on this deployment" } } },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/not enabled/)
  })

  it('polls immediately after the call id, then 250/500, then 1s', async () => {
    vi.useFakeTimers()
    try {
      const statusTimestamps = []
      let statusCount = 0
      global.fetch = vi.fn(async (url) => {
        if (url === '/api/config') return { ok: true, json: () => Promise.resolve(CONFIG_RESP) }
        if (url.endsWith('/generate')) return { ok: true, json: () => Promise.resolve({ call_id: 'c1' }) }
        if (url.includes('/status/')) {
          statusCount += 1
          statusTimestamps.push(statusCount)
          const done = statusCount >= 3
          return { ok: true, json: () => Promise.resolve(done ? completedBody() : { status: 'processing' }) }
        }
        if (typeof url === 'string' && url.startsWith('data:')) {
          return { ok: true, blob: () => Promise.resolve(new Blob()) }
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      global.URL.createObjectURL = vi.fn(() => 'blob:m')
      const mod = await importModule()
      const p = mod.runJob(baseSnapshot())
      // Drain microtasks without advancing the clock: the FIRST status poll
      // must already have happened — no mandatory 3s wait for fast results.
      await vi.advanceTimersByTimeAsync(0)
      expect(statusCount).toBe(1)                          // immediate first poll
      await vi.advanceTimersByTimeAsync(250)               // +250 ms
      expect(statusCount).toBe(2)
      await vi.advanceTimersByTimeAsync(500)               // +750 ms total → completed
      expect(statusCount).toBe(3)
      await p
    } finally {
      vi.useRealTimers()
    }
  })

  it('backs off to 2s polling after the ten-second fast window', async () => {
    vi.useFakeTimers()
    try {
      let statusCount = 0
      global.fetch = vi.fn(async (url) => {
        if (url === '/api/config') return { ok: true, json: () => Promise.resolve(CONFIG_RESP) }
        if (url.endsWith('/generate')) return { ok: true, json: () => Promise.resolve({ call_id: 'c1' }) }
        if (url.includes('/status/')) {
          statusCount += 1
          return { ok: true, json: () => Promise.resolve({ status: 'processing' }) }
        }
        throw new Error(`unexpected fetch ${url}`)
      })
      const mod = await importModule()
      const p = mod.runJob(baseSnapshot())
      p.catch(() => {})
      await vi.advanceTimersByTimeAsync(11_000)
      const callsAt11s = statusCount
      // Fast window: immediate + 250 + 500 + 1s×~10 ≈ 13 calls; then 2s cadence.
      expect(callsAt11s).toBeGreaterThanOrEqual(10)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(statusCount - callsAt11s).toBe(1)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(statusCount - callsAt11s).toBe(2)
      // No completion within 15 s of clock here — the eager .catch above keeps
      // the still-pending runJob from becoming an unhandled rejection.
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
        { body: completedBody() },
      ])
      global.URL.createObjectURL = vi.fn(() => 'blob:m')
      const mod = await importModule()
      const statuses = []
      const p = mod.runJob(baseSnapshot(), { onStatus: (s) => statuses.push(s) })
      await vi.advanceTimersByTimeAsync(1200)
      await p
      expect(statuses.length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects with AbortError when aborted mid-poll-wait and releases timers', async () => {
    vi.useFakeTimers()
    try {
      global.fetch = mockFetchSequence([
        { body: CONFIG_RESP },
        { body: { call_id: 'c1' } },
        { body: { status: 'processing' } },
      ])
      const mod = await importModule()
      const controller = new AbortController()
      const p = mod.runJob(baseSnapshot(), { signal: controller.signal })
      p.catch(() => {})
      await vi.advanceTimersByTimeAsync(1)
      controller.abort()
      await expect(p).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }))
      // Released timers: advancing the clock runs nothing further.
      const fetchCalls = global.fetch.mock.calls.length
      await vi.advanceTimersByTimeAsync(60_000)
      expect(global.fetch.mock.calls.length).toBe(fetchCalls)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects aborted fetch during poll', async () => {
    vi.useFakeTimers()
    try {
      global.fetch = vi.fn(async (url, opts) => {
        if (url === '/api/config') {
          return { ok: true, json: () => Promise.resolve(CONFIG_RESP) }
        }
        if (url.endsWith('/generate')) {
          return { ok: true, json: () => Promise.resolve({ call_id: 'c1' }) }
        }
        if (opts?.signal) {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          throw err
        }
        return { ok: true, json: () => Promise.resolve({ status: 'processing' }) }
      })
      const mod = await importModule()
      const controller = new AbortController()
      const p = mod.runJob(baseSnapshot(), { signal: controller.signal })
      p.catch(() => {})
      await vi.advanceTimersByTimeAsync(1)
      await expect(p).rejects.toThrow(expect.objectContaining({ name: 'AbortError' }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects on status 401 auth errors', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { call_id: 'c1' } },
      { ok: false, status: 401, text: 'unauthorized' },
    ])
    const mod = await importModule()
    await expect(mod.runJob(baseSnapshot())).rejects.toThrow(/Modal status check failed: 401/)
  })

  it('passes server seed, metrics and generation metadata through', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { call_id: 'c1' } },
      {
        body: completedBody({
          seed: 123456,
          metrics: { schema_version: 1, worker_total_ms: 4200, measurement_complete: true },
          generation: { runtime_profile: 'baseline', preset_id: 'Fast', effective_steps: 25 },
        }),
      },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:m')
    const mod = await importModule()
    const result = await mod.runJob(baseSnapshot())
    expect(result.seed).toBe(123456)
    expect(result.metrics.worker_total_ms).toBe(4200)
    expect(result.generation.effective_steps).toBe(25)
    expect(result.clientTotalMs).toBeGreaterThanOrEqual(0)
  })
})

describe('modal runJob moss payload', () => {
  async function importModule() {
    return await import('../modal.js')
  }

  it('adds model and negative_prompt for moss snapshots', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { call_id: 'call-1' } },
      { body: completedBody() },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')

    const mod = await importModule()
    await mod.runJob(baseSnapshot({ model: 'moss', preset: 'Fast', negativePrompt: 'nsfw' }))
    const submitCall = global.fetch.mock.calls[1]
    const body = JSON.parse(submitCall[1].body)
    expect(body.model).toBe('moss')
    expect(body.negative_prompt).toBe('nsfw')
  })

  it('ideogram body carries no model key', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { call_id: 'call-1' } },
      { body: completedBody() },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')

    const mod = await importModule()
    await mod.runJob(baseSnapshot())
    const body = JSON.parse(global.fetch.mock.calls[1][1].body)
    expect(body).not.toHaveProperty('model')
    expect(body).not.toHaveProperty('negative_prompt')
  })
})

describe('modal fetchCapabilities', () => {
  async function importModule() {
    return await import('../modal.js')
  }

  it('returns the capabilities payload on success', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { schema_version: 1, presets: [{ id: 'Fast' }, { id: 'Rapid' }] } },
    ])
    const mod = await importModule()
    const caps = await mod.fetchCapabilities()
    expect(caps.presets.map(p => p.id)).toEqual(['Fast', 'Rapid'])
    const capsCall = global.fetch.mock.calls[1]
    expect(capsCall[0]).toBe('https://modal.example/capabilities')
    expect(capsCall[1].headers.Authorization).toBe('Bearer tok-xyz')
    expect(capsCall[1].cache).toBe('no-store')
  })

  it('returns null on HTTP failure', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { ok: false, status: 503, text: 'deployment configuration error' },
    ])
    const mod = await importModule()
    expect(await mod.fetchCapabilities()).toBeNull()
  })

  it('returns null on network error', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { throw: new TypeError('fetch failed') },
    ])
    const mod = await importModule()
    expect(await mod.fetchCapabilities()).toBeNull()
  })

  it('returns null when unconfigured', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    const mod = await importModule()
    expect(await mod.fetchCapabilities()).toBeNull()
  })
})

describe('modal runJob enhance_caption', () => {
  it('sends enhance_caption for moss snapshots that asked for the upsampler', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { call_id: 'call-1' } },
      { body: completedBody() },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')
    const mod = await import('../modal.js')
    await mod.runJob(baseSnapshot({ model: 'moss', preset: 'Fast', negativePrompt: '', enhanceCaption: true }))
    const body = JSON.parse(global.fetch.mock.calls[1][1].body)
    expect(body.enhance_caption).toBe(true)
  })

  it('omits enhance_caption from ideogram bodies', async () => {
    global.fetch = mockFetchSequence([
      { body: CONFIG_RESP },
      { body: { call_id: 'call-1' } },
      { body: completedBody() },
    ])
    global.URL.createObjectURL = vi.fn(() => 'blob:mock')
    const mod = await import('../modal.js')
    await mod.runJob(baseSnapshot({}))
    const body = JSON.parse(global.fetch.mock.calls[1][1].body)
    expect(body).not.toHaveProperty('enhance_caption')
  })
})
