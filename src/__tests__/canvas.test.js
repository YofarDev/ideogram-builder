import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { state } from '../state.js'
import { emit, on, resetAllListeners } from '../events.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <div id="tab-editor" class="active" style="width:1200px;height:900px">
    <div id="editor-toolbar"></div>
    <div class="main-content">
      <div class="canvas-container">
        <div id="canvas-wrapper" style="position:relative"></div>
      </div>
    </div>
    <div id="queue-panel"></div>
    <div id="box-panel" style="display:none"></div>
    <div id="generate-status"></div>
  </div>
  <img id="canvas-overlay">
  <div id="opacity-group" style="display:none"><input id="overlay-opacity" type="range" value="40"></div>
  <textarea id="json-output"></textarea>
`

let canvasModule

beforeEach(async () => {
  document.body.innerHTML = DOM_HTML
  state.boxes = []
  state.selectedBoxId = null
  state.boxCounter = 0
  state.globalPalette = []
  state.ui.previewMode = false
  state.canvas = { width: 1024, height: 1024, scale: 1, maxDisplayHeight: 800 }
  delete state.imageDataUrl
  resetAllListeners()
  canvasModule = await import('../canvas.js')
  canvasModule.initCanvas()
  canvasModule.initCanvasEvents()
})

afterEach(() => window.dispatchEvent(new Event('blur')))

function pointer(target, type, values = {}) {
  const event = new MouseEvent(type, { bubbles: true, clientX: 100, clientY: 100, ...values })
  if (values.pointerId != null) Object.defineProperty(event, 'pointerId', { value: values.pointerId })
  target.dispatchEvent(event)
}

describe('canvas', () => {
  it('ignores right clicks and preview-mode gestures', () => {
    const canvas = document.getElementById('canvas-wrapper')
    pointer(canvas, 'pointerdown', { button: 2 })
    expect(state.boxes).toHaveLength(0)
    canvasModule.setPreviewMode(true)
    pointer(canvas, 'pointerdown')
    expect(state.boxes).toHaveLength(0)
  })

  it('continues drawing outside the canvas and clamps the result to its edges', () => {
    pointer(document.getElementById('canvas-wrapper'), 'pointerdown')
    pointer(window, 'pointermove', { clientX: 2000, clientY: 2000 })
    pointer(window, 'pointerup')
    const box = state.boxes[0]
    expect(box.x + box.w).toBeCloseTo(1000)
    expect(box.y + box.h).toBeCloseTo(1000)
  })

  it('Escape removes an unfinished box and releases the gesture', () => {
    const canvas = document.getElementById('canvas-wrapper')
    pointer(canvas, 'pointerdown')
    pointer(window, 'pointermove', { clientX: 200, clientY: 200 })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(state.boxes).toHaveLength(0)
    expect(canvas.querySelector('.bounding-box')).toBeNull()
    pointer(canvas, 'pointerdown')
    pointer(window, 'pointermove', { clientX: 300, clientY: 300 })
    pointer(window, 'pointerup')
    expect(state.boxes).toHaveLength(1)
  })

  it('pointercancel restores a dragged box without changing the prompt', () => {
    emit('box:create')
    const changed = vi.fn()
    on('state:changed', changed)
    const box = state.boxes[0]
    pointer(document.getElementById(box.id), 'pointerdown', { clientX: 500, clientY: 500 })
    pointer(window, 'pointermove', { clientX: 700, clientY: 700 })
    pointer(window, 'pointercancel')
    expect(box.x).toBe(375)
    expect(document.getElementById(box.id).style.left).toBe('384px')
    expect(changed).not.toHaveBeenCalled()
  })

  it('ignores another pointer while a gesture is in progress', () => {
    pointer(document.getElementById('canvas-wrapper'), 'pointerdown', { pointerId: 1 })
    pointer(window, 'pointermove', { clientX: 400, clientY: 400, pointerId: 2 })
    pointer(window, 'pointerup', { pointerId: 2 })
    expect(state.boxes[0].w).toBe(0)
    pointer(window, 'pointermove', { clientX: 200, clientY: 200, pointerId: 1 })
    pointer(window, 'pointerup', { pointerId: 1 })
    expect(state.boxes[0].w).toBeCloseTo(100 / 1024 * 1000)
  })

  it('selecting a locked box or clicking a box without moving leaves pasted JSON untouched', () => {
    emit('box:create')
    const changed = vi.fn()
    on('state:changed', changed)
    const box = state.boxes[0]
    pointer(document.getElementById(box.id), 'pointerdown')
    pointer(window, 'pointerup')
    box.locked = true
    pointer(document.getElementById(box.id), 'pointerdown')
    pointer(window, 'pointerup')
    expect(changed).not.toHaveBeenCalled()
  })

  it('keeps the entire box within the right and bottom edges while dragging', () => {
    emit('box:create')
    const box = state.boxes[0]
    pointer(document.getElementById(box.id), 'pointerdown', { clientX: 500, clientY: 500 })
    pointer(window, 'pointermove', { clientX: 2000, clientY: 2000 })
    pointer(window, 'pointerup')
    expect(box.x + box.w).toBe(1000)
    expect(box.y + box.h).toBe(1000)
  })

  it('clears stale recaption data on reset and when loading another image', () => {
    emit('image:ready', { imageUrl: '/first.png', dataUrl: 'data:first' })
    canvasModule.initCanvas()
    expect(state.imageDataUrl).toBeNull()
    emit('image:ready', { imageUrl: '/first.png', dataUrl: 'data:first' })
    emit('image:ready', { imageUrl: '/second.png' })
    expect(state.imageDataUrl).toBeNull()
  })
  it('initCanvas clears boxes and resets canvas', () => {
    state.boxes.push({ id: 'box_0' })
    canvasModule.initCanvas()
    expect(state.boxes.length).toBe(0)
    expect(state.selectedBoxId).toBeNull()
    const cw = document.getElementById('canvas-wrapper')
    expect(cw.style.backgroundImage).toBe('')
  })

  it('clearBoxes removes all box DOM elements', () => {
    const box = { id: 'box_0', x: 0, y: 0, w: 100, h: 100, mode: 'obj', text: '', desc: '', colors: [], locked: false, visible: true }
    state.boxes.push(box)
    const el = document.createElement('div')
    el.id = 'box_0'
    el.className = 'bounding-box'
    document.getElementById('canvas-wrapper').appendChild(el)
    canvasModule.clearBoxes()
    expect(state.boxes.length).toBe(0)
    expect(document.querySelector('.bounding-box')).toBeNull()
  })

  it('selectBox sets selected state', () => {
    const el = document.createElement('div')
    el.id = 'box_0'
    el.className = 'bounding-box'
    document.getElementById('canvas-wrapper').appendChild(el)
    state.boxes.push({ id: 'box_0' })
    canvasModule.selectBox('box_0')
    expect(state.selectedBoxId).toBe('box_0')
    expect(el.classList.contains('selected')).toBe(true)
  })

  it('selectBox(null) deselects', () => {
    state.selectedBoxId = 'box_0'
    canvasModule.selectBox(null)
    expect(state.selectedBoxId).toBeNull()
  })

  it('reorderBoxes appends DOM in box order', () => {
    const cw = document.getElementById('canvas-wrapper')
    const b1 = document.createElement('div'); b1.id = 'box_0'; cw.appendChild(b1)
    const b2 = document.createElement('div'); b2.id = 'box_1'; cw.appendChild(b2)
    state.boxes.push({ id: 'box_0' }, { id: 'box_1' })
    canvasModule.reorderBoxes()
    expect(cw.lastChild.id).toBe('box_1')
  })

  it('keeps a selected box above large layer stacks and restores order when selection changes', () => {
    for (let i = 0; i < 12; i++) emit('box:create')
    const first = state.boxes[0].id
    const last = state.boxes.at(-1).id
    canvasModule.selectBox(first)
    expect(Number(document.getElementById(first).style.zIndex)).toBeGreaterThan(Number(document.getElementById(last).style.zIndex))
    canvasModule.selectBox(last)
    expect(Number(document.getElementById(first).style.zIndex)).toBe(2)
    expect(Number(document.getElementById(last).style.zIndex)).toBe(14)
  })

  it('setPreviewMode toggles class on container', () => {
    canvasModule.setPreviewMode(true)
    expect(document.querySelector('.canvas-container').classList.contains('preview-mode')).toBe(true)
    canvasModule.setPreviewMode(false)
    expect(document.querySelector('.canvas-container').classList.contains('preview-mode')).toBe(false)
  })

  it('state:loaded creates box DOM for each element', () => {
    emit('state:loaded', {
      json: {
        compositional_deconstruction: {
          elements: [
            { type: 'obj', bbox: [0, 0, 500, 500], desc: 'cat' },
          ],
        },
      },
    })
    expect(document.querySelectorAll('.bounding-box').length).toBe(1)
  })

  it('state:loaded skips elements with missing or invalid bbox', () => {
    emit('state:loaded', {
      json: {
        compositional_deconstruction: {
          elements: [
            { type: 'obj', bbox: [0, 0, 500, 500], desc: 'valid' },
            { type: 'obj', desc: 'no bbox key' },
            { type: 'obj', bbox: null, desc: 'null bbox' },
            { type: 'obj', bbox: [0, 0, NaN, 100], desc: 'nan bbox' },
            { type: 'obj', bbox: [0, 0, 100], desc: 'short bbox' },
          ],
        },
      },
    })
    expect(document.querySelectorAll('.bounding-box').length).toBe(1)
  })

  it('box:create adds a new box at center', () => {
    emit('box:create')
    expect(state.boxes.length).toBe(1)
  })

  it('image:ready sets overlay source', () => {
    emit('image:ready', { imageUrl: 'blob:x', dataUrl: 'data:img' })
    const overlay = document.getElementById('canvas-overlay')
    expect(overlay.src).toBe('blob:x')
    expect(overlay.classList.contains('visible')).toBe(true)
    expect(document.getElementById('opacity-group').style.display).toBe('flex')
  })

  it('overlay-opacity slider changes overlay opacity', () => {
    const slider = document.getElementById('overlay-opacity')
    const overlay = document.getElementById('canvas-overlay')
    slider.value = '80'
    slider.dispatchEvent(new Event('input'))
    expect(overlay.style.opacity).toBe('0.8')
  })

  it('dragging a box writes DOM position back into state', () => {
    emit('box:create') // box at x:375,y:375,w:250,h:250 → left=384px on a 1024 canvas
    const box = state.boxes[0]
    const dom = document.getElementById(box.id)
    expect(box.x).toBe(375)

    dom.dispatchEvent(new MouseEvent('pointerdown', { clientX: 500, clientY: 500, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 600, clientY: 600 }))
    window.dispatchEvent(new MouseEvent('pointerup'))

    // DOM moved +100px → new left=484px → normalized ≈ 472.66
    expect(box.x).toBeCloseTo(472.66, 1)
    expect(box.y).toBeCloseTo(472.66, 1)
  })

  it('dragging a box off-canvas clamps coords to [0,1000]', () => {
    emit('box:create')
    const box = state.boxes[0]
    const dom = document.getElementById(box.id)
    dom.dispatchEvent(new MouseEvent('pointerdown', { clientX: 500, clientY: 500, bubbles: true }))
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: -5000, clientY: -5000 }))
    window.dispatchEvent(new MouseEvent('pointerup'))
    expect(box.x).toBe(0)
    expect(box.y).toBe(0)
  })
})
