import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state, MODEL_IDEOGRAM, MODEL_MOSS } from '../state.js'
import { resetAllListeners, emit } from '../events.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <div>
    <input id="seed-input" value="-1">
    <input type="radio" name="steps" data-preset="Quality">
    <input type="radio" name="steps" data-preset="Default">
    <input type="radio" name="workflow" value="turbo" checked>
    <input type="radio" name="workflow" value="v1">
    <input id="turbo-strength" type="range" value="0.8">
    <div id="dim-display"></div>
    <select id="aspect-ratio"><option value="1024x1024">1:1</option></select>
    <input type="radio" id="mode_photo" name="art_mode" value="photo">
    <input type="radio" id="mode_artstyle" name="art_mode" value="art_style" checked>
    <input type="radio" name="backend" value="runpod" checked>
    <input type="radio" name="backend" value="modal">
    <input type="radio" name="moss_preset" value="Turbo">
    <input type="radio" name="moss_preset" value="Fast" checked>
    <input type="radio" name="moss_preset" value="Quality">
    <textarea id="moss-negative"></textarea>
    <input type="radio" name="moss_prompt_mode" value="layout" checked>
    <input type="radio" name="moss_prompt_mode" value="caption">
    <div id="lora-list"></div>
    <button id="lora-toggle"><span class="lora-header-icon">▼</span></button>
    <div id="toast-container"></div>
  </div>
`

beforeEach(async () => {
  document.body.innerHTML = DOM_HTML
  delete document.body.dataset.model
  delete document.body.dataset.mossPrompt
  state.model = MODEL_IDEOGRAM
  state.moss = { promptMode: 'layout', preset: 'Fast' }
  state.seed = -1
  localStorage.clear()
  resetAllListeners()
})

async function load() {
  return import('../gallery-meta.js')
}

describe('restoreMeta (gallery)', () => {
  it('MOSS meta switches the model first (seed:false) then restores preset/negative/prompt mode', async () => {
    const { restoreMeta } = await load()
    const order = []
    const { on } = await import('../events.js')
    on('model:set', (p) => { order.push(['model:set', p]); state.model = p.model })
    restoreMeta({
      model: 'moss',
      mossPreset: 'Quality',
      negativePrompt: 'nsfw',
      promptFormat: 'caption',
      seed: 12,
    })
    expect(order[0]).toEqual(['model:set', { model: 'moss', seed: false }])
    expect(state.moss.preset).toBe('Quality')
    expect(localStorage.getItem('ideogram_moss_preset')).toBe('Quality')
    expect(document.querySelector('input[name="moss_preset"][value="Quality"]').checked).toBe(true)
    expect(document.getElementById('moss-negative').value).toBe('nsfw')
    expect(state.moss.promptMode).toBe('caption')
    expect(document.body.dataset.mossPrompt).toBe('caption')
    expect(document.querySelector('input[name="moss_prompt_mode"][value="caption"]').checked).toBe(true)
    expect(state.seed).toBe(12)
  })

  it('does not restore the Ideogram steps preset for a MOSS item', async () => {
    const { restoreMeta } = await load()
    state.model = MODEL_MOSS
    document.body.dataset.model = 'moss'
    restoreMeta({ model: 'moss', preset: 'Default' })
    expect(state.preset).toBe('Default') // untouched default from state
    expect(document.querySelector('input[name="steps"][data-preset="Quality"]').checked).toBe(false)
  })

  it('legacy meta (no model) keeps identical Ideogram behaviour — no model switch', async () => {
    const { restoreMeta } = await load()
    let modelSet = 0
    const { on } = await import('../events.js')
    on('model:set', () => modelSet++)
    restoreMeta({ preset: 'Quality', seed: 5, workflow: 'v1', turboStrength: 0.5, width: 1024, height: 1024 })
    expect(modelSet).toBe(0)
    expect(state.preset).toBe('Quality')
    expect(document.querySelector('input[name="steps"][data-preset="Quality"]').checked).toBe(true)
    expect(state.seed).toBe(5)
    expect(document.getElementById('seed-input').value).toBe('5')
    expect(state.workflow).toBe('v1')
    expect(state.canvas.width).toBe(1024)
    expect(document.getElementById('dim-display').textContent).toContain('1024')
  })

  it('switches back to ideogram when a legacy/ideogram meta loads while MOSS is active', async () => {
    const { restoreMeta } = await load()
    state.model = MODEL_MOSS
    document.body.dataset.model = 'moss'
    const { on } = await import('../events.js')
    const sets = []
    on('model:set', (p) => sets.push(p))
    restoreMeta({ model: 'ideogram', preset: 'Default' })
    expect(sets).toEqual([{ model: 'ideogram', seed: false }])
  })
})
