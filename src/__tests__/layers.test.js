import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'
import { emit, on, resetAllListeners } from '../events.js'

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
  resetAllListeners()
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
  Object.assign(el.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` })
  document.getElementById('canvas-wrapper').appendChild(el)
  return box
}

describe('layers', () => {
  it('keeps the same rows and keyboard focus through prompt edits and toggles', () => {
    addBox('box_0', { desc: 'Cat' })
    emit('state:changed')
    const row = document.querySelector('.layer-row')
    const button = row.querySelector('.layer-lock')
    button.focus()
    button.click()
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Unlock layer: Cat')
    emit('state:changed')
    expect(document.querySelector('.layer-row')).toBe(row)
    expect(document.activeElement).toBe(button)
  })

  it('supports keyboard selection and reordering while retaining focus', () => {
    addBox('box_0', { desc: 'Cat' })
    addBox('box_1', { desc: 'Dog' })
    emit('state:changed')
    const select = vi.fn()
    on('box:select', select)
    const top = document.querySelector('.layer-select')
    top.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(select).toHaveBeenLastCalledWith({ id: 'box_0' })
    const cat = document.activeElement
    expect(cat.getAttribute('aria-label')).toBe('Select layer: Cat')
    cat.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))
    expect(state.boxes.map(box => box.id)).toEqual(['box_1', 'box_0'])
    expect(document.querySelector('.layer-select')).toBe(cat)
    expect(document.activeElement).toBe(cat)
  })

  it('reuses image crops on unrelated edits and refreshes only changed geometry', () => {
    const overlay = document.getElementById('canvas-overlay')
    overlay.src = '/image.png'
    overlay.classList.add('visible')
    Object.defineProperties(overlay, { complete: { value: true }, naturalWidth: { value: 2000 }, naturalHeight: { value: 1000 } })
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage })
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA')
    try {
      addBox('box_0')
      addBox('box_1')
      emit('state:changed')
      expect(drawImage).toHaveBeenCalledTimes(2)
      for (let i = 0; i < 10; i++) emit('state:changed')
      expect(drawImage).toHaveBeenCalledTimes(2)
      state.boxes[0].x = 100
      document.getElementById('box_0').style.left = '100px'
      emit('state:changed')
      expect(drawImage).toHaveBeenCalledTimes(3)
      // Output dimensions stay bounded even for extremely tall boxes.
      state.boxes[0].w = 2
      state.boxes[0].h = 1000
      emit('box:selected', { id: 'box_0' })
      expect(drawImage.mock.calls.at(-1).slice(-2)).toEqual([72, 56])
      overlay.dispatchEvent(new Event('load'))
      expect(drawImage).toHaveBeenCalledTimes(6)
    } finally {
      vi.restoreAllMocks()
    }
  })
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
