import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state, MODEL_IDEOGRAM, MODEL_MOSS, MODE_ARTSTYLE } from '../state.js'
import { generateJSON, initJsonBuilder } from '../json-builder.js'
import { resetAllListeners, on } from '../events.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <textarea id="json-output"></textarea>
  <span id="json-format-chip"></span>
  <textarea id="moss-caption">A fox in snow</textarea>
  <input id="moss-meta" value="poster, illustration">
  <select id="moss-canvas"><option value="">—</option><option value="single" selected>single</option></select>
  <textarea id="moss-negative">nsfw</textarea>
  <input type="radio" name="moss_prompt_mode" value="layout" checked>
  <input type="radio" name="moss_prompt_mode" value="caption">
  <input id="high_level_description" value="">
  <input id="aesthetics" value="">
  <input id="lighting" value="">
  <input id="background" value="">
  <input id="medium" value="">
  <input id="art_style" value="">
  <button id="btn-copy-json"></button>
  <button id="btn-load-json"></button>
  <button id="btn-paste-json"></button>
  <input type="radio" id="model-ideogram" name="model" value="ideogram" checked>
  <input type="radio" id="model-moss" name="model" value="moss">
  <select id="aspect-ratio">
    <option value="768x1152">2:3</option>
    <option value="1024x1024">1:1</option>
  </select>
  <div id="dim-display"></div>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.boxes = []
  state.selectedBoxId = null
  state.boxCounter = 0
  state.globalPalette = []
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.photoArtMode = MODE_ARTSTYLE
  state.model = MODEL_IDEOGRAM
  state.moss = { promptMode: 'layout', preset: 'Fast' }
  delete document.body.dataset.mossPrompt
  localStorage.clear()
  resetAllListeners()
})

// Full wiring order mirrors app.js: model.js applies model:set synchronously,
// settings-moss seeds globals, json-builder regenerates on model:changed.
async function wireApp() {
  const { initModel } = await import('../model.js')
  const { initSettingsMoss } = await import('../settings-moss.js')
  initModel()
  initSettingsMoss()
  initJsonBuilder()
}

function addBox(overrides = {}) {
  const box = {
    id: `box_${state.boxes.length}`,
    mode: 'obj',
    x: 0, y: 0, w: 500, h: 500,
    desc: 'a box',
    text: '',
    colors: [],
    tags: [],
    ...overrides,
  }
  state.boxes.push(box)
  const el = document.createElement('div')
  el.id = box.id
  el.style.left = (box.x / 1000 * 1024) + 'px'
  el.style.top = (box.y / 1000 * 1024) + 'px'
  el.style.width = (box.w / 1000 * 1024) + 'px'
  el.style.height = (box.h / 1000 * 1024) + 'px'
  document.body.appendChild(el)
  return box
}

function getOutput() {
  return JSON.parse(document.getElementById('json-output').value)
}

function applyViaLoadButton(raw) {
  document.getElementById('json-output').value = raw
  const btn = document.getElementById('btn-load-json')
  btn.dispatchEvent(new Event('pointerdown'))
  btn.dispatchEvent(new Event('click'))
}

const MOSS_LAYOUT = JSON.stringify({
  summary: { caption: 'A fox in snow' },
  items: [{ label: 'object', caption: 'd', bbox: [-512, -512, 0, 0] }],
  bbox_coord_space: 'abs_centralized',
  bbox_format: 'yxyx',
})

describe('generateJSON dispatch', () => {
  it('MOSS layout mode emits the layout JSON with the right chip', () => {
    state.model = MODEL_MOSS
    state.globalPalette = ['#FFFEEE']
    addBox({ mode: 'character', desc: 'a hero', tags: ['hero'] })
    addBox({ mode: 'text', desc: 'the title', text: 'HELLO' })
    generateJSON()

    const out = getOutput()
    expect(out.bbox_coord_space).toBe('abs_centralized')
    expect(out.bbox_format).toBe('yxyx')
    expect(out.summary).toEqual({ caption: 'A fox in snow', meta: ['poster', 'illustration'], canvas: 'single', palette: ['#FFFEEE'] })
    // top-layer-first: text (added last = top) comes first
    expect(out.items[0]).toEqual({ label: 'text', caption: 'the title', text: 'HELLO', bbox: [-512, -512, 0, 0] })
    expect(out.items[1]).toEqual({ label: 'character', caption: 'a hero', bbox: [-512, -512, 0, 0], tags: ['hero'] })
    expect(document.getElementById('json-format-chip').textContent).toBe('MOSS layout · 1024×1024')
  })

  it('MOSS caption mode puts the caption text in the textarea', () => {
    state.model = MODEL_MOSS
    state.moss.promptMode = 'caption'
    addBox({ mode: 'obj' })
    generateJSON()
    expect(document.getElementById('json-output').value).toBe('A fox in snow')
    expect(document.getElementById('json-format-chip').textContent).toBe('MOSS caption')
  })

  it('character boxes serialize as obj in Ideogram output', () => {
    state.model = MODEL_IDEOGRAM
    addBox({ mode: 'character', desc: 'a hero' })
    generateJSON()
    const el = getOutput().compositional_deconstruction.elements[0]
    expect(el.type).toBe('obj')
  })

  it('ideogram chip updates', () => {
    generateJSON()
    expect(document.getElementById('json-format-chip').textContent).toBe('Ideogram JSON')
  })
})

describe('applyJsonText format routing', () => {
  it('ideogram JSON while MOSS requests model:set and loads the JSON', async () => {
    await wireApp()
    const { emit } = await import('../events.js')
    emit('model:set', { model: 'moss' })
    const sets = []
    const loads = []
    on('model:set', (p) => sets.push(p))
    on('state:loaded', (p) => loads.push(p))
    // Mimic settings.js: state:loaded fills the Ideogram inputs before generate
    on('state:loaded', ({ json }) => {
      document.getElementById('high_level_description').value = json.high_level_description || ''
    })
    const raw = JSON.stringify({ high_level_description: 'A lake', compositional_deconstruction: { elements: [] } })
    applyViaLoadButton(raw)
    expect(sets).toEqual([{ model: 'ideogram', seed: false }])
    expect(loads[0].json.high_level_description).toBe('A lake')
    expect(getOutput().high_level_description).toBe('A lake')
    expect(document.getElementById('json-format-chip').textContent).toBe('Ideogram JSON')
  })

  it('MOSS layout while Ideogram requests model:set moss and loads the view + moss payload', async () => {
    await wireApp()
    const sets = []
    const loads = []
    on('model:set', (p) => sets.push(p))
    on('state:loaded', (p) => loads.push(p))
    applyViaLoadButton(MOSS_LAYOUT)
    expect(sets).toEqual([{ model: 'moss', seed: false }])
    expect(loads[0].moss).toEqual({ caption: 'A fox in snow', meta: [], canvas: '', palette: [] })
    expect(loads[0].json.compositional_deconstruction.elements[0].bbox).toEqual([0, 0, 500, 500])
    expect(state.moss.promptMode).toBe('layout')
  })

  it('MOSS draft resizes the canvas before loading', async () => {
    await wireApp()
    state.model = MODEL_MOSS
    const rebuilds = []
    on('canvas:rebuild', () => rebuilds.push(true))
    const draft = JSON.stringify({
      width: 768, height: 1152, bbox_coord_space: 'abs', bbox_format: 'xyxy',
      summary: { caption: 'tall poster' },
      items: [{ label: 'object', caption: 'd', bbox: [0, 0, 384, 576] }],
    })
    applyViaLoadButton(draft)
    expect(state.canvas.width).toBe(768)
    expect(state.canvas.height).toBe(1152)
    expect(document.getElementById('dim-display').textContent).toBe('768 × 1152')
    expect(rebuilds.length).toBe(1)
  })

  it('plain caption while MOSS fills #moss-caption and switches to caption mode', async () => {
    await wireApp()
    state.model = MODEL_MOSS
    applyViaLoadButton('A red fox in snow')
    expect(document.getElementById('moss-caption').value).toBe('A red fox in snow')
    expect(state.moss.promptMode).toBe('caption')
    expect(document.body.dataset.mossPrompt).toBe('caption')
    expect(document.getElementById('json-output').value).toBe('A red fox in snow')
  })

  it('plain caption while Ideogram is rejected without touching anything', async () => {
    await wireApp()
    const sets = []
    on('model:set', (p) => sets.push(p))
    applyViaLoadButton('A red fox in snow')
    expect(sets).toEqual([])
    expect(document.getElementById('json-output').value).toBe('A red fox in snow') // unchanged
    expect(document.getElementById('moss-caption').value).toBe('A fox in snow')   // unchanged
  })

  it('empty input is rejected', async () => {
    await wireApp()
    applyViaLoadButton('   ')
    expect(document.getElementById('json-output').value).toBe('   ')
  })
})

describe('model switch integration', () => {
  it('model:set moss with an Ideogram description regenerates a seeded MOSS layout', async () => {
    await wireApp()
    document.getElementById('high_level_description').value = 'A sunset over hills'
    document.getElementById('moss-caption').value = ''  // MOSS fields empty → D4 seeds
    generateJSON()  // pane holds Ideogram JSON before the switch
    expect(document.getElementById('json-format-chip').textContent).toBe('Ideogram JSON')

    const { emit } = await import('../events.js')
    emit('model:set', { model: 'moss' })

    const out = getOutput()
    expect(out.bbox_coord_space).toBe('abs_centralized')
    expect(out.summary.caption).toBe('A sunset over hills')
    expect(document.getElementById('json-format-chip').textContent).toContain('MOSS layout')
  })

  it('paste-driven switch skips D4 seeding (no conversion toast)', async () => {
    const { showToast } = await import('../toast.js')
    await wireApp()
    showToast.mockClear()
    // Non-empty Ideogram description: without seed:false this would toast
    document.getElementById('high_level_description').value = 'Old ideogram content'
    generateJSON()

    applyViaLoadButton(MOSS_LAYOUT)
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('Converted Ideogram fields to MOSS'), expect.anything())
    // the pasted payload wins over any seeding
    expect(document.getElementById('moss-caption').value).toBe('A fox in snow')
  })
})
