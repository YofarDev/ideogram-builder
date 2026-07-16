import { describe, it, expect, beforeEach } from 'vitest'
import { state } from '../state.js'
import { emit, on } from '../events.js'

const DOM_HTML = `
  <div id="layers-list"></div>
  <span id="layer-count">0</span>
  <button id="btn-add-layer">+</button>
  <div id="canvas-wrapper"></div>
  <img id="canvas-overlay" style="display:none">
  <textarea id="json-output"></textarea>
  <input id="high_level_description" value="scene">
  <input id="aesthetics" value="">
  <input id="lighting" value="">
  <input id="medium" value="">
  <input id="art_style" value="">
  <input id="background" value="">
  <button id="btn-load-json"></button>
  <button id="btn-paste-json"></button>
  <button id="btn-copy-json"></button>
`

beforeEach(async () => {
  document.body.innerHTML = DOM_HTML
  state.boxes = []
  state.selectedBoxId = null
  state.canvas.width = 1000
  state.canvas.height = 1000
  await import('../canvas.js')
  const layersModule = await import('../layers.js')
  layersModule.initLayers()
  const jsonModule = await import('../json-builder.js')
  jsonModule.initJsonBuilder()
})

function addBox(id, overrides = {}) {
  const box = {
    id, mode: 'obj', x: 0, y: 0, w: 500, h: 500,
    desc: '', text: '',
    colors: [], color: '#ff0000',
    visible: true, locked: false,
    ...overrides,
  }
  state.boxes.push(box)
  const el = document.createElement('div')
  el.id = id
  document.getElementById('canvas-wrapper').appendChild(el)
  return box
}

describe('layers', () => {
  it('shows empty message when no boxes', () => {
    const list = document.getElementById('layers-list')
    expect(list.textContent).toContain('No layers yet')
  })

  it('renders a row for each box', () => {
    addBox('box_0', { desc: 'Cat' })
    addBox('box_1', { desc: 'Dog' })
    emit('box:selected', { id: 'box_0' })
    const list = document.getElementById('layers-list')
    expect(list.querySelectorAll('.layer-row').length).toBe(2)
  })

  it('updates layer count', () => {
    addBox('box_0')
    emit('box:selected', { id: null })
    const count = document.getElementById('layer-count')
    expect(count.textContent).toBe('1')
  })

  it('marks active row for selected box', () => {
    addBox('box_0', { desc: 'Cat' })
    addBox('box_1', { desc: 'Dog' })
    state.selectedBoxId = 'box_1'
    emit('box:selected', { id: 'box_1' })
    const rows = document.querySelectorAll('.layer-row')
    const active = [...rows].find(r => r.classList.contains('active'))
    expect(active).toBeTruthy()
    expect(active.dataset.id).toBe('box_1')
  })

  it('eye button toggles visibility', () => {
    addBox('box_0')
    emit('box:selected', { id: null })
    const eyeBtn = document.querySelector('.layer-eye')
    expect(eyeBtn).toBeTruthy()
    eyeBtn.click()
    expect(state.boxes[0].visible).toBe(false)
  })

  it('lock button toggles locked', () => {
    addBox('box_0')
    emit('box:selected', { id: null })
    const lockBtn = document.querySelector('.layer-lock')
    expect(lockBtn).toBeTruthy()
    lockBtn.click()
    expect(state.boxes[0].locked).toBe(true)
  })

  it('add layer button emits box:create', () => {
    const events = []
    on('box:create', () => events.push('created'))
    document.getElementById('btn-add-layer').click()
    expect(events).toContain('created')
  })

  function dispatchDrag(el, type, dataTransfer = {}) {
    const ev = new Event(type, { bubbles: true })
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer, writable: true, configurable: true })
    el.dispatchEvent(ev)
    return ev
  }

  it('drag drop reorders state.boxes and emits state:changed', () => {
    addBox('box_0', { desc: 'Cat' })
    addBox('box_1', { desc: 'Dog' })
    emit('state:changed')

    const rows = document.querySelectorAll('.layer-row')
    expect(rows.length).toBe(2)
    // list renders reversed: rows[0]=box_1 (top), rows[1]=box_0 (bottom)

    const changed = []
    on('state:changed', () => changed.push('changed'))

    const dt = { effectAllowed: '', dropEffect: '', setData: () => {}, getData: () => 'box_1' }
    dispatchDrag(rows[0], 'dragstart', dt)
    dispatchDrag(rows[1], 'dragover', dt)
    dispatchDrag(rows[1], 'drop', dt)

    expect(state.boxes.map(b => b.id)).toEqual(['box_1', 'box_0'])
    expect(changed).toContain('changed')

    // generateJSON ran on state:changed → #json-output reflects new element order.
    // Elements are emitted top-layer-first to match the panel: after dragging
    // Dog onto Cat, the panel reads Cat (top) / Dog (bottom) → JSON [Cat, Dog].
    const out = JSON.parse(document.getElementById('json-output').value)
    expect(out.compositional_deconstruction.elements.map(e => e.desc))
      .toEqual(['Cat', 'Dog'])
  })
})
