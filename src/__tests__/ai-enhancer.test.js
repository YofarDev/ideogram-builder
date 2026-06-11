import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const { initAIEnhancer } = await import('../ai-enhancer.js')

const DOM_HTML = `
  <button id="btn-ai-enhance">AI Enhance</button>
  <select id="ai-model"></select>
  <textarea id="ai-prompt"></textarea>
  <div id="ai-status" class="ai-status"></div>
  <textarea id="json-output"></textarea>
`

const CONFIG = {
  deepseek: { api_key: 'ds-key', models: ['deepseek-v4-flash'], default_model: 'deepseek-v4-flash' },
  google: { api_key: 'g-key', models: ['gemini-2.5-flash'] },
  openrouter: { api_key: 'or-key', models: ['claude-sonnet-4-6'] },
  mimo: { api_key: 'mi-key', models: ['mimo-model'] },
}

const VALID_RESPONSE = {
  choices: [{ message: { content: JSON.stringify({
    high_level_description: 'test',
    style_description: { aesthetics: 'a', lighting: 'b', medium: 'photograph' },
    compositional_deconstruction: { background: 'bg', elements: [{ type: 'obj', desc: 'x', bbox: [0,0,500,500] }] },
  })}}],
}

function setupFetchMock(responses) {
  const mock = vi.fn()
  responses.forEach((r, i) => {
    const status = r.error ? r.status : 200
    mock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(r.body || r),
      text: () => Promise.resolve(r.error || JSON.stringify(r)),
    })
  })
  return mock
}

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.boxes = []
  state.selectedBoxId = null
  state.boxCounter = 0
  state.globalPalette = []
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.photoArtMode = 1
  // initAIEnhancer fetches /api/config — mock it
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(CONFIG),
  })
  initAIEnhancer()
})

describe('aspectRatioStr (via fetch body)', () => {
  async function captureUserMessage(width, height) {
    state.canvas.width = width
    state.canvas.height = height
    document.getElementById('ai-prompt').value = 'test prompt'
    document.getElementById('ai-model').value = 'deepseek::deepseek-v4-flash'

    let capturedBody = null
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      capturedBody = JSON.parse(opts.body)
      return { ok: true, json: () => Promise.resolve(VALID_RESPONSE) }
    })

    document.getElementById('btn-ai-enhance').click()
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())
    return capturedBody.messages[1].content
  }

  it('1024x1024 → 1:1', async () => {
    const msg = await captureUserMessage(1024, 1024)
    expect(msg).toContain('1:1')
  })

  it('1024x768 → 4:3', async () => {
    const msg = await captureUserMessage(1024, 768)
    expect(msg).toContain('4:3')
  })

  it('768x1152 → 2:3', async () => {
    const msg = await captureUserMessage(768, 1152)
    expect(msg).toContain('2:3')
  })

  it('1920x1080 → 16:9', async () => {
    const msg = await captureUserMessage(1920, 1080)
    expect(msg).toContain('16:9')
  })
})

describe('enhancePrompt errors', () => {
  async function clickEnhance(prompt = 'test', model = 'deepseek::deepseek-v4-flash') {
    document.getElementById('ai-prompt').value = prompt
    document.getElementById('ai-model').value = model
    document.getElementById('btn-ai-enhance').click()
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalled())
  }

  it('empty prompt shows "Enter a prompt first"', async () => {
    document.getElementById('ai-prompt').value = ''
    document.getElementById('ai-model').value = 'deepseek::model'
    document.getElementById('btn-ai-enhance').click()
    await vi.waitFor(() => {
      expect(document.getElementById('ai-status').textContent).toContain('Enter a prompt')
    })
  })

  it('no model selected shows error', async () => {
    document.getElementById('ai-prompt').value = 'test'
    document.getElementById('ai-model').value = ''
    document.getElementById('btn-ai-enhance').click()
    await vi.waitFor(() => {
      expect(document.getElementById('ai-status').textContent).toContain('No model')
    })
  })

  it('successful call writes JSON and emits state:loaded', async () => {
    const emitted = []
    const { on } = await import('../events.js')
    on('state:loaded', (d) => emitted.push(d))

    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve(VALID_RESPONSE),
    })

    await clickEnhance()
    const output = document.getElementById('json-output').value
    expect(output).toContain('high_level_description')
    expect(emitted.length).toBe(1)
  })

  it('HTTP error shows status code', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 429, text: () => Promise.resolve('rate limited'),
    })
    await clickEnhance()
    expect(document.getElementById('ai-status').textContent).toContain('429')
  })

  it('empty choices shows "Empty response"', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }),
    })
    await clickEnhance()
    expect(document.getElementById('ai-status').textContent).toContain('Empty response')
  })

  it('missing elements shows error', async () => {
    const noElements = {
      choices: [{ message: { content: JSON.stringify({
        high_level_description: 'test',
        style_description: {},
        compositional_deconstruction: { background: 'bg', elements: undefined },
      })}}],
    }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve(noElements),
    })
    await clickEnhance()
    expect(document.getElementById('ai-status').textContent).toContain('elements')
  })
})
