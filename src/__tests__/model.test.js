import { describe, it, expect, beforeEach, vi } from 'vitest'
import { state, MODEL_IDEOGRAM, MODEL_MOSS } from '../state.js'
import { resetAllListeners, on } from '../events.js'

vi.mock('../toast.js', () => ({ showToast: vi.fn() }))

const DOM_HTML = `
  <div>
    <input type="radio" id="model-ideogram" name="model" value="ideogram" checked>
    <input type="radio" id="model-moss" name="model" value="moss">
  </div>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  delete document.body.dataset.model
  delete document.body.dataset.mossPrompt
  state.model = MODEL_IDEOGRAM
  localStorage.clear()
  resetAllListeners()
})

async function loadModel() {
  const mod = await import('../model.js')
  mod.initModel()
  return mod
}

describe('model', () => {
  it('defaults to ideogram and sets the body attribute', async () => {
    await loadModel()
    expect(state.model).toBe('ideogram')
    expect(document.body.dataset.model).toBe('ideogram')
  })

  it('setModel(moss) updates state, dataset, radio, localStorage and emits model:changed', async () => {
    const mod = await loadModel()
    const events = []
    on('model:changed', (p) => events.push(p))
    mod.setModel('moss')
    expect(state.model).toBe('moss')
    expect(document.body.dataset.model).toBe('moss')
    expect(document.getElementById('model-moss').checked).toBe(true)
    expect(localStorage.getItem('ideogram_model')).toBe('moss')
    expect(events).toEqual([{ model: 'moss', previous: 'ideogram', seed: true }])
  })

  it('persists across init from localStorage', async () => {
    localStorage.setItem('ideogram_model', 'moss')
    const mod = await loadModel()
    expect(state.model).toBe('moss')
    expect(document.getElementById('model-moss').checked).toBe(true)
    // silent init: no previous listeners were registered, nothing to observe
    expect(mod.setModel).toBeTypeOf('function')
  })

  it('radio change switches the model', async () => {
    await loadModel()
    document.getElementById('model-moss').checked = true
    document.getElementById('model-moss').dispatchEvent(new Event('change'))
    expect(state.model).toBe('moss')
    expect(localStorage.getItem('ideogram_model')).toBe('moss')
  })

  it('listens to model:set from other modules', async () => {
    const { emit } = await import('../events.js')
    await loadModel()
    emit('model:set', { model: 'moss' })
    expect(state.model).toBe('moss')
  })

  it('ignores unknown models and silent mode suppresses the event', async () => {
    const mod = await loadModel()
    const events = []
    on('model:changed', (p) => events.push(p))
    mod.setModel('bogus')
    expect(state.model).toBe('ideogram')
    mod.setModel('moss', { silent: true })
    expect(state.model).toBe('moss')
    expect(events).toEqual([])
    mod.setModel(MODEL_IDEOGRAM)
    mod.setModel(MODEL_IDEOGRAM) // same model → no duplicate event
    expect(events).toEqual([{ model: MODEL_IDEOGRAM, previous: MODEL_MOSS, seed: true }])
  })

  it('passes seed through model:set → model:changed (paste-driven switches)', async () => {
    const mod = await loadModel()
    const { emit } = await import('../events.js')
    const events = []
    on('model:changed', (p) => events.push(p))
    emit('model:set', { model: 'moss', seed: false })
    expect(events).toEqual([{ model: 'moss', previous: 'ideogram', seed: false }])
    mod.setModel('ideogram')
    expect(events[1]).toEqual({ model: 'ideogram', previous: 'moss', seed: true })
  })
})
