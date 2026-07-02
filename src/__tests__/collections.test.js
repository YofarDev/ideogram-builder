import { describe, it, expect, beforeEach, vi } from 'vitest'

const DOM_HTML = `
  <div id="collection-container">
    <div id="collection-chips"></div>
    <input type="file" id="collection-import-input">
    <button id="btn-collection-import"></button>
    <button id="btn-collection-export"></button>
    <button id="btn-collection-delete"></button>
    <h2 id="collection-title"></h2>
    <input id="collection-title-edit">
    <div id="collection-meta"></div>
    <textarea id="collection-paste"></textarea>
    <button id="btn-collection-paste-add"></button>
    <div id="collection-grid"></div>
    <button id="btn-collection-generate"></button>
  </div>
  <div id="toast-container"></div>
`

beforeEach(() => {
  document.body.innerHTML = DOM_HTML
  localStorage.clear()
})

async function loadCollections(mocks = {}) {
  vi.resetModules()
  vi.doMock('../events.js', () => ({ emit: mocks.emit ?? vi.fn(), on: mocks.on ?? vi.fn() }))
  vi.doMock('../toast.js', () => ({ showToast: mocks.showToast ?? vi.fn() }))
  vi.doMock('../queue.js', () => ({ enqueueImportJson: mocks.enqueueImportJson ?? vi.fn() }))
  return import('../collections.js')
}

describe('collections data layer', () => {
  it('createCollection adds and activates a new collection, persists to localStorage', async () => {
    const mod = await loadCollections()
    const c = mod.createCollection('Portraits')
    expect(c.name).toBe('Portraits')
    expect(mod.getActive().id).toBe(c.id)
    const stored = JSON.parse(localStorage.getItem('ideogram_collections'))
    expect(stored[0].name).toBe('Portraits')
  })

  it('addItem appends to the active collection with a derived label', async () => {
    const mod = await loadCollections()
    mod.createCollection('Set')
    const json = JSON.stringify({ high_level_description: 'A red apple' })
    const c = mod.addItem(json)
    expect(c.items).toHaveLength(1)
    expect(c.items[0].importJson).toBe(json)
    expect(mod.labelFor(json)).toBe('A red apple')
  })

  it('labelFor falls back to first element desc then background then truncation', async () => {
    const mod = await loadCollections()
    expect(mod.labelFor(JSON.stringify({
      compositional_deconstruction: { elements: [{ desc: 'a cat' }] },
    }))).toBe('a cat')
    expect(mod.labelFor(JSON.stringify({
      compositional_deconstruction: { background: 'a field' },
    }))).toBe('a field')
    expect(mod.labelFor('not json at all here')).toBe('not json at all here')
  })

  it('removeItem drops an item by id from the active collection', async () => {
    const mod = await loadCollections()
    mod.createCollection('Set')
    const c = mod.addItem('{"high_level_description":"x"}')
    const id = c.items[0].id
    mod.removeItem(id)
    expect(mod.getActive().items).toHaveLength(0)
  })

  it('load restores collections + active id from localStorage on init', async () => {
    const mod = await loadCollections()
    const c = mod.createCollection('Persisted')
    const reloaded = await loadCollections()
    expect(reloaded.getAll().some(x => x.id === c.id)).toBe(true)
    expect(reloaded.getActive().id).toBe(c.id)
  })

  it('generateCollection emits queue:enqueue for each item and shows error on empty', async () => {
    const emit = vi.fn()
    const showToast = vi.fn()
    const mod = await loadCollections({ emit, showToast })
    mod.createCollection('Batch')
    mod.addItem('{"high_level_description":"one"}')
    mod.addItem('{"high_level_description":"two"}')
    emit.mockClear()
    mod.generateCollection()
    expect(emit).toHaveBeenCalledTimes(2)
    expect(emit).toHaveBeenCalledWith('queue:enqueue', expect.objectContaining({ importJson: expect.any(String) }))
    mod.createCollection('Empty')
    mod.generateCollection()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('empty'), 'error')
  })

  it('duplicateItem clones an item with a new id, inserted after the source', async () => {
    const mod = await loadCollections()
    mod.createCollection('Set')
    const c = mod.addItem('{"high_level_description":"x"}')
    const orig = c.items[0].id
    mod.duplicateItem(orig)
    const items = mod.getActive().items
    expect(items).toHaveLength(2)
    expect(items[0].id).toBe(orig)
    expect(items[1].id).not.toBe(orig)
    expect(items[1].importJson).toBe(items[0].importJson)
  })

  it('loadItemToEditor emits state:loaded with parsed json; errors on non-structured json', async () => {
    const emit = vi.fn()
    const showToast = vi.fn()
    const mod = await loadCollections({ emit, showToast })
    mod.createCollection('Set')
    const c = mod.addItem(JSON.stringify({ high_level_description: 'hi', compositional_deconstruction: { elements: [] } }))
    emit.mockClear()
    mod.loadItemToEditor(c.items.at(-1).id)
    expect(emit).toHaveBeenCalledWith('state:loaded', { json: expect.objectContaining({ high_level_description: 'hi' }) })
    emit.mockClear()
    const c2 = mod.addItem('not json')
    emit.mockClear()
    mod.loadItemToEditor(c2.items.at(-1).id)
    expect(emit).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('loadable'), 'error')
  })
})
