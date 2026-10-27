import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'

const DOM_HTML = `
  <div id="toast-container"></div>
  <div id="moss-preset-toggle">
    <input type="radio" name="moss_preset" id="moss_preset_fast" value="Fast" checked>
    <label for="moss_preset_fast">Fast</label>
    <input type="radio" name="moss_preset" id="moss_preset_rapid" value="Rapid" data-candidate disabled>
    <label for="moss_preset_rapid" data-candidate hidden>Rapid β</label>
    <input type="radio" name="moss_preset" id="moss_preset_draft3" value="Draft3" data-candidate disabled>
    <label for="moss_preset_draft3" data-candidate hidden>Draft β</label>
  </div>
`

const CAPS_WITH_CANDIDATES = {
  schema_version: 1,
  runtime_profile: 'resident-highvram-int8-adapters',
  status: 'validated',
  presets: [
    { id: 'Fast', label: 'Fast' },
    { id: 'Quality', label: 'Quality' },
    { id: 'Turbo', label: 'Turbo β' },
    { id: 'Rapid', label: 'Rapid β', blurb: '4 steps up to 1024²', steps_policy: 'rapid' },
    { id: 'Draft3', label: 'Draft β', blurb: '3 steps, 1024² max' },
  ],
}

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  state.model = 'moss'
  state.moss = { promptMode: 'layout', preset: 'Fast' }
  localStorage.clear()
  vi.resetModules()
})

async function importModule() {
  return await import('../moss-presets.js')
}

/** The state instance the freshly-imported module under test captured. */
async function freshState() {
  return (await import('../state.js')).state
}

describe('moss-presets availability', () => {
  it('base presets are always available without capabilities', async () => {
    const mod = await importModule()
    expect(mod.availablePresets()).toEqual(['Fast', 'Quality', 'Turbo'])
    expect(mod.isAvailable('Rapid')).toBe(false)
  })

  it('capabilities add candidate presets', async () => {
    const mod = await importModule()
    mod.setCapabilities(CAPS_WITH_CANDIDATES)
    expect(mod.isAvailable('Rapid')).toBe(true)
    expect(mod.isAvailable('Draft3')).toBe(true)
    expect(mod.isAvailable('FastSpectrum')).toBe(false)  // not advertised here
    expect(mod.availablePresets()).toContain('Rapid')
  })

  it('malformed capabilities payloads fall back to base presets', async () => {
    const mod = await importModule()
    mod.setCapabilities(null)
    mod.setCapabilities({})
    mod.setCapabilities({ presets: 'nope' })
    expect(mod.availablePresets()).toEqual(['Fast', 'Quality', 'Turbo'])
  })

  it('remote blurb wins over the local table', async () => {
    const mod = await importModule()
    mod.setCapabilities(CAPS_WITH_CANDIDATES)
    expect(mod.describePreset('Rapid')).toBe('4 steps up to 1024²')
    expect(mod.describePreset('Fast')).toMatch(/25 steps/)
    expect(mod.presetLabel('Draft3')).toBe('Draft β')
  })

  it('availability message names the preset', async () => {
    const mod = await importModule()
    const msg = mod.availabilityMessage('Rapid')
    expect(msg).toContain('Rapid β')
    expect(msg).toMatch(/not available/i)
  })
})

describe('moss-presets ensurePresetUsable', () => {
  it('always true for ideogram jobs', async () => {
    const mod = await importModule()
    const st = await freshState()
    st.model = 'ideogram'
    st.moss.preset = 'Draft3'
    expect(mod.ensurePresetUsable('ideogram')).toBe(true)
  })

  it('blocks unavailable moss presets with an actionable toast', async () => {
    const mod = await importModule()
    const st = await freshState()
    st.model = 'moss'
    st.moss.preset = 'Rapid'  // capabilities absent → unavailable
    const usable = mod.ensurePresetUsable('moss')
    expect(usable).toBe(false)
    const toast = document.querySelector('#toast-container .toast')
    expect(toast?.textContent).toContain('Rapid β')
    expect(toast?.className).toContain('toast-error')
  })

  it('allows available moss presets', async () => {
    const mod = await importModule()
    const st = await freshState()
    st.model = 'moss'
    mod.setCapabilities(CAPS_WITH_CANDIDATES)
    st.moss.preset = 'Rapid'
    expect(mod.ensurePresetUsable('moss')).toBe(true)
    expect(document.querySelector('#toast-container .toast')).toBeNull()
  })

  it('currentPresetUnavailable reflects selection state', async () => {
    const mod = await importModule()
    const st = await freshState()
    st.model = 'moss'
    st.moss.preset = 'Draft3'
    expect(mod.currentPresetUnavailable()).toBe(true)
    mod.setCapabilities(CAPS_WITH_CANDIDATES)
    expect(mod.currentPresetUnavailable()).toBe(false)
  })
})
