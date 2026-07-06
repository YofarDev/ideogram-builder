import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'
import { emit } from '../events.js'
import { resetConfigCache } from '../vision-config.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <div class="main-content"></div>
  <div id="tab-editor"><div id="editor-toolbar"></div><div id="queue-panel"></div><div class="canvas-container"><div id="canvas-wrapper"></div></div></div>
  <div id="vision-dropzone" class="vision-dropzone"></div>
  <input id="vision-file-input" type="file">
  <div id="vision-preview"><img id="vision-preview-img"></div>
  <button id="vision-change-btn">Change</button>
  <button id="btn-vision-process">Process Image</button>
  <input id="vision-instruction" type="text" style="display:none;">
  <button id="btn-vision-find-more" style="display:none;">Find more items</button>
  <div id="vision-status"></div>
  <button id="btn-vision-config">Config</button>
  <select id="vision-model"></select>
  <div id="vision-model-row"></div>
  <div id="vision-model-unavailable" style="display:none">Unavailable</div>
  <select id="vision-pipeline"><option value="current">Current</option><option value="split">Split</option></select>
  <label id="vision-pipeline-label">Pipeline</label>
  <label class="vision-option"><input id="vision-no-sam" type="checkbox"></label>
  <label class="vision-option"><input id="vision-low-memory" type="checkbox"></label>
  <label class="vision-option"><input id="vision-debug" type="checkbox"></label>
  <div id="vision-options" style="display:flex">
    <label id="vision-style-label">Style</label>
    <select id="vision-style-preset"></select>
  </div>
  <select id="vision-bbox-format"><option value="xyxy">xyxy</option><option value="xywh">xywh</option></select>
  <div class="vision-upload"></div>
  <div id="dim-display">1024 × 1024</div>
  <select id="aspect-ratio"><option value="1024x1024">1:1</option></select>
  <textarea id="json-output"></textarea>
  <textarea id="vision-json"></textarea>
  <button id="tab-btn-editor">Editor</button>
`

let visionModule

beforeEach(async () => {
  document.body.innerHTML = DOM_HTML
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.boxes = []
  localStorage.clear()
  global.URL.createObjectURL = vi.fn()
  global.URL.revokeObjectURL = vi.fn()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
  visionModule = await import('../vision.js')
  visionModule.initVision()
})

describe('vision', () => {
  it('populates vision model dropdown from config', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        vision: { openai: { api_key: 'k', models: ['gpt-4-vision'] } },
        _meta: {},
      }),
    })
    resetConfigCache()
    visionModule.initVision()
    const sel = document.getElementById('vision-model')
    await vi.waitFor(() => expect(sel.options.length).toBeGreaterThan(0))
  })

  it('handles missing vision config gracefully', () => {
    const row = document.getElementById('vision-model-row')
    expect(row).toBeTruthy()
  })

  it('dropzone click triggers file input click', () => {
    const fileInput = document.getElementById('vision-file-input')
    const spy = vi.spyOn(fileInput, 'click')
    document.getElementById('vision-dropzone').click()
    expect(spy).toHaveBeenCalled()
  })

  it('change button triggers file input', () => {
    const fileInput = document.getElementById('vision-file-input')
    const spy = vi.spyOn(fileInput, 'click')
    document.getElementById('vision-change-btn').click()
    expect(spy).toHaveBeenCalled()
  })

  it('pipeline select persists to localStorage', () => {
    const sel = document.getElementById('vision-pipeline')
    sel.value = 'split'
    sel.dispatchEvent(new Event('change'))
    expect(localStorage.getItem('vision_pipeline')).toBe('split')
  })

  it('pipeline dropdown stays visible for external models (cloud split support)', () => {
    const modelSel = document.getElementById('vision-model')
    const opt = document.createElement('option')
    opt.value = 'openai::gpt-4o'
    opt.textContent = 'GPT-4o'
    modelSel.appendChild(opt)
    modelSel.value = 'openai::gpt-4o'
    modelSel.dispatchEvent(new Event('change'))
    const pipelineSelect = document.getElementById('vision-pipeline')
    expect(pipelineSelect.style.display).not.toBe('none')
  })

  it('options block visible for external model + split (debug knob)', () => {
    const modelSel = document.getElementById('vision-model')
    const opt = document.createElement('option')
    opt.value = 'openai::gpt-4o'
    opt.textContent = 'GPT-4o'
    modelSel.appendChild(opt)
    modelSel.value = 'openai::gpt-4o'
    modelSel.dispatchEvent(new Event('change'))
    const pipelineSel = document.getElementById('vision-pipeline')
    pipelineSel.value = 'split'
    pipelineSel.dispatchEvent(new Event('change'))
    const options = document.getElementById('vision-options')
    expect(options.style.display).toBe('flex')
    // low_memory is local-only — must stay hidden for external
    const lowMemRow = document.getElementById('vision-low-memory').closest('.vision-option')
    expect(lowMemRow.style.display).toBe('none')
  })

  it('bbox format select persists to localStorage', () => {
    const sel = document.getElementById('vision-bbox-format')
    sel.value = 'xywh'
    sel.dispatchEvent(new Event('change'))
    expect(localStorage.getItem('vision_bbox_format')).toBe('xywh')
  })

  it('image:ready from generation does not clobber preview', () => {
    const preview = document.getElementById('vision-preview')
    emit('image:ready', { imageUrl: 'gen.png', source: 'generation' })
    expect(preview.classList.contains('visible')).toBe(false)
  })

  it('image:ready from vision shows preview', () => {
    const preview = document.getElementById('vision-preview')
    const img = document.getElementById('vision-preview-img')
    emit('image:ready', { imageUrl: 'ref.png' })
    expect(preview.classList.contains('visible')).toBe(true)
    expect(img.src).toMatch(/\/ref\.png$/)
  })

  it('shows Find more + instruction when image and JSON are present', () => {
    const findMoreBtn = document.getElementById('btn-vision-find-more')
    const instructionInput = document.getElementById('vision-instruction')
    const previewImg = document.getElementById('vision-preview-img')
    const visionJson = document.getElementById('vision-json')

    previewImg.src = 'data:image/png;base64,abc'
    visionJson.value = '{"compositional_deconstruction":{"elements":[]}}'
    emit('state:loaded', { json: JSON.parse(visionJson.value) })

    expect(findMoreBtn.style.display).not.toBe('none')
    expect(instructionInput.style.display).not.toBe('none')
  })

  it('hides Find more + instruction when JSON is empty', () => {
    const findMoreBtn = document.getElementById('btn-vision-find-more')
    const instructionInput = document.getElementById('vision-instruction')
    const previewImg = document.getElementById('vision-preview-img')
    const visionJson = document.getElementById('vision-json')

    previewImg.src = 'data:image/png;base64,abc'
    visionJson.value = ''
    emit('state:loaded', { json: {} })

    expect(findMoreBtn.style.display).toBe('none')
    expect(instructionInput.style.display).toBe('none')
  })

  it('typing into vision-json reveals Find more', () => {
    const findMoreBtn = document.getElementById('btn-vision-find-more')
    const previewImg = document.getElementById('vision-preview-img')
    const visionJson = document.getElementById('vision-json')

    previewImg.src = 'data:image/png;base64,abc'
    visionJson.value = ''
    emit('state:loaded', { json: {} })
    expect(findMoreBtn.style.display).toBe('none')

    visionJson.value = '{"compositional_deconstruction":{"elements":[{"desc":"x"}]}}'
    visionJson.dispatchEvent(new Event('input'))

    expect(findMoreBtn.style.display).not.toBe('none')
  })

  it('findMore sends instruction in body when input is non-empty', async () => {
    const previewImg = document.getElementById('vision-preview-img')
    const visionJson = document.getElementById('vision-json')
    const instructionInput = document.getElementById('vision-instruction')
    previewImg.src = 'data:image/png;base64,abc'
    visionJson.value = '{"compositional_deconstruction":{"elements":[{"desc":"a"}]}}'
    instructionInput.value = 'find missing people'

    const calls = []
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, json: () => Promise.resolve({ new_elements: [] }) }
    })

    document.getElementById('btn-vision-find-more').click()
    await vi.waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0].url).toBe('/api/img-to-json/more')
    expect(calls[0].body.instruction).toBe('find missing people')
  })

  it('findMore omits instruction when input is empty', async () => {
    const previewImg = document.getElementById('vision-preview-img')
    const visionJson = document.getElementById('vision-json')
    previewImg.src = 'data:image/png;base64,abc'
    visionJson.value = '{"compositional_deconstruction":{"elements":[{"desc":"a"}]}}'

    const calls = []
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) })
      return { ok: true, json: () => Promise.resolve({ new_elements: [] }) }
    })

    document.getElementById('btn-vision-find-more').click()
    await vi.waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0].body).not.toHaveProperty('instruction')
  })
})
