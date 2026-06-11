import { describe, it, expect, beforeEach } from 'vitest'
import { state, MODE_PHOTO, MODE_ARTSTYLE } from '../state.js'
import { generateJSON } from '../json-builder.js'

const DOM_HTML = `
  <textarea id="json-output"></textarea>
  <input id="high_level_description" value="A sunset">
  <input id="aesthetics" value="warm">
  <input id="lighting" value="golden">
  <input id="background" value="mountains">
  <input id="medium" value="photograph">
  <input id="art_style" value="impressionist">
  <button id="btn-copy-json"></button>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.boxes = []
  state.selectedBoxId = null
  state.boxCounter = 0
  state.globalPalette = []
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.photoArtMode = MODE_ARTSTYLE
})

function getOutput() {
  return JSON.parse(document.getElementById('json-output').value)
}

function addBox(overrides = {}) {
  const box = {
    id: `box_${state.boxes.length}`,
    mode: 'obj',
    x: 0, y: 0, w: 512, h: 512,
    desc: 'a box',
    text: '',
    colors: [],
    ...overrides,
  }
  state.boxes.push(box)
  // Create matching DOM element
  const el = document.createElement('div')
  el.id = box.id
  el.style.left = box.x + 'px'
  el.style.top = box.y + 'px'
  el.style.width = box.w + 'px'
  el.style.height = box.h + 'px'
  document.body.appendChild(el)
  return box
}

describe('coordinate normalization', () => {
  it('normalizes (0,0)-(512,512) on 1024x1024 canvas', () => {
    addBox({ x: 0, y: 0, w: 512, h: 512 })
    generateJSON()
    const el = getOutput().compositional_deconstruction.elements[0]
    expect(el.bbox).toEqual([0, 0, 500, 500])
  })

  it('normalizes (512,512)-(1024,1024) on 1024x1024 canvas', () => {
    addBox({ x: 512, y: 512, w: 512, h: 512 })
    generateJSON()
    const el = getOutput().compositional_deconstruction.elements[0]
    expect(el.bbox).toEqual([500, 500, 1000, 1000])
  })

  it('clamps negative coords to 0', () => {
    addBox({ x: -100, y: -50, w: 200, h: 200 })
    generateJSON()
    const el = getOutput().compositional_deconstruction.elements[0]
    expect(el.bbox[0]).toBe(0)
    expect(el.bbox[1]).toBe(0)
  })

  it('clamps past-canvas coords to 1000', () => {
    addBox({ x: 900, y: 900, w: 300, h: 300 })
    generateJSON()
    const el = getOutput().compositional_deconstruction.elements[0]
    expect(el.bbox[2]).toBe(1000)
    expect(el.bbox[3]).toBe(1000)
  })
})

describe('JSON structure', () => {
  it('includes top-level keys', () => {
    generateJSON()
    const out = getOutput()
    expect(out).toHaveProperty('high_level_description')
    expect(out).toHaveProperty('style_description')
    expect(out).toHaveProperty('compositional_deconstruction')
  })

  it('PHOTO mode includes photo + medium fields', () => {
    state.photoArtMode = MODE_PHOTO
    generateJSON()
    const sd = getOutput().style_description
    expect(sd).toHaveProperty('photo')
    expect(sd).toHaveProperty('medium')
    expect(sd).not.toHaveProperty('art_style')
  })

  it('ARTSTYLE mode includes art_style + medium fields', () => {
    state.photoArtMode = MODE_ARTSTYLE
    generateJSON()
    const sd = getOutput().style_description
    expect(sd).toHaveProperty('art_style')
    expect(sd).toHaveProperty('medium')
    expect(sd).not.toHaveProperty('photo')
  })

  it('text box includes text field', () => {
    addBox({ mode: 'text', text: 'Hello' })
    generateJSON()
    const el = getOutput().compositional_deconstruction.elements[0]
    expect(el.type).toBe('text')
    expect(el.text).toBe('Hello')
  })

  it('obj box has no text field', () => {
    addBox({ mode: 'obj' })
    generateJSON()
    const el = getOutput().compositional_deconstruction.elements[0]
    expect(el).not.toHaveProperty('text')
  })

  it('box with colors includes color_palette', () => {
    addBox({ colors: ['#FF0000', '#00FF00'] })
    generateJSON()
    const el = getOutput().compositional_deconstruction.elements[0]
    expect(el.color_palette).toEqual(['#FF0000', '#00FF00'])
  })

  it('box without colors omits color_palette', () => {
    addBox({ colors: [] })
    generateJSON()
    const el = getOutput().compositional_deconstruction.elements[0]
    expect(el).not.toHaveProperty('color_palette')
  })

  it('empty boxes produces valid JSON with empty elements', () => {
    generateJSON()
    const out = getOutput()
    expect(out.compositional_deconstruction.elements).toEqual([])
  })

  it('includes globalPalette in style_description', () => {
    state.globalPalette = ['#AABBCC']
    generateJSON()
    expect(getOutput().style_description.color_palette).toEqual(['#AABBCC'])
  })
})

describe('DOM sync', () => {
  it('reads box positions from DOM elements', () => {
    const box = addBox({ x: 100, y: 200, w: 300, h: 400 })
    // Override DOM positions (different from state)
    const dom = document.getElementById(box.id)
    dom.style.left = '200px'
    dom.style.top = '300px'
    dom.style.width = '100px'
    dom.style.height = '100px'
    generateJSON()
    // DOM values (200,300,100,100) on 1024x1024 → normalized
    const el = getOutput().compositional_deconstruction.elements[0]
    expect(el.bbox[0]).toBe(Math.round((300 / 1024) * 1000)) // y1 from DOM
    expect(el.bbox[1]).toBe(Math.round((200 / 1024) * 1000)) // x1 from DOM
  })
})
