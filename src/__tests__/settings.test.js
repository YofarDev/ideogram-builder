import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { state, MODE_PHOTO, MODE_ARTSTYLE } from '../state.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <select id="aspect-ratio"><option value="1024x1024">1:1</option><option value="768x1152">2:3</option></select>
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
  <div id="desc-dock" class="desc-dock show" aria-hidden="false">
    <span id="desc-dock-label"></span>
    <span id="desc-dock-dot"></span>
    <textarea id="box-desc"></textarea>
  </div>
  <div class="main-content"></div>
  <textarea id="json-output">{}</textarea>
  <button id="btn-load-json">Load</button>
  <button id="btn-paste-json">Paste</button>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.boxes = []
  state.selectedBoxId = null
  state.boxCounter = 0
  state.globalPalette = []
  state.canvas = { width: 1024, height: 1024, scale: 1 }
  state.photoArtMode = MODE_ARTSTYLE
  state.preset = 'Default'
  state.workflow = 'turbo'
  state.seed = -1
  localStorage.clear()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
})

describe('settings', () => {
  beforeAll(() => {
    if (!AbortSignal.timeout) {
      AbortSignal.timeout = () => new AbortController().signal
    }
  })

  async function initSettings() {
    const mod = await import('../settings.js')
    mod.initSettings()
    return mod
  }

  it('aspect ratio change updates dimensions and persists', async () => {
    await initSettings()
    const sel = document.getElementById('aspect-ratio')
    sel.value = '768x1152'
    sel.dispatchEvent(new Event('change'))
    expect(state.canvas.width).toBe(768)
    expect(state.canvas.height).toBe(1152)
    expect(localStorage.getItem('ideogram_aspect_ratio')).toBe('768x1152')
  })

  it('size button click updates dimensions', async () => {
    await initSettings()
    document.querySelector('.size-btn[data-size="2"]').click()
    expect(state.canvas.width).toBe(2048)
    expect(state.canvas.height).toBe(2048)
  })

  it('mode_photo sets photoArtMode and disables medium', async () => {
    document.getElementById('medium').disabled = false
    await initSettings()
    document.getElementById('mode_photo').checked = true
    document.getElementById('mode_photo').dispatchEvent(new Event('change'))
    expect(state.photoArtMode).toBe(MODE_PHOTO)
    expect(document.getElementById('medium').disabled).toBe(true)
    expect(document.getElementById('mode_label').innerText).toBe('Photo Style')
  })

  it('mode_artstyle enables medium', async () => {
    await initSettings()
    document.getElementById('mode_photo').checked = false
    document.getElementById('mode_artstyle').checked = true
    document.getElementById('mode_artstyle').dispatchEvent(new Event('change'))
    expect(state.photoArtMode).toBe(MODE_ARTSTYLE)
    expect(document.getElementById('medium').disabled).toBe(false)
    expect(document.getElementById('mode_label').innerText).toBe('Art Style')
  })

  it('box:selected populates form fields', async () => {
    await initSettings()
    const { emit } = await import('../events.js')
    const box = {
      id: 'box_0', mode: 'text', x: 100, y: 200, w: 300, h: 400,
      text: 'Hello', desc: 'A greeting', colors: [],
      color: '#ff0000', visible: true, locked: false,
    }
    state.boxes.push(box)
    emit('box:selected', { id: 'box_0' })
    expect(document.getElementById('box-mode').value).toBe('text')
    expect(document.getElementById('box-text').value).toBe('Hello')
    expect(document.getElementById('box-desc').value).toBe('A greeting')
    expect(document.getElementById('box-panel').style.display).toBe('block')
  })

  it('box:selected with null hides panel', async () => {
    await initSettings()
    const { emit } = await import('../events.js')
    document.getElementById('box-panel').style.display = 'block'
    emit('box:selected', { id: null })
    expect(document.getElementById('box-panel').style.display).toBe('none')
  })

  it('state:loaded fills form fields from JSON', async () => {
    await initSettings()
    const { emit } = await import('../events.js')
    emit('state:loaded', {
      json: {
        high_level_description: 'Sunset',
        style_description: { aesthetics: 'moody', lighting: 'dim', medium: 'photograph', photo: '35mm f/1.8' },
        compositional_deconstruction: { background: 'beach' },
      },
    })
    expect(document.getElementById('high_level_description').value).toBe('Sunset')
    expect(document.getElementById('aesthetics').value).toBe('moody')
    expect(document.getElementById('medium').value).toBe('photograph')
    expect(document.getElementById('background').value).toBe('beach')
    expect(document.getElementById('mode_photo').checked).toBe(true)
  })

  it('seed input updates state', async () => {
    await initSettings()
    const input = document.getElementById('seed-input')
    input.value = '42'
    input.dispatchEvent(new Event('input'))
    expect(state.seed).toBe(42)
  })

  it('invalid seed resets to -1', async () => {
    await initSettings()
    const input = document.getElementById('seed-input')
    input.value = 'not-a-number'
    input.dispatchEvent(new Event('input'))
    expect(state.seed).toBe(-1)
  })

  it('random seed button generates a number', async () => {
    await initSettings()
    document.getElementById('btn-random-seed').click()
    const input = document.getElementById('seed-input')
    expect(Number(input.value)).toBeGreaterThan(0)
    expect(state.seed).toBeGreaterThan(0)
  })

  it('workflow radio changes state and persists', async () => {
    await initSettings()
    document.querySelector('input[name="workflow"][value="v1"]').click()
    expect(state.workflow).toBe('v1')
    expect(localStorage.getItem('ideogram_workflow')).toBe('v1')
  })

  it('backend radio changes persisted', async () => {
    await initSettings()
    document.querySelector('input[name="backend"][value="modal"]').click()
    expect(localStorage.getItem('ideogram_backend')).toBe('modal')
  })

  it('box geometry input updates box coords', async () => {
    await initSettings()
    const box = {
      id: 'box_0', mode: 'obj', x: 0, y: 0, w: 500, h: 500,
      text: '', desc: '', colors: [], color: '#f00',
      visible: true, locked: false,
    }
    state.boxes.push(box)
    state.selectedBoxId = 'box_0'
    const { emit } = await import('../events.js')
    const xInput = document.getElementById('box-x')
    xInput.value = '256'
    xInput.dispatchEvent(new Event('input'))
    expect(box.x).toBe(250)
  })
})
