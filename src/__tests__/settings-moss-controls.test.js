// 2026-10-29: negative-prompt availability per preset + enhance-caption toggle.
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <div id="toast-container"></div>
  <div id="moss-preset-toggle">
    <input type="radio" name="moss_preset" id="moss_preset_fast" value="Fast" checked>
    <input type="radio" name="moss_preset" id="moss_preset_rapid" value="Rapid">
  </div>
  <textarea id="moss-negative">nsfw</textarea>
  <span id="moss-negative-hint" hidden>ignored</span>
  <input type="checkbox" id="moss-enhance-caption">
  <span id="moss-enhance-hint"></span>
  <input type="number" id="moss-cfg" step="0.25" min="1" max="10">
  <input type="radio" name="moss_prompt_mode" value="layout" checked>
  <input type="radio" name="moss_prompt_mode" value="caption">
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  localStorage.clear()
  vi.resetModules()
})

async function load() {
  const state = (await import('../state.js')).state
  const mod = await import('../settings-moss.js')
  return { state, mod }
}

describe('negative prompt availability', () => {
  it('disables the negative field for CFG-1 presets with an explanatory hint', async () => {
    const { state, mod } = await load()
    state.model = 'moss'
    state.moss = { promptMode: 'layout', preset: 'Rapid', enhanceCaption: false }
    mod.refreshNegativePromptUI()
    const field = document.getElementById('moss-negative')
    expect(field.disabled).toBe(true)
    expect(document.getElementById('moss-negative-hint').hidden).toBe(false)
  })

  it('keeps the negative field active for guided presets', async () => {
    const { state, mod } = await load()
    state.model = 'moss'
    state.moss = { promptMode: 'layout', preset: 'Fast', enhanceCaption: false }
    mod.refreshNegativePromptUI()
    expect(document.getElementById('moss-negative').disabled).toBe(false)
    expect(document.getElementById('moss-negative-hint').hidden).toBe(true)
  })
})

describe('enhance caption toggle', () => {
  it('only enables enhancement for captions and refreshes after a saved setting is restored', async () => {
    const { state, mod } = await load()
    state.model = 'moss'
    mod.initSettingsMoss()
    const box = document.getElementById('moss-enhance-caption')
    expect(box.disabled).toBe(true)
    state.moss.promptMode = 'caption'
    const { emit } = await import('../events.js')
    emit('moss:settings-restored')
    expect(box.disabled).toBe(false)
    document.querySelector('input[value="layout"]').dispatchEvent(new Event('change'))
    expect(box.disabled).toBe(true)
    expect(document.getElementById('moss-enhance-hint').textContent).toContain('Caption mode')
  })
  it('binds the checkbox to state.moss.enhanceCaption', async () => {
    const { state, mod } = await load()
    mod.initSettingsMoss()
    const box = document.getElementById('moss-enhance-caption')
    expect(state.moss.enhanceCaption).toBe(false)
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(state.moss.enhanceCaption).toBe(true)
    box.checked = false
    box.dispatchEvent(new Event('change'))
    expect(state.moss.enhanceCaption).toBe(false)
  })
})

describe('custom cfg override', () => {
  async function loadMoss(moss = { promptMode: 'layout', preset: 'Fast', enhanceCaption: false, cfg: null }) {
    const { state, mod } = await load()
    state.model = 'moss'
    state.moss = moss
    mod.initSettingsMoss()
    return { state, mod }
  }

  it('typing a valid cfg updates state and persists', async () => {
    const { state } = await loadMoss()
    const input = document.getElementById('moss-cfg')
    input.value = '3.5'
    input.dispatchEvent(new Event('change'))
    expect(state.moss.cfg).toBe(3.5)
    expect(localStorage.getItem('ideogram_moss_cfg')).toBe('3.5')
  })

  it('clearing the input returns to the preset default', async () => {
    const { state } = await loadMoss()
    const input = document.getElementById('moss-cfg')
    input.value = '3.5'
    input.dispatchEvent(new Event('change'))
    input.value = ''
    input.dispatchEvent(new Event('change'))
    expect(state.moss.cfg).toBe(null)
    expect(localStorage.getItem('ideogram_moss_cfg')).toBe('')
  })

  it('out-of-range cfg warns and reverts', async () => {
    const { state } = await loadMoss()
    const input = document.getElementById('moss-cfg')
    input.value = '12'
    input.dispatchEvent(new Event('change'))
    const { showToast } = await import('../toast.js')
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('between 1 and 10'), 'warning')

    expect(state.moss.cfg).toBe(null)
    expect(input.value).toBe('')
  })

  it('restores a saved cfg on init', async () => {
    localStorage.setItem('ideogram_moss_cfg', '2.8')
    const { state } = await loadMoss()
    expect(state.moss.cfg).toBe(2.8)
    expect(document.getElementById('moss-cfg').value).toBe('2.8')
  })

  it('negative availability follows the effective cfg, not the preset', async () => {
    const { state } = await loadMoss()
    const input = document.getElementById('moss-cfg')
    const field = document.getElementById('moss-negative')
    // CFG 1 overrides even a guided preset: negative becomes inert.
    input.value = '1'
    input.dispatchEvent(new Event('change'))
    expect(field.disabled).toBe(true)
    // A custom guided CFG re-enables the field on CFG-1 presets.
    state.moss.preset = 'Rapid'
    input.value = '3'
    input.dispatchEvent(new Event('change'))
    expect(field.disabled).toBe(false)
  })
})
