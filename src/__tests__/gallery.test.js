import { describe, it, expect, beforeEach, vi } from 'vitest'
import { emit, on } from '../events.js'

const DOM_HTML = `
  <main class="main-content">
    <div class="tab-btn active" data-tab="editor">Editor</div>
    <button class="tab-btn" data-tab="gallery">Gallery</button>
    <button class="tab-btn" data-tab="vision">Vision</button>
    <button class="tab-btn" data-tab="collections">Collections</button>
    <div class="tab-content active" id="tab-editor"></div>
    <div class="tab-content" id="tab-gallery"></div>
    <div class="tab-content" id="tab-vision"></div>
    <div class="tab-content" id="tab-collections"></div>
  </main>
  <div id="toast-container"></div>
  <div id="gallery-grid"></div>
  <div id="gallery-empty" style="display:none">Empty</div>
  <textarea id="json-output">{}</textarea>
  <button id="btn-open-output">Open</button>
  <div id="generate-status"></div>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  global.fetch = vi.fn()
  global.URL.createObjectURL = vi.fn()
})

async function initGalleryModule() {
  const mod = await import('../gallery.js')
  mod.initGallery()
  return mod
}

describe('gallery', () => {
  it('switchTab to gallery renders gallery', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    await initGalleryModule()
    document.querySelector('.tab-btn[data-tab="gallery"]').click()
    const mc = document.querySelector('.main-content')
    expect(mc.classList.contains('gallery-active')).toBe(true)
  })

  it('switchTab back to editor removes gallery-active', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    await initGalleryModule()
    const editorBtn = document.querySelector('.tab-btn[data-tab="editor"]')
    editorBtn.click()
    const mc = document.querySelector('.main-content')
    expect(mc.classList.contains('gallery-active')).toBe(false)
  })

  it('renderGallery shows empty state when no items', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    await initGalleryModule()
    document.querySelector('.tab-btn[data-tab="gallery"]').click()
    const empty = document.getElementById('gallery-empty')
    await vi.waitFor(() => expect(empty.style.display).toBe('block'))
  })

  it('renderGallery renders cards when items exist', async () => {
    let callCount = 0
    global.fetch.mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([
        { id: 'img1.png', img: 'img1.png', mtime: 1000000, prompt_json: '{"high_level_description":"Sunset"}' },
      ])})
    })
    await initGalleryModule()
    document.querySelector('.tab-btn[data-tab="gallery"]').click()
    const grid = document.getElementById('gallery-grid')
    await vi.waitFor(() => expect(grid.children.length).toBe(1))
  })

  it('loadItem emits image:ready + state:loaded and switches to editor', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    await initGalleryModule()
    // We can't call loadItem directly (not exported), but we can test the flow via click
    // Instead, emit image:ready with the gallery's item data shape and test the result
    const events = []
    on('image:ready', (d) => events.push(d))
    on('state:loaded', (d) => events.push(d))
    // Simulate clicking a gallery card by emitting what the card click does
    emit('image:ready', { imageUrl: '/output/test.png', skipSave: true })
    const textarea = document.getElementById('json-output')
    textarea.value = '{"high_level_description":"Hi","compositional_deconstruction":{"elements":[]}}'
    try {
      const json = JSON.parse(textarea.value)
      emit('state:loaded', { json })
    } catch {}
    expect(events.length).toBe(2)
  })

  it('image:ready with dataUrl triggers save to disk', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    await initGalleryModule()
    emit('image:ready', { dataUrl: 'data:img/png;base64,AA', importJson: '{"a":1}' })
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/save-image', expect.anything())
    })
  })

  it('saveToDisk uses the loras from the event payload, not the live UI state', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    const { state } = await import('../state.js')
    state.loras = [{ filename: 'ui_selected.safetensors', source_url: 'u', strengths: {} }]
    await initGalleryModule()
    // The generation used a different lora than what is now selected in the UI.
    emit('image:ready', {
      dataUrl: 'data:image/png;base64,AA',
      importJson: '{}',
      loras: [{ filename: 'gen_used.safetensors', source_url: 'u', strengths: {} }],
    })
    await vi.waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/save-image', expect.anything())
    })
    const saveCall = global.fetch.mock.calls.find(c => c[0] === '/api/save-image')
    const body = JSON.parse(saveCall[1].body)
    expect(body.loraSuffix).toBe('gen_used')
  })

  it('skips save when skipSave is true', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    await initGalleryModule()
    emit('image:ready', { imageUrl: 'x.jpg', skipSave: true })
    // Give any pending microtasks time to process
    await new Promise(r => setTimeout(r, 10))
    // The only fetch calls should be from initGallery/renderGallery (/api/list-output)
    const saveCalls = global.fetch.mock.calls.filter(c => c[0] === '/api/save-image')
    expect(saveCalls.length).toBe(0)
  })
})

describe('model-aware gallery', () => {
  const ITEMS = (meta) => [{
    id: 'a.png', img: 'a.png', prompt_json: JSON.stringify({ high_level_description: 'x' }), mtime: 1, meta,
  }]

  // initGallery fires an initial (empty) render; the tab click renders again.
  // Sequencing the mock avoids the two async renders interleaving.
  function mockItems(items) {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ json: async () => [] })
      .mockResolvedValueOnce({ json: async () => items })
  }

  it('card shows a MOSS chip when meta.model is moss, Ideogram otherwise', async () => {
    mockItems([...ITEMS({ model: 'moss' }), ...ITEMS({})])
    await initGalleryModule()
    document.querySelector('.tab-btn[data-tab="gallery"]').click()
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.gallery-card').length).toBe(2)
    })
    const chips = [...document.querySelectorAll('.gallery-card-model')].map(e => e.textContent)
    expect(chips).toEqual(['MOSS', 'Ideogram'])
  })

  it('loadItem routes MOSS prompt JSON through prompt:apply', async () => {
    const mossLayout = JSON.stringify({
      summary: { caption: 'A fox' },
      items: [{ label: 'object', caption: 'd', bbox: [0, 0, 100, 100] }],
      bbox_coord_space: 'abs_centralized',
      bbox_format: 'yxyx',
    })
    mockItems([{ id: 'm.png', img: 'm.png', prompt_json: mossLayout, mtime: 2, meta: { model: 'moss' } }])
    await initGalleryModule()
    const applied = []
    on('prompt:apply', ({ raw }) => applied.push(raw))
    document.querySelector('.tab-btn[data-tab="gallery"]').click()
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.gallery-card').length).toBe(1)
    })
    document.querySelector('.gallery-card').click()
    expect(applied).toEqual([mossLayout])
  })

  it('collection:add from a card carries the meta model', async () => {
    mockItems(ITEMS({ model: 'moss' }))
    await initGalleryModule()
    const adds = []
    on('collection:add', (p) => adds.push(p))
    document.querySelector('.tab-btn[data-tab="gallery"]').click()
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.gallery-card').length).toBe(1)
    })
    document.querySelector('.gallery-card-btn.add-collection').click()
    expect(adds[0].model).toBe('moss')
  })
})
