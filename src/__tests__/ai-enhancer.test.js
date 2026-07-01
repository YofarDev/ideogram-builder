import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <button id="btn-ai-enhance">AI Enhance</button>
  <button id="btn-rewrite-caption">Rewrite</button>
  <select id="ai-model"></select>
  <textarea id="ai-prompt"></textarea>
  <div id="ai-status" class="ai-status"></div>
  <textarea id="json-output"></textarea>
  <span class="tab-btn" data-tab="editor"></span>
  <select id="ai-aspect-ratio"><option value="1024x1024">1:1</option><option value="1024x768">4:3</option><option value="768x1152">2:3</option><option value="1920x1080">16:9</option></select>
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

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.boxes = []
  state.selectedBoxId = null
  state.boxCounter = 0
  state.globalPalette = []
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.photoArtMode = 1
})

async function initModule(fetchMock) {
  vi.resetModules()
  global.fetch = fetchMock
  const mod = await import('../ai-enhancer.js')
  mod.initAIEnhancer()
  await vi.waitFor(() => expect(document.getElementById('btn-ai-enhance').disabled).toBe(false))
  return mod
}

function configMock() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(CONFIG),
  })
}

describe('aspectRatioStr (via fetch body)', () => {
  async function captureUserMessage(width, height) {
    state.canvas.width = width
    state.canvas.height = height
    document.getElementById('ai-prompt').value = 'test prompt'
    document.getElementById('ai-aspect-ratio').value = `${width}x${height}`

    let capturedBody = null
    const apiMock = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes('/api/config')) return { ok: true, json: () => Promise.resolve(CONFIG) }
      capturedBody = JSON.parse(opts.body)
      return { ok: true, json: () => Promise.resolve(VALID_RESPONSE) }
    })
    await initModule(apiMock)

    document.getElementById('btn-ai-enhance').click()
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/chat/completions'), expect.anything()))
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
    await vi.waitFor(() => {
      expect(document.getElementById('ai-status').textContent).toBeTruthy()
    })
  }

  it('empty prompt shows "Enter a prompt first"', async () => {
    await initModule(configMock())
    document.getElementById('ai-prompt').value = ''
    document.getElementById('btn-ai-enhance').click()
    await vi.waitFor(() => {
      expect(document.getElementById('ai-status').textContent).toContain('Enter a prompt')
    })
  })

  it('no model selected shows error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({
        deepseek: { api_key: 'k', models: ['m'] },
      }),
    })
    await initModule(fetchMock)
    document.getElementById('ai-model').value = ''
    document.getElementById('ai-prompt').value = 'test'
    document.getElementById('btn-ai-enhance').click()
    await vi.waitFor(() => {
      expect(document.getElementById('ai-status').textContent).toContain('No model')
    })
  })

  it('successful call writes JSON and emits state:loaded', async () => {
    const apiMock = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes('/api/config')) return { ok: true, json: () => Promise.resolve(CONFIG) }
      return { ok: true, json: () => Promise.resolve(VALID_RESPONSE) }
    })
    await initModule(apiMock)

    const { on } = await import('../events.js')
    const emitted = []
    on('state:loaded', (d) => emitted.push(d))

    document.getElementById('ai-prompt').value = 'test'
    document.getElementById('btn-ai-enhance').click()
    await vi.waitFor(() => expect(emitted.length).toBe(1))
    const output = document.getElementById('json-output').value
    expect(output).toContain('high_level_description')
  })

  it('HTTP error shows status code', async () => {
    const apiMock = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes('/api/config')) return { ok: true, json: () => Promise.resolve(CONFIG) }
      return { ok: false, status: 429, text: () => Promise.resolve('rate limited') }
    })
    await initModule(apiMock)
    document.getElementById('ai-prompt').value = 'test'
    document.getElementById('btn-ai-enhance').click()
    await vi.waitFor(() => {
      expect(document.getElementById('ai-status').textContent).toContain('429')
    })
  })

  it('empty choices shows "Empty response"', async () => {
    const apiMock = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes('/api/config')) return { ok: true, json: () => Promise.resolve(CONFIG) }
      return { ok: true, json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }) }
    })
    await initModule(apiMock)
    document.getElementById('ai-prompt').value = 'test'
    document.getElementById('btn-ai-enhance').click()
    await vi.waitFor(() => {
      expect(document.getElementById('ai-status').textContent).toContain('Empty response')
    })
  })

  it('missing elements shows error', async () => {
    const noElements = {
      choices: [{ message: { content: JSON.stringify({
        high_level_description: 'test',
        style_description: {},
        compositional_deconstruction: { background: 'bg', elements: undefined },
      })}}],
    }
    const apiMock = vi.fn().mockImplementation(async (url, opts) => {
      if (url.includes('/api/config')) return { ok: true, json: () => Promise.resolve(CONFIG) }
      return { ok: true, json: () => Promise.resolve(noElements) }
    })
    await initModule(apiMock)
    document.getElementById('ai-prompt').value = 'test'
    document.getElementById('btn-ai-enhance').click()
    await vi.waitFor(() => {
      expect(document.getElementById('ai-status').textContent).toContain('elements')
    })
  })
})
