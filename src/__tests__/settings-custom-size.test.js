// Custom canvas size: the "Custom…" aspect-ratio option plus W×H inputs.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'
import { showToast } from '../toast.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <select id="aspect-ratio">
    <option value="1024x1024">1:1</option>
    <option value="768x1152">2:3</option>
    <option value="custom">Custom…</option>
  </select>
  <div id="custom-size-row" style="display:none">
    <input id="custom-width" type="number" step="16">
    <input id="custom-height" type="number" step="16">
  </div>
  <button class="size-btn active" data-size="1">1x</button>
  <button class="size-btn" data-size="1.5">1.5x</button>
  <button class="size-btn" data-size="2">2x</button>
  <div id="dim-display">1024 × 1024</div>
  <input id="mode_photo" type="radio" name="mode" value="photo">
  <input id="mode_artstyle" type="radio" name="mode" value="artstyle" checked>
  <span id="mode_label">Art Style</span>
  <input id="box-mode" value="obj">
  <input id="box-text" value="">
  <textarea id="box-desc"></textarea>
  <div id="text-input-group" style="display:none"></div>
  <input id="high_level_description" value="A scene">
  <input id="aesthetics" value="warm">
  <input id="lighting" value="soft">
  <input id="medium" value="illustration">
  <input id="art_style" value="impressionist">
  <input id="background" value="mountains">
  <input id="seed-input" value="-1">
  <button id="btn-random-seed">Random</button>
  <input type="radio" name="steps" data-preset="Default" checked>
  <input type="radio" name="steps" data-preset="Quality">
  <input type="radio" name="steps" data-preset="Turbo">
  <input type="radio" name="workflow" value="turbo" checked>
  <input type="radio" name="workflow" value="v1">
  <input type="radio" name="backend" value="runpod" checked>
  <input type="radio" name="backend" value="modal">
  <input id="turbo-strength" type="range" value="0.8">
  <div id="turbo-strength-group"></div>
  <div id="box-panel" style="display:none">
    <input id="box-x" value="0">
    <input id="box-y" value="0">
    <input id="box-w" value="500">
    <input id="box-h" value="500">
    <button id="btn-reroll-color">Reroll</button>
    <span id="box-color-swatch" style="background:var(--accent)"></span>
    <div id="recaption-group" style="display:none">
      <select id="recaption-model"></select>
      <textarea id="recaption-instructions"></textarea>
      <button id="btn-recaption">Recaption</button>
    </div>
  </div>
  <div class="main-content"></div>
  <textarea id="json-output">{}</textarea>
  <button id="btn-load-json">Load</button>
  <button id="btn-paste-json">Paste</button>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.boxes = []
  state.selectedBoxId = null
  state.boxCounter = 0
  state.globalPalette = []
  localStorage.clear()
  vi.mocked(showToast).mockClear()
})

async function initSettings() {
  const mod = await import('../settings.js')
  mod.initSettings()
  return mod
}

function selectCustom() {
  const sel = document.getElementById('aspect-ratio')
  sel.value = 'custom'
  sel.dispatchEvent(new Event('change'))
}

function setCustomSize(width, height) {
  const w = document.getElementById('custom-width')
  const h = document.getElementById('custom-height')
  w.value = String(width)
  h.value = String(height)
  w.dispatchEvent(new Event('change'))
  h.dispatchEvent(new Event('change'))
}

describe('custom canvas size', () => {
  it('selecting Custom… reveals the row, prefills current canvas and keeps it stable', async () => {
    await initSettings()
    selectCustom()
    expect(document.getElementById('custom-size-row').style.display).not.toBe('none')
    expect(document.getElementById('custom-width').value).toBe('1024')
    expect(document.getElementById('custom-height').value).toBe('1024')
    expect(state.canvas.width).toBe(1024)
    expect(state.canvas.height).toBe(1024)
    expect(localStorage.getItem('ideogram_aspect_ratio')).toBe('custom')
  })

  it('typing valid custom values resizes the canvas and persists them', async () => {
    await initSettings()
    selectCustom()
    setCustomSize(832, 1216)
    expect(state.canvas.width).toBe(832)
    expect(state.canvas.height).toBe(1216)
    expect(document.getElementById('dim-display').textContent).toBe('832 × 1216')
    expect(localStorage.getItem('ideogram_custom_width')).toBe('832')
    expect(localStorage.getItem('ideogram_custom_height')).toBe('1216')
  })

  it('rejects non-multiple-of-16 values with a toast and keeps the canvas', async () => {
    await initSettings()
    selectCustom()
    setCustomSize(832, 1216)
    showToast.mockClear()
    const w = document.getElementById('custom-width')
    w.value = '100'
    w.dispatchEvent(new Event('change'))
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('multiples of 16'), 'warning')
    expect(state.canvas.width).toBe(832)
    expect(w.value).toBe('832')
  })

  it('switching back to a preset hides the row and applies preset dims', async () => {
    await initSettings()
    selectCustom()
    setCustomSize(832, 1216)
    const sel = document.getElementById('aspect-ratio')
    sel.value = '768x1152'
    sel.dispatchEvent(new Event('change'))
    expect(document.getElementById('custom-size-row').style.display).toBe('none')
    expect(state.canvas.width).toBe(768)
    expect(state.canvas.height).toBe(1152)
  })

  it('size tiers scale the custom base', async () => {
    await initSettings()
    selectCustom()
    setCustomSize(832, 1216)
    document.querySelector('.size-btn[data-size="1.5"]').click()
    // round16(832·√1.5)=1024, round16(1216·√1.5)=1488
    expect(state.canvas.width).toBe(1024)
    expect(state.canvas.height).toBe(1488)
  })

  it('restores a saved custom selection with its dimensions', async () => {
    localStorage.setItem('ideogram_aspect_ratio', 'custom')
    localStorage.setItem('ideogram_custom_width', '832')
    localStorage.setItem('ideogram_custom_height', '1216')
    await initSettings()
    const sel = document.getElementById('aspect-ratio')
    sel.value = 'custom'
    sel.dispatchEvent(new Event('change'))
    expect(document.getElementById('custom-width').value).toBe('832')
    expect(document.getElementById('custom-height').value).toBe('1216')
    expect(state.canvas.width).toBe(832)
    expect(state.canvas.height).toBe(1216)
  })
})
