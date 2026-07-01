import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state, MODE_ARTSTYLE } from '../state.js'
import { on, emit } from '../events.js'

const DOM_HTML = `
  <select id="style-preset-editor"><option value="">None</option></select>
  <input id="preset-name-input">
  <button id="btn-save-preset">Save</button>
  <button id="btn-delete-preset">Delete</button>
  <select id="aspect-ratio"><option value="1024x1024">1:1</option></select>
  <button class="size-btn active" data-size="1">1x</button>
  <div id="dim-display">1024 x 1024</div>
  <input id="aesthetics" value="warm">
  <input id="lighting" value="soft">
  <input id="medium" value="photograph">
  <input id="art_style" value="">
  <input id="mode_photo" type="radio" name="mode" value="photo">
  <input id="mode_artstyle" type="radio" name="mode" value="artstyle" checked>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  localStorage.clear()
  state.photoArtMode = MODE_ARTSTYLE
})

describe('style-presets', () => {
  it('saves a new preset from form fields', async () => {
    const { initStylePresets } = await import('../style-presets.js')
    initStylePresets()
    document.getElementById('preset-name-input').value = 'Warm Portrait'
    document.getElementById('btn-save-preset').click()
    const stored = JSON.parse(localStorage.getItem('ideogram_style_presets') || '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('Warm Portrait')
    expect(stored[0].aesthetics).toBe('warm')
  })

  it('does not save empty name', async () => {
    const { initStylePresets } = await import('../style-presets.js')
    initStylePresets()
    document.getElementById('btn-save-preset').click()
    const stored = JSON.parse(localStorage.getItem('ideogram_style_presets') || '[]')
    expect(stored).toHaveLength(0)
  })

  it('populates the select from localStorage on init', async () => {
    const presets = [{ id: 'p1', name: 'Vintage' }, { id: 'p2', name: 'Noir' }]
    localStorage.setItem('ideogram_style_presets', JSON.stringify(presets))
    const { initStylePresets } = await import('../style-presets.js')
    initStylePresets()
    const select = document.getElementById('style-preset-editor')
    expect(select.options.length).toBe(3)
    expect(select.options[1].textContent).toBe('Vintage')
    expect(select.options[2].textContent).toBe('Noir')
  })

  it('deletes a selected preset', async () => {
    window.confirm = vi.fn(() => true)
    const presets = [{ id: 'p1', name: 'Vintage' }]
    localStorage.setItem('ideogram_style_presets', JSON.stringify(presets))
    const { initStylePresets } = await import('../style-presets.js')
    initStylePresets()
    const select = document.getElementById('style-preset-editor')
    select.value = 'p1'
    document.getElementById('btn-delete-preset').click()
    const stored = JSON.parse(localStorage.getItem('ideogram_style_presets') || '[]')
    expect(stored).toHaveLength(0)
  })

  it('resets select on state:loaded', async () => {
    localStorage.setItem('ideogram_style_presets', JSON.stringify([{ id: 'p1', name: 'Vintage' }]))
    const { initStylePresets } = await import('../style-presets.js')
    initStylePresets()
    emit('state:loaded', { json: {} })
    const select = document.getElementById('style-preset-editor')
    expect(select.value).toBe('')
  })

  it('emits style-preset:applied on selection change', async () => {
    const presets = [{ id: 'p1', name: 'Vintage', mode: 0, aesthetics: 'moody' }]
    localStorage.setItem('ideogram_style_presets', JSON.stringify(presets))
    const { initStylePresets } = await import('../style-presets.js')
    initStylePresets()
    const events = []
    on('style-preset:applied', (d) => events.push(d))
    const select = document.getElementById('style-preset-editor')
    select.value = 'p1'
    select.dispatchEvent(new Event('change'))
    expect(events).toHaveLength(1)
    expect(events[0].preset.aesthetics).toBe('moody')
  })
})
