import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'
import { emit, resetAllListeners } from '../events.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <div id="tab-editor" style="width:1200px;height:900px">
    <div id="editor-toolbar"></div>
    <div class="main-content">
      <div class="canvas-container">
        <div id="canvas-wrapper" style="position:relative"></div>
      </div>
    </div>
    <div id="desc-dock" class="desc-dock"><div id="desc-dock-label"></div><div id="desc-dock-dot"></div><textarea id="box-desc"></textarea></div>
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
  state.canvas = { width: 1024, height: 1024, scale: 1, maxDisplayHeight: 800 }
  delete state.imageDataUrl
  resetAllListeners()
  canvasModule = await import('../canvas.js')
  canvasModule.initCanvas()
  canvasModule.initCanvasEvents()
})

describe('canvas', () => {
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
})
