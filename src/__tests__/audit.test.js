import { describe, it, expect, beforeEach, vi } from 'vitest'
import { validateSuggestion, applyAddElement, applyUpdateElement, applyUpdateField } from '../audit.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const baseJson = () => ({
  high_level_description: 'a scene',
  compositional_deconstruction: {
    background: 'a wall',
    elements: [
      { name: 'cup', desc: 'a red cup', has_text: false, visible_text: null, bbox: [0.1, 0.1, 0.3, 0.3] },
      { name: 'book', desc: 'a blue book', has_text: false, visible_text: null, bbox: [0.4, 0.4, 0.6, 0.6] },
    ],
  },
  style_description: { medium: 'photograph', aesthetics: 'minimal', lighting: 'soft', photo: '50mm' },
})

const DOM_HTML = `
  <select id="audit-model"><option value="local">local</option></select>
  <button id="btn-audit-run">Run Audit</button>
  <div id="audit-suggestions"></div>
  <textarea id="vision-json"></textarea>
  <textarea id="json-output"></textarea>
`

describe('audit helpers', () => {
  it('validateSuggestion accepts a well-formed add_element', () => {
    const s = { type: 'add_element', reason: 'x', element: { name: 'y', desc: 'z', has_text: false, visible_text: null, bbox: [0, 0, 0.1, 0.1] } }
    expect(validateSuggestion(s)).toEqual(s)
  })

  it('validateSuggestion rejects unknown type', () => {
    expect(validateSuggestion({ type: 'explode', reason: 'x' })).toBeNull()
  })

  it('validateSuggestion rejects add_element with missing bbox', () => {
    expect(validateSuggestion({ type: 'add_element', reason: 'x', element: { name: 'y', desc: 'z' } })).toBeNull()
  })

  it('validateSuggestion rejects add_element with bad bbox length', () => {
    expect(validateSuggestion({ type: 'add_element', reason: 'x', element: { name: 'y', desc: 'z', bbox: [0, 0, 1] } })).toBeNull()
  })

  it('validateSuggestion accepts update_element with desc patch', () => {
    const s = { type: 'update_element', index: 0, reason: 'x', patch: { desc: 'better' } }
    expect(validateSuggestion(s)).toEqual(s)
  })

  it('validateSuggestion rejects update_element with non-integer index', () => {
    expect(validateSuggestion({ type: 'update_element', index: 'a', reason: 'x', patch: { desc: 'y' } })).toBeNull()
  })

  it('validateSuggestion accepts update_field with allowed dot-path', () => {
    const s = { type: 'update_field', field: 'style.lighting', reason: 'x', value: 'hard' }
    expect(validateSuggestion(s)).toEqual(s)
  })

  it('validateSuggestion rejects update_field with unknown field', () => {
    expect(validateSuggestion({ type: 'update_field', field: 'mood', reason: 'x', value: 'happy' })).toBeNull()
  })

  it('applyAddElement pushes a new element', () => {
    const json = baseJson()
    const s = { type: 'add_element', element: { name: 'plate', desc: 'a plate', has_text: false, visible_text: null, bbox: [0.7, 0.7, 0.9, 0.9] } }
    applyAddElement(json, s)
    expect(json.compositional_deconstruction.elements).toHaveLength(3)
    expect(json.compositional_deconstruction.elements[2].name).toBe('plate')
  })

  it('applyUpdateElement merges patch into the indexed element', () => {
    const json = baseJson()
    applyUpdateElement(json, { index: 1, patch: { desc: 'a navy book' } })
    expect(json.compositional_deconstruction.elements[1].desc).toBe('a navy book')
    expect(json.compositional_deconstruction.elements[1].name).toBe('book')
  })

  it('applyUpdateElement throws on stale index (out of bounds)', () => {
    const json = baseJson()
    expect(() => applyUpdateElement(json, { index: 99, patch: { desc: 'x' } })).toThrow(/stale/i)
  })

  it('applyUpdateField sets a top-level field', () => {
    const json = baseJson()
    applyUpdateField(json, { field: 'background', value: 'a brick wall' })
    expect(json.compositional_deconstruction.background).toBe('a brick wall')
  })

  it('applyUpdateField sets a nested style field via dot-path', () => {
    const json = baseJson()
    applyUpdateField(json, { field: 'style.lighting', value: 'hard sun' })
    expect(json.style_description.lighting).toBe('hard sun')
  })

  it('applyUpdateField throws on missing dot-path', () => {
    const json = baseJson()
    expect(() => applyUpdateField(json, { field: 'style.mood', value: 'x' })).toThrow(/stale|missing|unknown/i)
  })
})

describe('audit UI', () => {
  const sampleSuggestions = (overrides = {}) => ({
    type: 'add_element',
    reason: 'missing glass',
    element: { name: 'wine glass', desc: 'a glass', has_text: false, visible_text: null, bbox: [0.5, 0.5, 0.6, 0.6] },
    ...overrides,
  })

  function setJsonOutput(json) {
    document.getElementById('json-output').value = JSON.stringify(json)
  }

  function readJsonOutput() {
    return JSON.parse(document.getElementById('json-output').value)
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    document.body.innerHTML = DOM_HTML
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ suggestions: [] }) })
    global.URL.createObjectURL = vi.fn()
    const { state } = await import('../state.js')
    state.imageDataUrl = 'data:image/png;base64,abc'
    document.getElementById('json-output').value = JSON.stringify({ compositional_deconstruction: { elements: [] } })
    const auditModule = await import('../audit.js')
    auditModule.initAudit()
  })

  it('renders suggestions inline after clicking run audit', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [sampleSuggestions()] }),
    })
    document.getElementById('btn-audit-run').click()
    await vi.waitFor(() => {
      const cards = document.querySelectorAll('.audit-card')
      expect(cards.length).toBe(1)
    })
  })

  it('drops malformed suggestions with a toast', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [
        sampleSuggestions(),
        { type: 'explode', reason: 'bad' },
        { type: 'add_element', reason: 'no element' },
      ] }),
    })
    const { showToast } = await import('../toast.js')
    document.getElementById('btn-audit-run').click()
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.audit-card').length).toBe(1)
    })
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('malformed'), 'warning')
  })

  it('accept on add_element pushes element and emits state:loaded', async () => {
    setJsonOutput({ compositional_deconstruction: { elements: [] } })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [sampleSuggestions()] }),
    })
    const { on } = await import('../events.js')
    const seen = vi.fn()
    on('state:loaded', seen)

    document.getElementById('btn-audit-run').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.audit-card').length).toBe(1))
    document.querySelector('.audit-accept').click()

    const updated = readJsonOutput()
    expect(updated.compositional_deconstruction.elements.length).toBe(1)
    expect(updated.compositional_deconstruction.elements[0].name).toBe('wine glass')
    expect(seen).toHaveBeenCalled()
  })

  it('stale update_element shows inline error, no crash', async () => {
    setJsonOutput({ compositional_deconstruction: { elements: [{ name: 'x', desc: 'y' }] } })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [
        { type: 'update_element', index: 99, reason: 'x', patch: { desc: 'better' } },
      ] }),
    })
    document.getElementById('btn-audit-run').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.audit-card').length).toBe(1))
    document.querySelector('.audit-accept').click()
    expect(document.querySelector('.audit-card-error').textContent).toMatch(/stale/i)
  })

  it('reject removes the card', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [sampleSuggestions()] }),
    })
    document.getElementById('btn-audit-run').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.audit-card').length).toBe(1))
    const card = document.querySelector('.audit-card')
    card.querySelector('.audit-dismiss').click()
    card.dispatchEvent(new Event('animationend'))
    expect(document.querySelectorAll('.audit-card').length).toBe(0)
  })

  it('Accept all applies every pending suggestion', async () => {
    setJsonOutput({ compositional_deconstruction: { elements: [] }, style_description: { lighting: 'soft' } })
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ suggestions: [
        sampleSuggestions(),
        { type: 'update_field', field: 'style.lighting', reason: 'x', value: 'hard' },
      ] }),
    })
    document.getElementById('btn-audit-run').click()
    await vi.waitFor(() => expect(document.querySelectorAll('.audit-card').length).toBe(2))
    document.querySelector('.audit-accept-all').click()
    const updated = readJsonOutput()
    expect(updated.compositional_deconstruction.elements.length).toBe(1)
    expect(updated.style_description.lighting).toBe('hard')
  })

  it('shows error toast when no image data in state', async () => {
    const { state } = await import('../state.js')
    state.imageDataUrl = ''
    const { showToast } = await import('../toast.js')
    document.getElementById('btn-audit-run').click()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Load an image'), 'error')
    expect(document.querySelectorAll('.audit-card').length).toBe(0)
  })
})
