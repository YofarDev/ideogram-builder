import { describe, it, expect, beforeEach, vi } from 'vitest'
import { emit, on, resetAllListeners } from '../events.js'
import { state } from '../state.js'

const DOM_HTML = `
  <main class="main-content">
    <nav role="tablist" aria-label="Workspace">
      <button class="tab-btn active" data-tab="editor">Editor</button>
      <button class="tab-btn" data-tab="prompt" data-tab-group="assist">Assist</button>
      <button class="tab-btn" data-tab="gallery">Gallery</button>
      <button class="tab-btn" data-tab="collections">Collections</button>
    </nav>
    <nav role="tablist" aria-label="Assist tools">
      <button class="tab-btn" data-tab="prompt">Text</button>
      <button class="tab-btn" data-tab="vision">Vision</button>
    </nav>
    <div class="tab-content active" id="tab-editor"></div>
    <div class="tab-content" id="tab-gallery"></div>
    <div class="tab-content" id="tab-prompt"></div>
    <div class="tab-content" id="tab-vision"></div>
    <div class="tab-content" id="tab-collections"></div>
  </main>
  <div id="toast-container"></div>
  <input id="gallery-search" type="search">
  <select id="gallery-model-filter"><option value="all">All</option><option value="moss">MOSS</option><option value="ideogram">Ideogram</option></select>
  <button id="gallery-refresh">Refresh</button>
  <button id="gallery-clear-filters" hidden>Clear filters</button>
  <button id="gallery-show-more" hidden>Show more images</button>
  <p id="gallery-status"></p>
  <div id="gallery-grid"></div>
  <div id="gallery-empty" hidden>Empty</div>
  <textarea id="json-output">{}</textarea>
  <button id="btn-open-output">Open</button>
`
const item = (id, prompt, meta = {}) => ({ id, img: id, mtime: 1000000, prompt_json: prompt, meta })
const IDEOGRAM = item('sunset.png', '{"high_level_description":"Sunset over mountains"}')
const MOSS = item('fox.png', '{"summary":{"caption":"A fox in snow"},"items":[],"bbox_format":"yxyx","bbox_coord_space":"abs_centralized"}', { model: 'moss' })
const response = data => ({ ok: true, json: async () => data })

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.loras = []
  resetAllListeners()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([])))
})

async function initGalleryModule() {
  const mod = await import('../gallery.js')
  mod.initGallery()
  return mod
}
async function openGallery(data = [IDEOGRAM, MOSS]) {
  fetch.mockResolvedValue(response(data))
  await initGalleryModule()
  document.querySelector('[data-tab="gallery"]').click()
  await vi.waitFor(() => expect(document.getElementById('gallery-grid').getAttribute('aria-busy')).toBe('false'))
}
function search(value) {
  const input = document.getElementById('gallery-search')
  input.value = value
  input.dispatchEvent(new Event('input'))
}

describe('gallery browsing', () => {
  it('keeps the loading status while searching before history arrives', async () => {
    let finish
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await initGalleryModule()
    document.querySelector('[data-tab="gallery"]').click()
    search('fox')
    expect(document.getElementById('gallery-status').textContent).toBe('Loading images…')
    expect(document.getElementById('gallery-empty').hidden).toBe(true)
    finish(response([MOSS]))
    await vi.waitFor(() => expect(document.querySelectorAll('.gallery-card')).toHaveLength(1))
    expect(document.getElementById('gallery-status').textContent).toBe('1 of 1 images')
  })
  it('does not request hidden history during editor startup', async () => {
    await initGalleryModule()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('opens gallery with readable captions and model chips', async () => {
    await openGallery()
    expect(document.querySelector('.main-content').classList.contains('gallery-active')).toBe(true)
    expect([...document.querySelectorAll('.gallery-card-prompt')].map(el => el.textContent)).toEqual(['Sunset over mountains', 'A fox in snow'])
    expect([...document.querySelectorAll('.gallery-card-model')].map(el => el.textContent)).toEqual(['Ideogram', 'MOSS'])
    expect(document.getElementById('gallery-status').textContent).toBe('2 images')
    expect(document.querySelector('img').src).toContain('/api/thumbnail?')
  })

  it('shows an empty state only after a successful empty response', async () => {
    await openGallery([])
    expect(document.getElementById('gallery-empty').hidden).toBe(false)
    expect(document.getElementById('gallery-empty').textContent).toContain('No images yet')
  })

  it('searches captions and filenames locally, combines model filter, and clears both', async () => {
    await openGallery()
    search('FOX')
    expect(document.querySelectorAll('.gallery-card')).toHaveLength(1)
    expect(document.getElementById('gallery-status').textContent).toBe('1 of 2 images')
    search('sunset.png')
    expect(document.querySelectorAll('.gallery-card')).toHaveLength(1)
    const filter = document.getElementById('gallery-model-filter')
    filter.value = 'moss'
    filter.dispatchEvent(new Event('change'))
    expect(document.querySelectorAll('.gallery-card')).toHaveLength(0)
    expect(document.getElementById('gallery-empty').textContent).toContain('No images match')
    document.getElementById('gallery-clear-filters').click()
    expect(document.querySelectorAll('.gallery-card')).toHaveLength(2)
    expect(filter.value).toBe('all')
    expect(document.activeElement.id).toBe('gallery-search')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps existing cards on refresh failure and lets the user retry', async () => {
    await openGallery()
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'offline' }) })
    document.getElementById('gallery-refresh').click()
    await vi.waitFor(() => expect(document.getElementById('gallery-status').textContent).toContain('Could not load'))
    expect(document.querySelectorAll('.gallery-card')).toHaveLength(2)
    expect(document.getElementById('gallery-empty').hidden).toBe(true)
    expect(document.getElementById('gallery-refresh').disabled).toBe(false)
    fetch.mockResolvedValueOnce(response([MOSS]))
    document.getElementById('gallery-refresh').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.gallery-card')).toHaveLength(1))
  })

  it('rejects a malformed list response without pretending the gallery is empty', async () => {
    await openGallery({ error: 'unexpected payload' })
    expect(document.getElementById('gallery-status').textContent).toContain('Could not load')
    expect(document.getElementById('gallery-empty').hidden).toBe(true)
  })

  it('ignores an outdated request when users switch tabs quickly', async () => {
    let finishOld
    fetch.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce(response([MOSS]))
    await initGalleryModule()
    const gallery = document.querySelector('[data-tab="gallery"]')
    gallery.click()
    document.querySelector('[data-tab="editor"]').click()
    gallery.click()
    await vi.waitFor(() => expect(document.querySelectorAll('.gallery-card')).toHaveLength(1))
    finishOld(response([IDEOGRAM, MOSS]))
    await Promise.resolve()
    await Promise.resolve()
    expect(document.querySelectorAll('.gallery-card')).toHaveLength(1)
    expect(document.querySelector('.gallery-card-prompt').textContent).toBe('A fox in snow')
  })

  it('bounds initial rendering for large histories and focuses newly revealed images', async () => {
    await openGallery(Array.from({ length: 100 }, (_, i) => item(`${i}.png`, `Caption ${i}`)))
    expect(document.querySelectorAll('.gallery-card')).toHaveLength(48)
    document.getElementById('gallery-show-more').click()
    expect(document.querySelectorAll('.gallery-card')).toHaveLength(96)
    expect(document.activeElement).toBe(document.querySelectorAll('.gallery-card-open')[48])
    document.getElementById('gallery-show-more').click()
    expect(document.querySelectorAll('.gallery-card')).toHaveLength(100)
    expect(document.getElementById('gallery-show-more').hidden).toBe(true)
  })

  it('falls back to the original if preview generation is unavailable', async () => {
    await openGallery()
    const image = document.querySelector('img')
    image.dispatchEvent(new Event('error'))
    expect(image.src).toContain('/output/sunset.png')
  })

  it('loads either prompt format through the shared apply path and returns to the editor', async () => {
    await openGallery()
    const apply = vi.fn()
    const ready = vi.fn()
    const relayout = vi.fn()
    on('prompt:apply', apply)
    on('image:ready', ready)
    on('canvas:relayout', relayout)
    document.querySelector('.gallery-card-open').click()
    expect(apply).toHaveBeenCalledWith({ raw: IDEOGRAM.prompt_json, quiet: true })
    expect(ready).toHaveBeenCalledWith({ imageUrl: '/output/sunset.png', skipSave: true })
    expect(document.getElementById('tab-editor').classList.contains('active')).toBe(true)
    expect(relayout).toHaveBeenCalled()
  })

  it('collection action carries the saved model without loading the image', async () => {
    await openGallery([MOSS])
    const adds = vi.fn()
    const applied = vi.fn()
    on('collection:add', adds)
    on('prompt:apply', applied)
    document.querySelector('.add-collection').click()
    expect(adds).toHaveBeenCalledWith({ importJson: MOSS.prompt_json, imageUrl: '/output/fox.png', model: 'moss' })
    expect(applied).not.toHaveBeenCalled()
  })

  it('does not remove an image when deletion fails', async () => {
    await openGallery()
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    fetch.mockResolvedValueOnce({ ok: false })
    document.querySelector('.delete').click()
    await vi.waitFor(() => expect(document.querySelector('.toast-error')).not.toBeNull())
    expect(document.querySelectorAll('.gallery-card')).toHaveLength(2)
    expect(document.querySelector('.delete').disabled).toBe(false)
  })

  it('requires deletion confirmation, then updates the filtered gallery after success', async () => {
    await openGallery()
    vi.stubGlobal('confirm', vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true))
    document.querySelector('.delete').click()
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(document.querySelector('.delete').disabled).toBe(false))
    fetch.mockResolvedValueOnce(response({ ok: true }))
    document.querySelector('.delete').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.gallery-card')).toHaveLength(1))
    expect(document.querySelector('.gallery-card-prompt').textContent).toBe('A fox in snow')
  })
})

describe('gallery saving', () => {
  it('saves generated image data and uses event LoRAs rather than the current UI', async () => {
    await initGalleryModule()
    state.loras = [{ filename: 'ui_selected.safetensors' }]
    emit('image:ready', { dataUrl: 'data:image/png;base64,AA', importJson: '{"a":1}', loras: [{ filename: 'gen_used.safetensors' }] })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/save-image', expect.anything()))
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ promptJson: '{"a":1}', loraSuffix: 'gen_used' })
  })

  it('skips existing image loads and deduplicates repeated save events', async () => {
    await initGalleryModule()
    emit('image:ready', { dataUrl: 'data:image/png;base64,AA', skipSave: true })
    expect(fetch).not.toHaveBeenCalled()
    emit('image:ready', { dataUrl: 'data:image/png;base64,AA' })
    emit('image:ready', { dataUrl: 'data:image/png;base64,AA' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports HTTP save failures', async () => {
    await initGalleryModule()
    fetch.mockResolvedValueOnce({ ok: false })
    emit('image:ready', { dataUrl: 'data:image/png;base64,AA' })
    await vi.waitFor(() => expect(document.querySelector('.toast-error')?.textContent).toContain('could not be saved'))
  })
})

describe('workspace tabs', () => {
  it('remembers the last Assist subtab and keeps its top button active', async () => {
    await initGalleryModule()
    const assist = document.querySelector('[data-tab-group="assist"]')
    document.querySelector('[data-tab="vision"]').click()
    expect(assist.classList.contains('active')).toBe(true)
    expect(assist.getAttribute('aria-controls')).toBe('tab-vision')
    document.querySelector('[data-tab="editor"]').click()
    assist.click()
    expect(document.getElementById('tab-vision').classList.contains('active')).toBe(true)
  })

  it('supports arrow, Home, End keys within each tablist and roving tab stops', async () => {
    await initGalleryModule()
    const editor = document.querySelector('[data-tab="editor"]')
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    const assist = document.querySelector('[data-tab-group="assist"]')
    expect(document.activeElement).toBe(assist)
    expect(editor.tabIndex).toBe(-1)
    expect(assist.tabIndex).toBe(0)
    assist.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(document.activeElement.dataset.tab).toBe('collections')
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(document.activeElement).toBe(editor)
  })
})
