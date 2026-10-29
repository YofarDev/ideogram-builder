// 2026-10-29: negative-prompt availability per preset + enhance-caption toggle.
import { describe, it, expect, beforeEach, vi } from 'vitest'

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
