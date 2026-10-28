import { beforeEach, expect, it, vi } from 'vitest'
import { state } from '../state.js'
import { on, resetAllListeners } from '../events.js'
import { captureWorkspace, restoreWorkspace } from '../session-workspace.js'
import { initCanvas, initCanvasEvents } from '../canvas.js'
import { initPalette } from '../palette.js'

beforeEach(() => {
  resetAllListeners()
  document.body.innerHTML = `<div id="tab-editor" class="active"><div id="editor-toolbar"></div><div class="canvas-container"><div id="canvas-wrapper"><img id="canvas-overlay"></div></div></div><div id="opacity-group"><input id="overlay-opacity"></div><div id="global-colors"></div><div id="box-colors"></div><div id="dim-display"></div>`
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.boxes = []
  state.boxCounter = 0
  state.selectedBoxId = null
  state.globalPalette = []
  initCanvas()
  initCanvasEvents()
  initPalette()
})

it('restores custom canvas dimensions, layer details and selection independently of prompt format', () => {
  state.canvas.width = 1234
  state.canvas.height = 987
  state.boxes = [{ id: 'old_id', x: 100, y: 200, w: 300, h: 400, mode: 'character', text: '', desc: 'Subject', color: '#abcdef', colors: ['#abcdef'], tags: ['person'], visible: false, locked: true }]
  state.selectedBoxId = 'old_id'
  state.globalPalette = ['#aabbcc']
  const snapshot = captureWorkspace()
  state.boxes[0].tags.push('new tag')
  expect(snapshot.boxes[0].tags).toEqual(['person'])
  state.boxes = []
  expect(restoreWorkspace(snapshot)).toBe(true)
  expect(state.canvas.width).toBe(1234)
  expect(document.getElementById('dim-display').textContent).toBe('1234 × 987')
  const box = state.boxes[0]
  expect(box).toMatchObject({ desc: 'Subject', visible: false, locked: true, color: '#abcdef', tags: ['person'] })
  expect(box.id).not.toBe('old_id')
  expect(state.selectedBoxId).toBe(box.id)
  expect(document.getElementById(box.id).style.display).toBe('none')
  expect(document.getElementById(box.id).style.cursor).toBe('not-allowed')
  expect(state.globalPalette).toEqual(['#aabbcc'])
})

it('leaves the existing prompt workspace alone for old or malformed snapshots', () => {
  const restore = vi.fn()
  on('workspace:restore', restore)
  expect(restoreWorkspace(undefined)).toBe(false)
  expect(restoreWorkspace({ width: 0, height: 20, boxes: [] })).toBe(false)
  expect(restoreWorkspace({ width: 20, height: 20, boxes: [{ x: NaN, y: 0, w: 1, h: 1 }] })).toBe(false)
  expect(restore).not.toHaveBeenCalled()
  expect(state.canvas.width).toBe(1024)
})

it('restores saved image references and opacity without serializing image data or saving a duplicate', () => {
  state.referenceImageUrl = '/output/reference.png'
  state.imageDataUrl = 'data:large-image'
  document.getElementById('canvas-overlay').style.opacity = '0.75'
  const snapshot = captureWorkspace()
  expect(JSON.stringify(snapshot)).not.toContain('large-image')
  const ready = vi.fn()
  on('image:ready', ready)
  expect(restoreWorkspace(snapshot)).toBe(true)
  expect(ready).toHaveBeenCalledWith({ imageUrl: '/output/reference.png', opacity: 0.75, skipSave: true })
  expect(document.getElementById('canvas-overlay').getAttribute('src')).toBe('/output/reference.png')
  expect(document.getElementById('canvas-overlay').style.opacity).toBe('0.75')
})
