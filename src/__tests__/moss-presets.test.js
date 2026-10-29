import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state } from '../state.js'

const DOM_HTML = `
  <div id="toast-container"></div>
  <div id="moss-preset-toggle">
    <input type="radio" name="moss_preset" id="moss_preset_fast" value="Fast" checked>
    <label for="moss_preset_fast">Fast</label>
    <input type="radio" name="moss_preset" id="moss_preset_rapid" value="Rapid" data-candidate disabled>
    <label for="moss_preset_rapid" data-candidate hidden>Rapid</label>
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
    { id: 'Rapid', label: 'Rapid', blurb: '4 steps · experimental · up to 1 MP',
      steps_policy: 'rapid', validation_status: 'experimental', max_area_mp: 1 },
    { id: 'Draft3', label: 'Draft β', blurb: '3 steps, 1024² max', max_area_mp: 1 },
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
    expect(mod.describePreset('Rapid')).toBe('4 steps · experimental · up to 1 MP')
    expect(mod.describePreset('Fast')).toMatch(/25 steps/)
    expect(mod.presetLabel('Draft3')).toBe('Draft β')
  })

  it('availability message names the preset', async () => {
    const mod = await importModule()
    const msg = mod.availabilityMessage('Rapid')
    expect(msg).toContain('Rapid')
    expect(msg).toMatch(/not available/i)
  })
})

describe('preset limits and snapshot guards', () => {
  const snap = (over = {}) => ({ model: 'moss', preset: 'Rapid', width: 1024, height: 1024, ...over });

  it('exposes the advertised validation status and area limit', async () => {
    const mod = await importModule()
    mod.setCapabilities(CAPS_WITH_CANDIDATES)
    expect(mod.presetAreaLimitMp('Rapid')).toBe(1)
    expect(mod.validationStatus('Rapid')).toBe('experimental')
    expect(mod.validationStatus('Fast')).toBe(null)            // base entry without status field
    mod.setCapabilities(null)
    expect(mod.presetAreaLimitMp('Rapid')).toBe(1)             // conservative local fallback
    expect(mod.presetAreaLimitMp('Fast')).toBe(null)
  })

  it('checkSnapshot passes an in-limit moss snapshot and any ideogram snapshot', async () => {
    const mod = await importModule()
    mod.setCapabilities(CAPS_WITH_CANDIDATES)
    expect(mod.checkSnapshot(snap()).ok).toBe(true)
    expect(mod.checkSnapshot({ model: 'ideogram', preset: 'Default', width: 4096, height: 4096 }).ok).toBe(true)
  })

  it('checkSnapshot rejects oversize with the requested area and the limit', async () => {
    const mod = await importModule()
    mod.setCapabilities(CAPS_WITH_CANDIDATES)
    const verdict = mod.checkSnapshot(snap({ width: 1024, height: 1536 }))  // 1.5 MP
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('up to 1 MP')
    expect(verdict.message).toContain('1024×1536')
    expect(verdict.message).toContain('1.50 MP')
  })

  it('accepts larger Rapid snapshots only when the deployment advertises them', async () => {
    const mod = await importModule()
    mod.setCapabilities({ presets: [{ id: 'Rapid', max_area_mp: 4 }, { id: 'Draft3', max_area_mp: 1 }] })
    expect(mod.checkSnapshot(snap({ width: 1536 })).ok).toBe(true)
    expect(mod.checkSnapshot(snap({ width: 2048 })).ok).toBe(true)
    expect(mod.checkSnapshot(snap({ width: 2048, height: 2048 })).ok).toBe(true)
    const verdict = mod.checkSnapshot(snap({ width: 2048, height: 2064 }))
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('up to 4 MP')
    expect(mod.checkSnapshot(snap({ preset: 'Draft3', width: 1536 })).ok).toBe(false)
    // Switching to the retained 1 MP deployment must restore its stricter gate.
    mod.setCapabilities(CAPS_WITH_CANDIDATES)
    expect(mod.checkSnapshot(snap({ width: 1536 })).ok).toBe(false)
  })

  it('checkSnapshot rejects an unavailable preset using the snapshot itself', async () => {
    const mod = await importModule()
    mod.setCapabilities(CAPS_WITH_CANDIDATES)
    const verdict = mod.checkSnapshot(snap({ preset: 'FastSpectrum' }))  // not advertised here
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('Fast+ β')
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
    expect(toast?.textContent).toContain('Rapid')
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

describe('2026-10-29 quality modes', () => {
  it('ships Poster and Quality30 candidate info with cfg', async () => {
    const mod = await importModule()
    expect(mod.CANDIDATE_PRESETS).toContain('Poster')
    expect(mod.CANDIDATE_PRESETS).toContain('Quality30')
    expect(mod.PRESET_INFO.Poster.cfg).toBe(3.75)
    expect(mod.PRESET_INFO.Poster.blurb).toMatch(/res_multistep/)
    expect(mod.PRESET_INFO.Quality30.cfg).toBe(3.0)
    expect(mod.PRESET_INFO.Quality30.blurb).toMatch(/30 steps/)
  })

  it('marks exactly the CFG-1 presets as ignoring the negative prompt', async () => {
    const mod = await importModule()
    for (const id of ['Turbo', 'Rapid', 'Draft3']) {
      expect(mod.presetIgnoresNegative(id)).toBe(true)
    }
    for (const id of ['Fast', 'Quality', 'Poster', 'Quality30', 'FastSpectrum', 'QualitySpectrum']) {
      expect(mod.presetIgnoresNegative(id)).toBe(false)
    }
  })
})
