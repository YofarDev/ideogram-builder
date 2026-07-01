import { describe, it, expect, beforeEach } from 'vitest'
import { state } from '../state.js'
import { emit, on } from '../events.js'

const DOM_HTML = `
  <div id="layers-list"></div>
  <span id="layer-count">0</span>
  <button id="btn-add-layer">+</button>
  <div id="canvas-wrapper"></div>
  <img id="canvas-overlay" style="display:none">
`

beforeEach(async () => {
  document.body.innerHTML = DOM_HTML
  state.boxes = []
  state.selectedBoxId = null
  await import('../canvas.js')
  const layersModule = await import('../layers.js')
  layersModule.initLayers()
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
})
