import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'
import { on, emit } from '../events.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <div id="global-colors"></div>
  <div id="box-colors"></div>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.boxes = []
  state.selectedBoxId = null
  state.globalPalette = []
})

describe('initPalette', () => {
  it('adds global color via + button', async () => {
    const { initPalette } = await import('../palette.js')
    initPalette()
    emit('state:loaded', { json: { style_description: {} } })
    document.querySelector('#global-colors .icon-btn').click()
    const tmp = document.querySelector('input[type="color"]')
    tmp.value = '#FF0000'
    tmp.dispatchEvent(new Event('change', { bubbles: true }))
    expect(state.globalPalette).toEqual(['#FF0000'])
    const swatches = document.querySelectorAll('#global-colors .swatch')
    expect(swatches.length).toBe(1)
    expect(swatches[0].style.backgroundColor).toBe('rgb(255, 0, 0)')
  })

  it('rejects duplicate global color', async () => {
    const { showToast } = await import('../toast.js')
    const { initPalette } = await import('../palette.js')
    initPalette()
    emit('state:loaded', { json: { style_description: {} } })
    state.globalPalette.push('#FF0000')
    document.querySelector('#global-colors .icon-btn').click()
    const tmp = document.querySelector('input[type="color"]')
    tmp.value = '#FF0000'
    tmp.dispatchEvent(new Event('change', { bubbles: true }))
    expect(state.globalPalette).toEqual(['#FF0000'])
  })

  it('rejects >16 global colors', async () => {
    const { initPalette } = await import('../palette.js')
    initPalette()
    emit('state:loaded', { json: { style_description: {} } })
    state.globalPalette = Array.from({ length: 16 }, (_, i) => `#${i}${i}${i}${i}${i}${i}`)
    document.querySelector('#global-colors .icon-btn').click()
    const tmp = document.querySelector('input[type="color"]')
    tmp.value = '#FFFFFF'
    tmp.dispatchEvent(new Event('change', { bubbles: true }))
    expect(state.globalPalette.length).toBe(16)
  })

  it('adds box color for selected box', async () => {
    const { initPalette } = await import('../palette.js')
    initPalette()
    const box = { id: 'box_0', colors: [] }
    state.boxes.push(box)
    state.selectedBoxId = 'box_0'
    emit('state:loaded', { json: { style_description: {} } })
    document.querySelector('#box-colors .icon-btn').click()
    const tmp = document.querySelector('input[type="color"]')
    tmp.value = '#00FF00'
    tmp.dispatchEvent(new Event('change', { bubbles: true }))
    expect(box.colors).toEqual(['#00FF00'])
  })

  it('rejects >5 colors per box', async () => {
    const { initPalette } = await import('../palette.js')
    initPalette()
    const box = { id: 'box_0', colors: ['#1','#2','#3','#4','#5'] }
    state.boxes.push(box)
    state.selectedBoxId = 'box_0'
    emit('state:loaded', { json: { style_description: {} } })
    document.querySelector('#box-colors .icon-btn').click()
    const tmp = document.querySelector('input[type="color"]')
    tmp.value = '#FFFFFF'
    tmp.dispatchEvent(new Event('change', { bubbles: true }))
    expect(box.colors.length).toBe(5)
  })

  it('clicking swatch removes global color', async () => {
    const { initPalette } = await import('../palette.js')
    initPalette()
    state.globalPalette = ['#FF0000', '#00FF00']
    emit('state:loaded', { json: { style_description: { color_palette: ['#FF0000'] } } })
    const swatch = document.querySelector('#global-colors .swatch')
    if (swatch) swatch.click()
    expect(state.globalPalette).toEqual([])
  })

  it('state:loaded restores global palette', async () => {
    const { initPalette } = await import('../palette.js')
    initPalette()
    emit('state:loaded', { json: { style_description: { color_palette: ['#AABBCC'] } } })
    expect(state.globalPalette).toEqual(['#AABBCC'])
  })
})
