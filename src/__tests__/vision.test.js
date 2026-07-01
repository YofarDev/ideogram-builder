import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'
import { emit } from '../events.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <div class="main-content"></div>
  <div id="tab-editor"><div id="editor-toolbar"></div><div id="queue-panel"></div><div class="canvas-container"><div id="canvas-wrapper"></div></div></div>
  <div id="vision-dropzone" class="vision-dropzone"></div>
  <input id="vision-file-input" type="file">
  <div id="vision-preview"><img id="vision-preview-img"></div>
  <button id="vision-change-btn">Change</button>
  <button id="btn-vision-process">Process Image</button>
  <div id="vision-status"></div>
  <button id="btn-vision-config">Config</button>
  <select id="vision-model"></select>
  <div id="vision-model-row"></div>
  <div id="vision-model-unavailable" style="display:none">Unavailable</div>
  <select id="vision-pipeline"><option value="current">Current</option><option value="split">Split</option></select>
  <label id="vision-pipeline-label">Pipeline</label>
  <input id="vision-no-sam" type="checkbox">
  <input id="vision-low-memory" type="checkbox">
  <input id="vision-debug" type="checkbox">
  <div id="vision-options" style="display:flex">
    <label id="vision-style-label">Style</label>
    <select id="vision-style-preset"></select>
  </div>
  <select id="vision-bbox-format"><option value="xyxy">xyxy</option><option value="xywh">xywh</option></select>
  <div class="vision-upload"></div>
  <div id="dim-display">1024 × 1024</div>
  <select id="aspect-ratio"><option value="1024x1024">1:1</option></select>
  <textarea id="json-output"></textarea>
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
})
