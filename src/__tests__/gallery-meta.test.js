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
    <input type="checkbox" id="moss-enhance-caption">
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
  const { setCapabilities } = await import('../moss-presets.js')
  setCapabilities(null, 'runpod')
})

async function load() {
  return import('../gallery-meta.js')
}

describe('restoreMeta (gallery)', () => {
  it.each([undefined, false, true])('restores enhancement %s without inheriting the previous run', async saved => {
    const { restoreMeta } = await load()
    state.model = MODEL_MOSS
    state.moss.enhanceCaption = true
    document.getElementById('moss-enhance-caption').checked = true
    restoreMeta({ model: 'moss', enhanceCaption: saved })
    expect(state.moss.enhanceCaption).toBe(saved === true)
    expect(document.getElementById('moss-enhance-caption').checked).toBe(saved === true)
  })
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

  it('candidate preset unavailable on this backend: keeps the saved recipe and warns', async () => {
    const { restoreMeta } = await load()
    const { showToast } = await import('../toast.js')
    restoreMeta({
      model: 'moss',
      mossPreset: 'Rapid',   // no capabilities fetched → not advertised here
      seed: 4,
    })
    // The saved recipe is NOT silently swapped.
    expect(state.moss.preset).toBe('Rapid')
    expect(localStorage.getItem('ideogram_moss_preset')).toBe('Rapid')
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Rapid'),
      'error',
      expect.any(Number),
    )
  })

  it('restoring Rapid on the same Modal backend preserves known capabilities', async () => {
    const { restoreMeta } = await load()
    const { setCapabilities, getCapabilities } = await import('../moss-presets.js')
    const { on } = await import('../events.js')
    const { showToast } = await import('../toast.js')
    localStorage.setItem('ideogram_backend', 'modal')
    const caps = { presets: [{ id: 'Rapid', validation_status: 'validated', max_area_mp: 1 }] }
    setCapabilities(caps, 'modal')
    const backendChanged = vi.fn(() => setCapabilities(null, 'modal'))
    on('backend:changed', backendChanged)
    restoreMeta({ model: 'moss', backend: 'modal', mossPreset: 'Rapid' })
    expect(backendChanged).not.toHaveBeenCalled()
    expect(getCapabilities()).toBe(caps)
    expect(state.moss.preset).toBe('Rapid')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('waits for Modal capabilities when restoring onto a different backend', async () => {
    const { restoreMeta } = await load()
    const { showToast } = await import('../toast.js')
    const { on } = await import('../events.js')
    const backendChanged = vi.fn()
    on('backend:changed', backendChanged)
    restoreMeta({ model: 'moss', backend: 'modal', mossPreset: 'Rapid' })
    expect(backendChanged).toHaveBeenCalledWith({ backend: 'modal' })
    expect(state.moss.preset).toBe('Rapid')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('available presets restore without an availability warning', async () => {
    const { restoreMeta } = await load()
    const { showToast } = await import('../toast.js')
    restoreMeta({ model: 'moss', mossPreset: 'Quality', seed: 4 })
    expect(state.moss.preset).toBe('Quality')
    expect(showToast).not.toHaveBeenCalled()
  })

  it('generation metadata round-trips through meta without breaking restore', async () => {
    const { restoreMeta } = await load()
    restoreMeta({
      model: 'moss',
      mossPreset: 'Fast',
      seed: 9,
      generation: {
        runtime_profile: 'baseline', preset_id: 'Fast', effective_steps: 25,
        cfg: 2.5, sampler: 'er_sde', scheduler: 'simple',
        negative_guidance_active: true, model_manifest_id: 'moss-models-2026-10-27a',
        first_generation_in_worker: false,
      },
    })
    expect(state.moss.preset).toBe('Fast')
    expect(state.seed).toBe(9)
  })
})
