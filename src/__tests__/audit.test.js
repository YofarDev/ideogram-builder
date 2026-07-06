import { describe, it, expect, beforeEach, vi } from 'vitest'
import { validateSuggestion, applyAddElement, applyUpdateElement, applyUpdateField } from '../audit.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const baseJson = () => ({
  high_level_description: 'a scene',
  background: 'a wall',
  style: { medium: 'photograph', aesthetics: 'minimal', lighting: 'soft', photo_or_art: '50mm' },
  compositional_deconstruction: { elements: [
    { name: 'cup', desc: 'a red cup', has_text: false, visible_text: null, bbox: [0.1, 0.1, 0.3, 0.3] },
    { name: 'book', desc: 'a blue book', has_text: false, visible_text: null, bbox: [0.4, 0.4, 0.6, 0.6] },
  ] },
})

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
    expect(json.background).toBe('a brick wall')
  })

  it('applyUpdateField sets a nested style field via dot-path', () => {
    const json = baseJson()
    applyUpdateField(json, { field: 'style.lighting', value: 'hard sun' })
    expect(json.style.lighting).toBe('hard sun')
  })

  it('applyUpdateField throws on missing dot-path', () => {
    const json = baseJson()
    expect(() => applyUpdateField(json, { field: 'style.mood', value: 'x' })).toThrow(/stale|missing/i)
  })
})
